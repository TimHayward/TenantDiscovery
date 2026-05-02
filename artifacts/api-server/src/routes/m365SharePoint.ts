import { Router } from "express";
import { getCached } from "../lib/graphClient.js";

const router = Router();

async function fetchReportCsv(url: string): Promise<string> {
  const { ClientSecretCredential } = await import("@azure/identity");
  const cred = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!
  );
  const token = await cred.getToken("https://graph.microsoft.com/.default");
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token!.token}` },
  });
  if (!resp.ok) return "";
  return resp.text();
}

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

router.get("/m365/sharepoint", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-sharepoint", async () => {
      const [siteUsageCsv, oneDriveCsv] = await Promise.all([
        fetchReportCsv(
          "https://graph.microsoft.com/v1.0/reports/getSharePointSiteUsageDetail(period='D30')"
        ),
        fetchReportCsv(
          "https://graph.microsoft.com/v1.0/reports/getOneDriveUsageAccountDetail(period='D30')"
        ),
      ]);

      const siteRows = parseCsv(siteUsageCsv);
      const oneDriveRows = parseCsv(oneDriveCsv);

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
        const allocBytes =
          parseInt(s["Storage Allocated (Byte)"] ?? "0", 10) || 0;
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
            ? Math.round(
                (totalStorageUsedBytes / totalStorageAllocatedBytes) * 100
              )
            : 0,
        totalFiles,
        totalPageViews,
        oneDriveTotalStorageGB: Math.round(oneDriveTotalStorageGB * 10) / 10,
        oneDriveUsedStorageGB: Math.round(oneDriveUsedStorageGB * 10) / 10,
        sites: topSites,
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 SharePoint data");
    res.status(500).json({ error: "Failed to fetch M365 SharePoint data" });
  }
});

export default router;
