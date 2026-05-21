import { Router } from "express";
import { getCached } from "../lib/graphClient.js";
import {
  fetchGraphText,
  fetchGraphJson,
  fetchAllGraphPages,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/\r/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/\r/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] ?? "";
    });
    return obj;
  });
}

export interface DomainEmailAuthRecord {
  domain: string;
  hasSpf: boolean;
  hasDkim: boolean;
  hasDmarc: boolean;
  mxConfigured: boolean;
}

async function getExchangeData() {
  return getCached("m365-exchange", async () => {
    const [mailboxCsvResult, activityCsvResult, domainsResult] = await Promise.all([
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='D30')",
        "mailboxUsageDetailReport",
      ),
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getEmailActivityCounts(period='D30')",
        "emailActivityCountsReport",
      ),
      fetchAllGraphPages<any>(
        "https://graph.microsoft.com/v1.0/domains?$select=id,isVerified,supportedServices",
        "domains",
      ),
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
      const allocBytes =
        parseInt(m["Prohibit Send/Receive Quota (Byte)"] ?? "0", 10) || 0;
      totalStorageUsedBytes += usedBytes;
      totalStorageAllocatedBytes += allocBytes;

      const usedGB = usedBytes / 1e9;
      for (let i = 0; i < sizeRanges.length; i++) {
        if (usedGB >= sizeRanges[i].min && usedGB < sizeRanges[i].max) {
          sizeCounts[i]++;
          break;
        }
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

    // Domain email auth records: fetch serviceConfigurationRecords for each verified email domain
    const emailDomains = domainsResult.items.filter(
      (d: any) => d.isVerified && (d.supportedServices as string[] ?? []).includes("Email"),
    );

    const domainAuthRecords: DomainEmailAuthRecord[] = await Promise.all(
      emailDomains.slice(0, 20).map(async (domain: any) => {
        const domainId: string = domain.id;
        const result = await fetchGraphJson<any>(
          `https://graph.microsoft.com/v1.0/domains/${encodeURIComponent(domainId)}/serviceConfigurationRecords`,
          `domainConfigRecords:${domainId}`,
        );
        const records: any[] = result.data?.value ?? [];
        const hasSpf = records.some((r: any) =>
          r.recordType === "Txt" && typeof r.text === "string" && r.text.toLowerCase().includes("v=spf1"),
        );
        const hasDkim = records.some((r: any) =>
          r.recordType === "CName" && typeof r.label === "string" &&
          (r.label.toLowerCase().includes("selector1") || r.label.toLowerCase().includes("selector2") || r.label.toLowerCase().includes("_domainkey")),
        );
        const mxConfigured = records.some((r: any) => r.recordType === "Mx");
        return {
          domain: domainId,
          hasSpf,
          hasDkim,
          hasDmarc: false, // DMARC requires external DNS lookup; not available via Graph API
          mxConfigured,
        };
      }),
    );

    return {
      totalMailboxes,
      activeMailboxes,
      sharedMailboxes,
      roomMailboxes,
      totalStorageUsedGB: Math.round((totalStorageUsedBytes / 1e9) * 10) / 10,
      totalStorageAllocatedGB:
        Math.round((totalStorageAllocatedBytes / 1e9) * 10) / 10,
      storageUtilizationPercent:
        totalStorageAllocatedBytes > 0
          ? Math.round((totalStorageUsedBytes / totalStorageAllocatedBytes) * 100)
          : 0,
      mailboxSizeDistribution: sizeRanges.map((r, i) => ({
        range: r.label,
        count: sizeCounts[i],
      })),
      emailActivityLast30Days: {
        sent: totalSent,
        received: totalReceived,
        read: totalRead,
      },
      quarantinedMessages: 0,
      malwareDetected: 0,
      spamFiltered: 0,
      domainAuthRecords,
      partialData: collectionIssues.length > 0,
      permissionError: collectionIssues.some(isPermissionIssue),
      collectionIssues,
    };
  });
}

router.get("/m365/exchange", async (req, res): Promise<void> => {
  try {
    const data = await getExchangeData();

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Exchange data");
    res.status(500).json({ error: "Failed to fetch M365 Exchange data" });
  }
});

router.get("/m365/exchange/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getExchangeData();

    const fieldMetadata = {
      totalMailboxes: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
      },
      activeMailboxes: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
      },
      sharedMailboxes: {
        evidenceStatus: "manual" as const,
        confidenceLabel: "unknown" as const,
        sourceLabel: "Not currently derived from report CSV",
      },
      roomMailboxes: {
        evidenceStatus: "manual" as const,
        confidenceLabel: "unknown" as const,
        sourceLabel: "Not currently derived from report CSV",
      },
      totalStorageUsedGB: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
      },
      totalStorageAllocatedGB: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
      },
      storageUtilizationPercent: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Calculated from mailbox storage metrics",
      },
      mailboxSizeDistribution: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Derived from mailbox usage report rows",
      },
      emailActivityLast30Days: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Reports.Read.All",
      },
      quarantinedMessages: {
        evidenceStatus: "manual" as const,
        confidenceLabel: "unknown" as const,
        sourceLabel: "Placeholder metric",
      },
      malwareDetected: {
        evidenceStatus: "manual" as const,
        confidenceLabel: "unknown" as const,
        sourceLabel: "Placeholder metric",
      },
      spamFiltered: {
        evidenceStatus: "manual" as const,
        confidenceLabel: "unknown" as const,
        sourceLabel: "Placeholder metric",
      },
      partialData: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when one or more upstream collection calls failed"],
      },
      permissionError: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when collection issues include permission-related failures"],
      },
      collectionIssues: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["Per-source issue details for failed Graph report calls"],
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Exchange data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 Exchange data" });
  }
});

export default router;
