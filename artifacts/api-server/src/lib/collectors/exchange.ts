import {
  fetchGraphText,
  fetchGraphJson,
  fetchAllGraphPages,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";
import { lookupDomainEmailAuth } from "../dns/emailAuthDns.js";
import { fetchDkimSigningConfigs, isExchangeCertAuthConfigured } from "../exchangeOnline.js";
import { parseCsv } from "../csv.js";
import type { GraphDomain, GraphServiceConfigurationRecord } from "./graphTypes.js";

export async function collectExchange() {
  const [mailboxCsvResult, activityCsvResult, domainsResult] = await Promise.all([
    fetchGraphText("https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='D30')", "mailboxUsageDetailReport", ["Reports.Read.All"]),
    fetchGraphText("https://graph.microsoft.com/v1.0/reports/getEmailActivityCounts(period='D30')", "emailActivityCountsReport", ["Reports.Read.All"]),
    fetchAllGraphPages<GraphDomain>("https://graph.microsoft.com/v1.0/domains?$select=id,isVerified,supportedServices", "domains", ["Domain.Read.All"]),
  ]);

  const collectionIssues: CollectionIssue[] = [];
  if (mailboxCsvResult.issue) collectionIssues.push(mailboxCsvResult.issue);
  if (activityCsvResult.issue) collectionIssues.push(activityCsvResult.issue);
  collectionIssues.push(...domainsResult.issues);

  const mailboxes = parseCsv(mailboxCsvResult.text ?? "");
  const activityRows = parseCsv(activityCsvResult.text ?? "");

  let totalMailboxes = 0;
  let activeMailboxes = 0;
  let sharedMailboxes = 0;
  let roomMailboxes = 0;
  let totalStorageUsedBytes = 0;
  let totalStorageAllocatedBytes = 0;

  const sizeRanges = [
    { label: "0-1 GB", min: 0, max: 1 },
    { label: "1-5 GB", min: 1, max: 5 },
    { label: "5-10 GB", min: 5, max: 10 },
    { label: "10-25 GB", min: 10, max: 25 },
    { label: "25-50 GB", min: 25, max: 50 },
    { label: ">50 GB", min: 50, max: Infinity },
  ];
  const sizeCounts = new Array(sizeRanges.length).fill(0);

  for (const m of mailboxes) {
    if (m["Is Deleted"] === "True") continue;
    totalMailboxes++;
    if (m["Last Activity Date"]) activeMailboxes++;
    const usedBytes = parseInt(m["Storage Used (Byte)"] ?? "0", 10) || 0;
    const allocBytes = parseInt(m["Prohibit Send/Receive Quota (Byte)"] ?? "0", 10) || 0;
    totalStorageUsedBytes += usedBytes;
    totalStorageAllocatedBytes += allocBytes;
    const usedGB = usedBytes / 1e9;
    for (let i = 0; i < sizeRanges.length; i++) {
      if (usedGB >= sizeRanges[i].min && usedGB < sizeRanges[i].max) { sizeCounts[i]++; break; }
    }
  }

  let totalSent = 0;
  let totalReceived = 0;
  let totalRead = 0;
  for (const row of activityRows) {
    totalSent += parseInt(row["Send"] ?? "0", 10) || 0;
    totalReceived += parseInt(row["Receive"] ?? "0", 10) || 0;
    totalRead += parseInt(row["Read"] ?? "0", 10) || 0;
  }

  const emailDomains = domainsResult.items.filter(
    (d) => d.isVerified && (d.supportedServices ?? []).includes("Email"),
  );

  const domainsToCheck = emailDomains.slice(0, 20);
  const collectionNotes: string[] = [];
  if (emailDomains.length > domainsToCheck.length) {
    collectionNotes.push(
      `Only the first ${domainsToCheck.length} of ${emailDomains.length} verified email domains were checked for SPF/DKIM/DMARC.`,
    );
  }

  // Authoritative M365 DKIM signing status (best-effort; falls back to DNS per domain).
  // App-only EXO access is impossible under a client-secret credential (see backlog 6.1),
  // so skip the guaranteed-failing call rather than raising a permission issue every run.
  let dkimResult: Awaited<ReturnType<typeof fetchDkimSigningConfigs>>;
  if (isExchangeCertAuthConfigured()) {
    dkimResult = await fetchDkimSigningConfigs();
    collectionIssues.push(...dkimResult.issues);
  } else {
    dkimResult = { byDomain: null, issues: [] };
    collectionNotes.push("Authoritative DKIM status unavailable without certificate auth; using DNS selector records instead.");
  }

  const domainAuthRecords = await Promise.all(
    domainsToCheck.map(async (domain) => {
      const domainId = domain.id ?? "";

      // Primary signal: live DNS resolution of the published records.
      const dns = await lookupDomainEmailAuth(domainId);
      collectionIssues.push(...dns.issues);

      // Secondary signal: Microsoft's recommended/expected service-configuration records.
      const expected = await fetchGraphJson<{ value?: GraphServiceConfigurationRecord[] }>(
        `https://graph.microsoft.com/v1.0/domains/${encodeURIComponent(domainId)}/serviceConfigurationRecords`,
        `domainConfigRecords:${domainId}`,
        undefined,
        ["Domain.Read.All"],
      );
      if (expected.issue) collectionIssues.push(expected.issue);
      const expectedRecords = expected.data?.value ?? [];
      const expectedSpf = expectedRecords.some(
        (r) => r.recordType === "Txt" && typeof r.text === "string" && r.text.toLowerCase().includes("v=spf1"),
      );
      const expectedMx = expectedRecords.some((r) => r.recordType === "Mx");

      // DKIM: prefer authoritative Exchange Online status, fall back to DNS selector CNAMEs.
      const exoDkim = dkimResult.byDomain?.get(domainId.toLowerCase());
      let hasDkim: boolean;
      let dkimSource: "exchange" | "dns" | "none";
      if (exoDkim !== undefined) {
        hasDkim = exoDkim;
        dkimSource = "exchange";
      } else if (dns.hasDkimCname) {
        hasDkim = true;
        dkimSource = "dns";
      } else {
        hasDkim = false;
        dkimSource = "none";
      }

      return {
        domain: domainId,
        hasSpf: dns.hasSpf,
        hasDkim,
        hasDmarc: dns.hasDmarc,
        mxConfigured: dns.mxConfigured,
        spfRecord: dns.spfRecord,
        dmarcPolicy: dns.dmarcPolicy,
        dkimSource,
        expectedSpf,
        expectedMx,
      };
    }),
  );

  return {
    totalMailboxes, activeMailboxes, sharedMailboxes, roomMailboxes,
    totalStorageUsedGB: Math.round((totalStorageUsedBytes / 1e9) * 10) / 10,
    totalStorageAllocatedGB: Math.round((totalStorageAllocatedBytes / 1e9) * 10) / 10,
    storageUtilizationPercent: totalStorageAllocatedBytes > 0
      ? Math.round((totalStorageUsedBytes / totalStorageAllocatedBytes) * 100) : 0,
    mailboxSizeDistribution: sizeRanges.map((r, i) => ({ range: r.label, count: sizeCounts[i] })),
    emailActivityLast30Days: { sent: totalSent, received: totalReceived, read: totalRead },
    quarantinedMessages: 0, malwareDetected: 0, spamFiltered: 0,
    domainAuthRecords,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
    collectionNotes,
  };
}
