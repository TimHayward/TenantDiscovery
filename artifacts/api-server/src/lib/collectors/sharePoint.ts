import {
  fetchAllGraphPages,
  fetchGraphJson,
  fetchGraphText,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/\r/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/\r/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
}

function normalizeToken(value: string): string {
  return decodeURIComponent(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stripGuidSuffix(value: string): string {
  return value.replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "").replace(/-[0-9a-f]{32}$/i, "");
}

function isLikelyGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || /^[0-9a-f]{32}$/i.test(value);
}

function prettifySlug(slug: string): string {
  return stripGuidSuffix(decodeURIComponent(slug)).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function extractSiteSlug(siteUrl: string): string | null {
  const m = siteUrl.match(/\/(?:sites|teams)\/([^/]+)/i);
  return m ? m[1] : null;
}

function resolveAssignedTeamName(siteSlug: string | null, teamNicknameMap: Map<string, string>): string | null {
  if (!siteSlug) return null;
  const normalized = normalizeToken(siteSlug);
  const normalizedWithoutGuid = normalizeToken(stripGuidSuffix(siteSlug));
  const exact = teamNicknameMap.get(normalized) ?? teamNicknameMap.get(normalizedWithoutGuid);
  if (exact) return exact;
  for (const [key, teamName] of teamNicknameMap.entries()) {
    if (normalized.startsWith(key) || normalizedWithoutGuid.startsWith(key)) return teamName;
  }
  return null;
}

function latestSummaryRow(rows: Record<string, string>[], siteTypeValue?: string): Record<string, string> | null {
  if (!rows.length) return null;
  if (!siteTypeValue) return rows[rows.length - 1];
  const matches = rows.filter((r) => (r["Site Type"] ?? "").toLowerCase() === siteTypeValue.toLowerCase());
  return matches.length ? matches[matches.length - 1] : rows[rows.length - 1];
}

export async function collectSharePoint() {
  const [
    siteUsageCsvResult, siteCountsCsvResult, storageCsvResult, fileCountsCsvResult,
    oneDriveCsvResult, teamGroupsResult, siteDisplayNamesResult,
  ] = await Promise.all([
    fetchGraphText("https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageDetail(period='D180')", "sharePointSiteUsageReport"),
    fetchGraphText("https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageSiteCounts(period='D30')", "sharePointSiteUsageSiteCounts"),
    fetchGraphText("https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageStorage(period='D30')", "sharePointSiteUsageStorage"),
    fetchGraphText("https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageFileCounts(period='D30')", "sharePointSiteUsageFileCounts"),
    fetchGraphText("https://graph.microsoft.com/v1.0/reports/getOneDriveUsageAccountDetail(period='D30')", "oneDriveUsageAccountReport"),
    fetchAllGraphPages<{ id: string; displayName: string; mailNickname: string }>(
      "https://graph.microsoft.com/v1.0/groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select=id,displayName,mailNickname&$top=999",
      "teamGroupsForSPCorrelation",
    ),
    fetchAllGraphPages<{ id: string; displayName: string; webUrl: string }>(
      "https://graph.microsoft.com/v1.0/sites/getAllSites?$select=id,displayName,webUrl&$top=500",
      "sharePointSiteDisplayNames",
    ),
  ]);

  const collectionIssues: CollectionIssue[] = [];
  if (siteUsageCsvResult.issue) collectionIssues.push(siteUsageCsvResult.issue);
  if (siteCountsCsvResult.issue) collectionIssues.push(siteCountsCsvResult.issue);
  if (storageCsvResult.issue) collectionIssues.push(storageCsvResult.issue);
  if (fileCountsCsvResult.issue) collectionIssues.push(fileCountsCsvResult.issue);
  if (oneDriveCsvResult.issue) collectionIssues.push(oneDriveCsvResult.issue);
  collectionIssues.push(...teamGroupsResult.issues);

  const teamNicknameMap = new Map<string, string>();
  for (const g of teamGroupsResult.items) {
    if (g.mailNickname) {
      const displayName = g.displayName ?? g.mailNickname;
      teamNicknameMap.set(normalizeToken(g.mailNickname), displayName);
      teamNicknameMap.set(normalizeToken(stripGuidSuffix(g.mailNickname)), displayName);
      if (g.displayName) teamNicknameMap.set(normalizeToken(g.displayName), g.displayName);
    }
  }

  const siteCountRows = parseCsv(siteCountsCsvResult.text ?? "");
  const siteCountRow = latestSummaryRow(siteCountRows, "All") ?? latestSummaryRow(siteCountRows);
  const totalSites = parseInt(siteCountRow?.["Total"] ?? siteCountRow?.["Site Count"] ?? "0", 10) || 0;
  const activeSites = parseInt(siteCountRow?.["Active"] ?? siteCountRow?.["Active Site Count"] ?? "0", 10) || 0;

  const storageRows = parseCsv(storageCsvResult.text ?? "");
  const storageRow = latestSummaryRow(storageRows);
  const totalStorageUsedBytes = parseInt(storageRow?.["Storage Used (Byte)"] ?? "0", 10) || 0;
  const totalStorageAllocatedBytes = parseInt(storageRow?.["Storage Allocated (Byte)"] ?? "0", 10) || 0;

  const fileCountRows = parseCsv(fileCountsCsvResult.text ?? "");
  const fileCountRow = latestSummaryRow(fileCountRows, "All") ?? latestSummaryRow(fileCountRows);
  const totalFiles = parseInt(fileCountRow?.["Total"] ?? fileCountRow?.["File Count"] ?? "0", 10) || 0;

  const siteRows = parseCsv(siteUsageCsvResult.text ?? "");
  const oneDriveRows = parseCsv(oneDriveCsvResult.text ?? "");

  interface UsageEntry {
    usedBytes: number; allocBytes: number; fileCount: number;
    pageViews: number; lastActivity: string; siteUrl: string; ownerName: string;
  }
  const usageById = new Map<string, UsageEntry>();
  const usageByUrl = new Map<string, UsageEntry>();
  const usageBySlug = new Map<string, UsageEntry>();
  let totalPageViews = 0;

  for (const s of siteRows) {
    if ((s["Is Deleted"] ?? "").toLowerCase() === "true") continue;
    const pageViews = parseInt(s["Page View Count"] ?? "0", 10) || 0;
    totalPageViews += pageViews;
    const owner = s["Owner Display Name"] ?? "";
    const entry: UsageEntry = {
      usedBytes: parseInt(s["Storage Used (Byte)"] ?? "0", 10) || 0,
      allocBytes: parseInt(s["Storage Allocated (Byte)"] ?? "0", 10) || 0,
      fileCount: parseInt(s["File Count"] ?? "0", 10) || 0,
      pageViews, lastActivity: s["Last Activity Date"] ?? "",
      siteUrl: s["Site URL"] ?? "", ownerName: (owner && !isLikelyGuid(owner)) ? owner : "",
    };
    const csvSiteId = (s["Site Id"] ?? s["Site ID"] ?? "").toLowerCase().replace(/^\{|\}$/g, "");
    if (csvSiteId) usageById.set(csvSiteId, entry);
    const urlKey = entry.siteUrl.toLowerCase().replace(/\/+$/, "");
    if (urlKey) usageByUrl.set(urlKey, entry);
    const csvSlug = extractSiteSlug(entry.siteUrl);
    if (csvSlug) usageBySlug.set(normalizeToken(csvSlug), entry);
  }

  const sites: any[] = [];
  const getAllSitesItems = siteDisplayNamesResult.items.filter((s) => !!s.webUrl);

  if (getAllSitesItems.length > 0) {
    for (const site of getAllSitesItems) {
      const siteUrl = site.webUrl;
      if (!/\/(sites|teams)\//i.test(siteUrl)) continue;
      const siteSlug = extractSiteSlug(siteUrl);
      const siteCollGuid = site.id?.split(",")[1]?.toLowerCase().replace(/^\{|\}$/g, "");
      const urlKey = siteUrl.toLowerCase().replace(/\/+$/, "");
      const usage = (siteCollGuid ? usageById.get(siteCollGuid) : undefined) ?? usageByUrl.get(urlKey) ?? (siteSlug ? usageBySlug.get(normalizeToken(siteSlug)) : undefined);
      const assignedTeamName = resolveAssignedTeamName(siteSlug, teamNicknameMap);
      const derivedSiteName = siteSlug && !isLikelyGuid(siteSlug) ? prettifySlug(siteSlug) : "";
      const friendlySiteName = site.displayName || assignedTeamName || derivedSiteName || "Unknown";
      let displayUrl = siteUrl;
      try { displayUrl = decodeURIComponent(siteUrl); } catch { /* keep original */ }
      sites.push({
        name: friendlySiteName, url: displayUrl,
        storageUsedGB: Math.round(((usage?.usedBytes ?? 0) / 1e9) * 1000) / 1000,
        storageAllocatedGB: Math.round(((usage?.allocBytes ?? 0) / 1e9) * 100) / 100,
        lastActivityDate: usage?.lastActivity || null,
        isActive: !!(usage?.lastActivity), pageViews: usage?.pageViews ?? 0,
        filesCount: usage?.fileCount ?? 0, assignedTeamName,
      });
    }
  } else {
    for (const s of siteRows) {
      if ((s["Is Deleted"] ?? "").toLowerCase() === "true") continue;
      const siteUrl = s["Site URL"] ?? "";
      if (!siteUrl) continue;
      const usedBytes = parseInt(s["Storage Used (Byte)"] ?? "0", 10) || 0;
      const allocBytes = parseInt(s["Storage Allocated (Byte)"] ?? "0", 10) || 0;
      const fileCount = parseInt(s["File Count"] ?? "0", 10) || 0;
      const pageViews = parseInt(s["Page View Count"] ?? "0", 10) || 0;
      const lastActivity = s["Last Activity Date"] ?? "";
      const owner = s["Owner Display Name"] ?? "";
      const ownerName = (owner && !isLikelyGuid(owner)) ? owner : "";
      const siteSlug = extractSiteSlug(siteUrl);
      const assignedTeamName = resolveAssignedTeamName(siteSlug, teamNicknameMap);
      const derivedSiteName = siteSlug && !isLikelyGuid(siteSlug) ? prettifySlug(siteSlug) : "";
      const friendlySiteName = assignedTeamName || derivedSiteName || ownerName || "Unknown";
      let displayUrl = siteUrl;
      try { displayUrl = decodeURIComponent(siteUrl); } catch { /* keep original */ }
      sites.push({
        name: friendlySiteName, url: displayUrl,
        storageUsedGB: Math.round((usedBytes / 1e9) * 1000) / 1000,
        storageAllocatedGB: Math.round((allocBytes / 1e9) * 100) / 100,
        lastActivityDate: lastActivity || null, isActive: !!lastActivity,
        pageViews, filesCount: fileCount, assignedTeamName,
      });
    }
  }

  const resolvedTotalSites = totalSites > 0 ? totalSites : getAllSitesItems.filter((s) => /\/(sites|teams)\//i.test(s.webUrl)).length;
  const resolvedActiveSites = activeSites > 0 ? activeSites : sites.filter((s) => s.isActive).length;

  sites.sort((a, b) => b.storageUsedGB - a.storageUsedGB);
  const topSites = sites.slice(0, 50);

  let oneDriveTotalStorageGB = 0, oneDriveUsedStorageGB = 0;
  for (const od of oneDriveRows) {
    if ((od["Is Deleted"] ?? "").toLowerCase() === "true") continue;
    oneDriveTotalStorageGB += (parseInt(od["Storage Allocated (Byte)"] ?? "0", 10) || 0) / 1e9;
    oneDriveUsedStorageGB += (parseInt(od["Storage Used (Byte)"] ?? "0", 10) || 0) / 1e9;
  }

  return {
    totalSites: resolvedTotalSites, activeSites: resolvedActiveSites,
    totalStorageUsedGB: Math.round((totalStorageUsedBytes / 1e9) * 10) / 10,
    totalStorageAllocatedGB: Math.round((totalStorageAllocatedBytes / 1e9) * 10) / 10,
    storageUtilizationPercent: totalStorageAllocatedBytes > 0
      ? Math.round((totalStorageUsedBytes / totalStorageAllocatedBytes) * 100) : 0,
    totalFiles, totalPageViews,
    oneDriveTotalStorageGB: Math.round(oneDriveTotalStorageGB * 10) / 10,
    oneDriveUsedStorageGB: Math.round(oneDriveUsedStorageGB * 10) / 10,
    sites: topSites,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
    _sitesDebug: {
      detailReportRows: siteRows.filter((s) => (s["Is Deleted"] ?? "").toLowerCase() !== "true").length,
      getAllSitesItems: getAllSitesItems.length,
      usageJoined: topSites.filter((s) => s.lastActivityDate !== null || s.storageUsedGB > 0).length,
    },
  };
}

export async function collectSharePointSharing() {
  const sitesResult = await fetchAllGraphPages<{ id: string; webUrl: string }>(
    "https://graph.microsoft.com/v1.0/sites/getAllSites?$select=id,webUrl&$top=100",
    "sharingSummarySiteList",
  );

  const allSites = sitesResult.items.filter((s) => s.webUrl && /\/(sites|teams)\//i.test(s.webUrl));
  const sitesToSample = allSites.slice(0, 10);
  const totalSitesAvailable = allSites.length;

  let totalSharingLinks = 0, orgWideLinks = 0, permissionErrors = 0;

  for (const site of sitesToSample) {
    const result = await fetchGraphJson<{ value: Array<{ id: string; shared?: { scope: string } }> }>(
      `https://graph.microsoft.com/v1.0/sites/${site.id}/drive/root/children?$select=id,shared&$top=200`,
      "sharingSiteDriveItems",
    );
    if (result.issue) {
      if (result.issue.permissionRequired) permissionErrors++;
      continue;
    }
    for (const item of result.data?.value ?? []) {
      if (item.shared && item.shared.scope !== "specificPeople") {
        totalSharingLinks++;
        if (item.shared.scope === "organization") orgWideLinks++;
      }
    }
  }

  return {
    totalSharingLinks, orgWideLinks,
    anonymousLinks: totalSharingLinks - orgWideLinks,
    sampledSites: sitesToSample.length, totalSitesAvailable,
    partialData: sitesResult.partialData || permissionErrors > 0 || sitesToSample.length < totalSitesAvailable,
    permissionError: sitesResult.permissionError || permissionErrors > 0,
  };
}
