import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";

const router = Router();

router.get("/m365/sharepoint", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-sharepoint", async () => {
      const [siteStorageRes, siteActivityRes, oneDriveRes] = await Promise.allSettled([
        graphClient.api("/reports/getSharePointSiteUsageDetail(period='D30')").header("Accept", "application/json").get(),
        graphClient.api("/reports/getSharePointActivityUserDetail(period='D30')").header("Accept", "application/json").get(),
        graphClient.api("/reports/getOneDriveUsageAccountDetail(period='D30')").header("Accept", "application/json").get(),
      ]);

      const siteRows = siteStorageRes.status === "fulfilled" ? siteStorageRes.value?.value ?? [] : [];
      const activityRows = siteActivityRes.status === "fulfilled" ? siteActivityRes.value?.value ?? [] : [];
      const oneDriveRows = oneDriveRes.status === "fulfilled" ? oneDriveRes.value?.value ?? [] : [];

      let totalSites = siteRows.length;
      let activeSites = 0;
      let totalStorageUsedBytes = 0;
      let totalStorageAllocatedBytes = 0;
      let totalFiles = 0;
      let totalPageViews = 0;

      const sites = siteRows.slice(0, 50).map((s: any) => {
        const usedBytes = s.storageUsedInBytes ?? 0;
        const allocBytes = s.storageAllocatedInBytes ?? 0;
        const isActive = !s.isDeleted && (s.lastActivityDate !== null);

        if (isActive) activeSites++;
        totalStorageUsedBytes += usedBytes;
        totalStorageAllocatedBytes += allocBytes;
        totalFiles += s.fileCount ?? 0;
        totalPageViews += s.pageViewCount ?? 0;

        return {
          name: s.siteUrl?.split("/").pop() ?? s.siteUrl ?? "Unknown",
          url: s.siteUrl ?? "",
          storageUsedGB: Math.round((usedBytes / 1e9) * 100) / 100,
          storageAllocatedGB: Math.round((allocBytes / 1e9) * 100) / 100,
          lastActivityDate: s.lastActivityDate ?? null,
          isActive,
          pageViews: s.pageViewCount ?? 0,
          filesCount: s.fileCount ?? 0,
        };
      });

      let oneDriveTotalStorageGB = 0;
      let oneDriveUsedStorageGB = 0;
      for (const od of oneDriveRows) {
        oneDriveTotalStorageGB += (od.storageAllocatedInBytes ?? 0) / 1e9;
        oneDriveUsedStorageGB += (od.storageUsedInBytes ?? 0) / 1e9;
      }

      return {
        totalSites,
        activeSites,
        totalStorageUsedGB: Math.round((totalStorageUsedBytes / 1e9) * 10) / 10,
        totalStorageAllocatedGB: Math.round((totalStorageAllocatedBytes / 1e9) * 10) / 10,
        storageUtilizationPercent: totalStorageAllocatedBytes > 0
          ? Math.round((totalStorageUsedBytes / totalStorageAllocatedBytes) * 100)
          : 0,
        totalFiles,
        totalPageViews,
        oneDriveTotalStorageGB: Math.round(oneDriveTotalStorageGB * 10) / 10,
        oneDriveUsedStorageGB: Math.round(oneDriveUsedStorageGB * 10) / 10,
        sites,
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 SharePoint data");
    res.status(500).json({ error: "Failed to fetch M365 SharePoint data" });
  }
});

export default router;
