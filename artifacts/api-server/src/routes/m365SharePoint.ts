import { Router } from "express";
import { cache } from "../lib/graphClient.js";
import {
  fetchAllGraphPages,
  fetchGraphJson,
  fetchGraphText,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();
const spInflight = new Map<string, Promise<unknown>>();
const spSharingInflight = new Map<string, Promise<unknown>>();

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

function normalizeToken(value: string): string {
  return decodeURIComponent(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function stripGuidSuffix(value: string): string {
  return value
    .replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "")
    .replace(/-[0-9a-f]{32}$/i, "");
}

function isLikelyGuid(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    /^[0-9a-f]{32}$/i.test(value)
  );
}

function prettifySlug(slug: string): string {
  return stripGuidSuffix(decodeURIComponent(slug))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSiteSlug(siteUrl: string): string | null {
  const siteSlugMatch = siteUrl.match(/\/(?:sites|teams)\/([^/]+)/i);
  return siteSlugMatch ? siteSlugMatch[1] : null;
}

function resolveAssignedTeamName(
  siteSlug: string | null,
  teamNicknameMap: Map<string, string>,
): string | null {
  if (!siteSlug) return null;

  const normalized = normalizeToken(siteSlug);
  const normalizedWithoutGuid = normalizeToken(stripGuidSuffix(siteSlug));

  const exact =
    teamNicknameMap.get(normalized) ??
    teamNicknameMap.get(normalizedWithoutGuid);
  if (exact) return exact;

  for (const [key, teamName] of teamNicknameMap.entries()) {
    if (normalized.startsWith(key) || normalizedWithoutGuid.startsWith(key)) {
      return teamName;
    }
  }

  return null;
}

// Return the most recent row from a summary report that matches an optional Site Type filter.
// Summary reports (site counts, file counts) have one row per date × site type combination;
// the last matching row is the most recent because Graph returns rows oldest-first.
function latestSummaryRow(
  rows: Record<string, string>[],
  siteTypeValue?: string,
): Record<string, string> | null {
  if (!rows.length) return null;
  if (!siteTypeValue) return rows[rows.length - 1];
  const matches = rows.filter(
    (r) => (r["Site Type"] ?? "").toLowerCase() === siteTypeValue.toLowerCase(),
  );
  return matches.length ? matches[matches.length - 1] : rows[rows.length - 1];
}

async function computeSharePointData() {
    const [
      siteUsageCsvResult,
      siteCountsCsvResult,
      storageCsvResult,
      fileCountsCsvResult,
      oneDriveCsvResult,
      teamGroupsResult,
      siteDisplayNamesResult,
    ] = await Promise.all([
      // Per-site detail report — used for the site table only.
      // NOTE: this report only includes sites with activity in the period, so it must NOT
      // be used for summary KPI totals (it returns 0 rows for low-activity tenants).
      // D180 window used here (vs D30 for KPI aggregates) to capture sites that may have
      // had no activity in the last 90 days but were active within the last 6 months.
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageDetail(period='D180')",
        "sharePointSiteUsageReport",
      ),
      // Aggregate site counts — includes ALL sites regardless of recent activity.
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageSiteCounts(period='D30')",
        "sharePointSiteUsageSiteCounts",
      ),
      // Aggregate storage — total storage across all sites.
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageStorage(period='D30')",
        "sharePointSiteUsageStorage",
      ),
      // Aggregate file counts — total files across all sites.
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageFileCounts(period='D30')",
        "sharePointSiteUsageFileCounts",
      ),
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getOneDriveUsageAccountDetail(period='D30')",
        "oneDriveUsageAccountReport",
      ),
      fetchAllGraphPages<{ id: string; displayName: string; mailNickname: string }>(
        "https://graph.microsoft.com/v1.0/groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select=id,displayName,mailNickname&$top=999",
        "teamGroupsForSPCorrelation",
      ),
      // Best-effort: fetch actual site display names via getAllSites (requires Sites.Read.All).
      // getAllSites enumerates all sites regardless of activity — unlike $search which needs a keyword.
      // id is included so we can match by siteCollectionGuid against the CSV "Site Id" column,
      // which is more reliable than URL matching (CSV may use classic GUID URLs, getAllSites returns modern URLs).
      // Failures are silently ignored — slug-based logic is used as fallback.
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
    // siteDisplayNamesResult issues are intentionally not added — it is best-effort only

    // siteDisplayNamesResult.items is consumed directly in the per-site loop below.

    // Build normalized mailNickname/displayName lookup for team-backed sites
    const teamNicknameMap = new Map<string, string>();
    for (const g of teamGroupsResult.items) {
      if (g.mailNickname) {
        const displayName = g.displayName ?? g.mailNickname;
        teamNicknameMap.set(normalizeToken(g.mailNickname), displayName);
        teamNicknameMap.set(normalizeToken(stripGuidSuffix(g.mailNickname)), displayName);
        if (g.displayName) {
          teamNicknameMap.set(normalizeToken(g.displayName), g.displayName);
        }
      }
    }

    // --- KPI values from aggregate reports (reliable for all tenants) ---

    const siteCountRows = parseCsv(siteCountsCsvResult.text ?? "");
    // Site counts report has rows per date × site type; pick the most recent "All" row.
    const siteCountRow = latestSummaryRow(siteCountRows, "All") ?? latestSummaryRow(siteCountRows);
    const totalSites = parseInt(
      siteCountRow?.["Total"] ?? siteCountRow?.["Site Count"] ?? "0", 10
    ) || 0;
    const activeSites = parseInt(
      siteCountRow?.["Active"] ?? siteCountRow?.["Active Site Count"] ?? "0", 10
    ) || 0;

    const storageRows = parseCsv(storageCsvResult.text ?? "");
    const storageRow = latestSummaryRow(storageRows);
    const totalStorageUsedBytes = parseInt(storageRow?.["Storage Used (Byte)"] ?? "0", 10) || 0;
    const totalStorageAllocatedBytes = parseInt(storageRow?.["Storage Allocated (Byte)"] ?? "0", 10) || 0;

    const fileCountRows = parseCsv(fileCountsCsvResult.text ?? "");
    // File counts report has rows per date × site type; pick the most recent "All" row.
    const fileCountRow = latestSummaryRow(fileCountRows, "All") ?? latestSummaryRow(fileCountRows);
    // Column may be "Total" or "File Count" depending on tenant/version
    const totalFiles =
      parseInt(fileCountRow?.["Total"] ?? fileCountRow?.["File Count"] ?? "0", 10) || 0;

    // --- Per-site table: getAllSites is the authoritative list; detail report provides metrics ---
    //
    // Architecture: getAllSites always returns every site with its correct displayName.
    // The D90 detail report has usage metrics but its URLs may use classic/GUID paths that
    // don't match getAllSites webUrls.  We join the two by siteCollectionGuid:
    //   Graph compound id  →  "hostname,siteCollGuid,webGuid"  →  split(",")[1]
    //   CSV "Site Id"      →  siteCollGuid directly
    // If getAllSites is unavailable we fall back to the detail report rows alone.

    const siteRows = parseCsv(siteUsageCsvResult.text ?? "");
    const oneDriveRows = parseCsv(oneDriveCsvResult.text ?? "");

    // Step 1 – index the detail report by siteCollGuid, URL, and slug so any can match.
    // Three keys handle: (a) ID format differences, (b) classic vs modern URL paths,
    // (c) /sites/ vs /teams/ prefix differences.
    interface UsageEntry {
      usedBytes: number; allocBytes: number; fileCount: number;
      pageViews: number; lastActivity: string; siteUrl: string; ownerName: string;
    }
    const usageById   = new Map<string, UsageEntry>();
    const usageByUrl  = new Map<string, UsageEntry>();
    const usageBySlug = new Map<string, UsageEntry>();
    let totalPageViews = 0;
    for (const s of siteRows) {
      if ((s["Is Deleted"] ?? "").toLowerCase() === "true") continue;
      const pageViews = parseInt(s["Page View Count"] ?? "0", 10) || 0;
      totalPageViews += pageViews;
      const owner = s["Owner Display Name"] ?? "";
      const entry: UsageEntry = {
        usedBytes:    parseInt(s["Storage Used (Byte)"]      ?? "0", 10) || 0,
        allocBytes:   parseInt(s["Storage Allocated (Byte)"] ?? "0", 10) || 0,
        fileCount:    parseInt(s["File Count"]               ?? "0", 10) || 0,
        pageViews,
        lastActivity: s["Last Activity Date"] ?? "",
        siteUrl:      s["Site URL"]           ?? "",
        ownerName:    (owner && !isLikelyGuid(owner)) ? owner : "",
      };
      // Strip curly braces — SharePoint CSV sometimes encodes GUIDs as {abc-...}
      const csvSiteId = (s["Site Id"] ?? s["Site ID"] ?? "")
        .toLowerCase()
        .replace(/^\{|\}$/g, "");
      if (csvSiteId) usageById.set(csvSiteId, entry);
      const urlKey = entry.siteUrl.toLowerCase().replace(/\/+$/, "");
      if (urlKey) usageByUrl.set(urlKey, entry);
      const csvSlug = extractSiteSlug(entry.siteUrl);
      if (csvSlug) usageBySlug.set(normalizeToken(csvSlug), entry);
    }

    // Step 2 – build the site list.
    const sites: any[] = [];
    const getAllSitesItems = siteDisplayNamesResult.items.filter(s => !!s.webUrl);

    if (getAllSitesItems.length > 0) {
      // Primary path: getAllSites provides the site list + display names.
      // Look up usage metrics by siteCollGuid, falling back to URL match.
      for (const site of getAllSitesItems) {
        const siteUrl = site.webUrl;
        if (!/\/(sites|teams)\//i.test(siteUrl)) continue; // skip root / system sites

        const siteSlug = extractSiteSlug(siteUrl);
        const siteCollGuid = site.id?.split(",")[1]?.toLowerCase().replace(/^\{|\}$/g, "");
        const urlKey = siteUrl.toLowerCase().replace(/\/+$/, "");
        const usage =
          (siteCollGuid ? usageById.get(siteCollGuid) : undefined) ??
          usageByUrl.get(urlKey) ??
          (siteSlug ? usageBySlug.get(normalizeToken(siteSlug)) : undefined);
        const assignedTeamName = resolveAssignedTeamName(siteSlug, teamNicknameMap);
        const derivedSiteName = siteSlug && !isLikelyGuid(siteSlug) ? prettifySlug(siteSlug) : "";
        const friendlySiteName = site.displayName || assignedTeamName || derivedSiteName || "Unknown";

        let displayUrl = siteUrl;
        try { displayUrl = decodeURIComponent(siteUrl); } catch { /* keep original */ }

        sites.push({
          name:               friendlySiteName,
          url:                displayUrl,
          storageUsedGB:      Math.round(((usage?.usedBytes  ?? 0) / 1e9) * 1000) / 1000,
          storageAllocatedGB: Math.round(((usage?.allocBytes ?? 0) / 1e9) * 100)  / 100,
          lastActivityDate:   usage?.lastActivity || null,
          isActive:           !!(usage?.lastActivity),
          pageViews:          usage?.pageViews  ?? 0,
          filesCount:         usage?.fileCount  ?? 0,
          assignedTeamName,
        });
      }
    } else {
      // Fallback: getAllSites unavailable — build the list from the detail report.
      // Names are best-effort (teams + slug derivation only; no Graph display names).
      for (const s of siteRows) {
        if ((s["Is Deleted"] ?? "").toLowerCase() === "true") continue;
        const siteUrl = s["Site URL"] ?? "";
        if (!siteUrl) continue;

        const usedBytes    = parseInt(s["Storage Used (Byte)"]      ?? "0", 10) || 0;
        const allocBytes   = parseInt(s["Storage Allocated (Byte)"] ?? "0", 10) || 0;
        const fileCount    = parseInt(s["File Count"]               ?? "0", 10) || 0;
        const pageViews    = parseInt(s["Page View Count"]          ?? "0", 10) || 0;
        const lastActivity = s["Last Activity Date"] ?? "";
        const owner        = s["Owner Display Name"] ?? "";
        const ownerName    = (owner && !isLikelyGuid(owner)) ? owner : "";

        const siteSlug = extractSiteSlug(siteUrl);
        const assignedTeamName = resolveAssignedTeamName(siteSlug, teamNicknameMap);
        const derivedSiteName = siteSlug && !isLikelyGuid(siteSlug) ? prettifySlug(siteSlug) : "";
        const friendlySiteName = assignedTeamName || derivedSiteName || ownerName || "Unknown";

        let displayUrl = siteUrl;
        try { displayUrl = decodeURIComponent(siteUrl); } catch { /* keep original */ }

        sites.push({
          name:               friendlySiteName,
          url:                displayUrl,
          storageUsedGB:      Math.round((usedBytes  / 1e9) * 1000) / 1000,
          storageAllocatedGB: Math.round((allocBytes / 1e9) * 100)  / 100,
          lastActivityDate:   lastActivity || null,
          isActive:           !!lastActivity,
          pageViews,
          filesCount:         fileCount,
          assignedTeamName,
        });
      }
    }

    // Fallback: if the aggregate site count report returned 0 (failed or missing column),
    // derive counts from getAllSites data which is already fetched for display names.
    const resolvedTotalSites = totalSites > 0
      ? totalSites
      : getAllSitesItems.filter(s => /\/(sites|teams)\//i.test(s.webUrl)).length;
    const resolvedActiveSites = activeSites > 0
      ? activeSites
      : sites.filter(s => s.isActive).length;

    sites.sort((a, b) => b.storageUsedGB - a.storageUsedGB);
    const topSites = sites.slice(0, 50);

    let oneDriveTotalStorageGB = 0;
    let oneDriveUsedStorageGB = 0;
    for (const od of oneDriveRows) {
      if ((od["Is Deleted"] ?? "").toLowerCase() === "true") continue;
      oneDriveTotalStorageGB +=
        (parseInt(od["Storage Allocated (Byte)"] ?? "0", 10) || 0) / 1e9;
      oneDriveUsedStorageGB +=
        (parseInt(od["Storage Used (Byte)"] ?? "0", 10) || 0) / 1e9;
    }

    return {
      totalSites: resolvedTotalSites,
      activeSites: resolvedActiveSites,
      totalStorageUsedGB: Math.round((totalStorageUsedBytes / 1e9) * 10) / 10,
      totalStorageAllocatedGB:
        Math.round((totalStorageAllocatedBytes / 1e9) * 10) / 10,
      storageUtilizationPercent:
        totalStorageAllocatedBytes > 0
          ? Math.round((totalStorageUsedBytes / totalStorageAllocatedBytes) * 100)
          : 0,
      totalFiles,
      totalPageViews,
      oneDriveTotalStorageGB: Math.round(oneDriveTotalStorageGB * 10) / 10,
      oneDriveUsedStorageGB: Math.round(oneDriveUsedStorageGB * 10) / 10,
      sites: topSites,
      partialData: collectionIssues.length > 0,
      permissionError: collectionIssues.some(isPermissionIssue),
      collectionIssues,
      _sitesDebug: {
        detailReportRows: siteRows.filter(s => (s["Is Deleted"] ?? "").toLowerCase() !== "true").length,
        getAllSitesItems: getAllSitesItems.length,
        usageJoined: topSites.filter(s => s.lastActivityDate !== null || s.storageUsedGB > 0).length,
      },
    };
}

async function getSharePointData() {
  const CACHE_KEY = "m365-sharepoint";

  const hit = cache.get(CACHE_KEY);
  if (hit !== undefined) return hit as Awaited<ReturnType<typeof computeSharePointData>>;

  if (spInflight.has(CACHE_KEY)) {
    return spInflight.get(CACHE_KEY) as Promise<Awaited<ReturnType<typeof computeSharePointData>>>;
  }

  const promise = computeSharePointData()
    .then((result) => {
      const hasGoodData =
        (result._sitesDebug?.usageJoined ?? 0) > 0 &&
        result.totalSites > 0;
      const ttl = hasGoodData ? 1800 : 60;
      cache.set(CACHE_KEY, result, ttl);
      return result;
    })
    .finally(() => spInflight.delete(CACHE_KEY));

  spInflight.set(CACHE_KEY, promise);
  return promise;
}

router.get("/m365/sharepoint", async (req, res): Promise<void> => {
  try {
    const data = await getSharePointData();

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 SharePoint data");
    res.status(500).json({ error: "Failed to fetch M365 SharePoint data" });
  }
});

router.get("/m365/sharepoint/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getSharePointData();

    const fieldMetadata = {
      totalSites: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
      },
      activeSites: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
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
        sourceLabel: "Calculated from site storage totals",
      },
      totalFiles: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
      },
      totalPageViews: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
      },
      oneDriveTotalStorageGB: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Reports.Read.All",
      },
      oneDriveUsedStorageGB: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Reports.Read.All",
      },
      sites: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Top sites derived from usage report",
      },
      assignedTeamName: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Group.Read.All",
        notes: ["Correlated from team-backed groups via mailNickname to site URL slug"],
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
    req.log.error({ err }, "Failed to fetch M365 SharePoint data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 SharePoint data" });
  }
});

interface SharingSummary {
  totalSharingLinks: number;
  orgWideLinks: number;
  anonymousLinks: number;
  sampledSites: number;
  totalSitesAvailable: number;
  partialData: boolean;
  permissionError: boolean;
}

async function computeSharingSummary(): Promise<SharingSummary> {
  // If the main SharePoint data fetch is in-flight (same page load), wait for it to
  // complete before making any Graph calls. Both endpoints fire simultaneously on first
  // load; without this, concurrent calls throttle the storage/site-count report requests.
  if (spInflight.has("m365-sharepoint")) {
    await (spInflight.get("m365-sharepoint") as Promise<unknown>).catch(() => {});
  }

  const sitesResult = await fetchAllGraphPages<{ id: string; webUrl: string }>(
    "https://graph.microsoft.com/v1.0/sites/getAllSites?$select=id,webUrl&$top=100",
    "sharingSummarySiteList",
  );

  const allSites = sitesResult.items.filter(
    (s) => s.webUrl && /\/(sites|teams)\//i.test(s.webUrl),
  );
  // Limit to 10 sites and process sequentially to avoid Graph API throttling.
  // Firing 60 parallel calls (30 sites × 2) saturates rate limits and breaks
  // concurrent storage/site-count report calls.
  const sitesToSample = allSites.slice(0, 10);
  const totalSitesAvailable = allSites.length;

  let totalSharingLinks = 0;
  let orgWideLinks = 0;
  let anonymousLinks = 0;
  let permissionErrors = 0;

  for (const site of sitesToSample) {
    // Use the `shared` facet (a regular property) instead of $expand=permissions.
    // $expand=permissions on collection endpoints silently returns empty arrays for
    // sharing-link type permissions; the `shared` facet reliably reflects active sharing.
    const result = await fetchGraphJson<{
      value: Array<{ id: string; shared?: { scope: string } }>;
    }>(
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
    totalSharingLinks,
    orgWideLinks,
    anonymousLinks: totalSharingLinks - orgWideLinks,
    sampledSites: sitesToSample.length,
    totalSitesAvailable,
    partialData:
      sitesResult.partialData ||
      permissionErrors > 0 ||
      sitesToSample.length < totalSitesAvailable,
    permissionError: sitesResult.permissionError || permissionErrors > 0,
  };
}

async function getSharingSummary(): Promise<SharingSummary> {
  const CACHE_KEY = "m365-sharepoint-sharing";

  const hit = cache.get(CACHE_KEY);
  if (hit !== undefined) return hit as SharingSummary;

  if (spSharingInflight.has(CACHE_KEY)) {
    return spSharingInflight.get(CACHE_KEY) as Promise<SharingSummary>;
  }

  const promise = computeSharingSummary()
    .then((result) => {
      const ttl = result.partialData && result.totalSharingLinks === 0 ? 60 : 1800;
      cache.set(CACHE_KEY, result, ttl);
      return result;
    })
    .finally(() => spSharingInflight.delete(CACHE_KEY));

  spSharingInflight.set(CACHE_KEY, promise);
  return promise;
}

router.get("/m365/sharepoint/sharing-summary", async (req, res): Promise<void> => {
  try {
    const data = await getSharingSummary();
    res.json({ data });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch SharePoint sharing summary");
    res.status(500).json({ error: "Failed to fetch SharePoint sharing summary" });
  }
});

export default router;
