import { Router } from "express";
import { getCached } from "../lib/graphClient.js";
import {
  fetchGraphText,
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

async function getSharePointData() {
  return getCached("m365-sharepoint", async () => {
    const [siteUsageCsvResult, oneDriveCsvResult] = await Promise.all([
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageDetail(period='D30')",
        "sharePointSiteUsageReport",
      ),
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getOneDriveUsageAccountDetail(period='D30')",
        "oneDriveUsageAccountReport",
      ),
    ]);

    const collectionIssues: CollectionIssue[] = [];
    if (siteUsageCsvResult.issue) collectionIssues.push(siteUsageCsvResult.issue);
    if (oneDriveCsvResult.issue) collectionIssues.push(oneDriveCsvResult.issue);

    const siteRows = parseCsv(siteUsageCsvResult.text ?? "");
    const oneDriveRows = parseCsv(oneDriveCsvResult.text ?? "");

    let totalSites = 0;
    let activeSites = 0;
    let totalStorageUsedBytes = 0;
    let totalStorageAllocatedBytes = 0;
    let totalFiles = 0;
    let totalPageViews = 0;

    const sites: any[] = [];

    for (const s of siteRows) {
      if (s["Is Deleted"] === "True") continue;
      totalSites++;

      const usedBytes = parseInt(s["Storage Used (Byte)"] ?? "0", 10) || 0;
      const allocBytes = parseInt(s["Storage Allocated (Byte)"] ?? "0", 10) || 0;
      const fileCount = parseInt(s["File Count"] ?? "0", 10) || 0;
      const pageViews = parseInt(s["Page View Count"] ?? "0", 10) || 0;
      const lastActivity = s["Last Activity Date"] ?? "";
      const isActive = !!lastActivity;

      if (isActive) activeSites++;
      totalStorageUsedBytes += usedBytes;
      totalStorageAllocatedBytes += allocBytes;
      totalFiles += fileCount;
      totalPageViews += pageViews;

      const siteUrl = s["Site URL"] ?? "";
      const owner = s["Owner Display Name"] ?? "";

      sites.push({
        name: siteUrl
          ? siteUrl.split("/").filter(Boolean).pop() ?? siteUrl
          : owner || "Unknown",
        url: siteUrl,
        storageUsedGB: Math.round((usedBytes / 1e9) * 1000) / 1000,
        storageAllocatedGB: Math.round((allocBytes / 1e9) * 100) / 100,
        lastActivityDate: lastActivity || null,
        isActive,
        pageViews,
        filesCount: fileCount,
      });
    }

    sites.sort((a, b) => b.storageUsedGB - a.storageUsedGB);
    const topSites = sites.slice(0, 50);

    let oneDriveTotalStorageGB = 0;
    let oneDriveUsedStorageGB = 0;
    for (const od of oneDriveRows) {
      if (od["Is Deleted"] === "True") continue;
      oneDriveTotalStorageGB +=
        (parseInt(od["Storage Allocated (Byte)"] ?? "0", 10) || 0) / 1e9;
      oneDriveUsedStorageGB +=
        (parseInt(od["Storage Used (Byte)"] ?? "0", 10) || 0) / 1e9;
    }

    return {
      totalSites,
      activeSites,
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
    };
  });
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

export default router;
