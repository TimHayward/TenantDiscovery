import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectSharePoint, collectSharePointSharing } from "../lib/collectors/sharePoint.js";

const router = Router();

router.get("/m365/sharepoint", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-sharepoint", collectSharePoint);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 SharePoint data");
    res.status(500).json({ error: "Failed to fetch M365 SharePoint data" });
  }
});

router.get("/m365/sharepoint/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-sharepoint", collectSharePoint);

    const fieldMetadata = {
      totalSites: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      activeSites: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      totalStorageUsedGB: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      totalStorageAllocatedGB: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      storageUtilizationPercent: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Calculated from site storage totals" },
      totalFiles: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      totalPageViews: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      oneDriveTotalStorageGB: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Reports.Read.All" },
      oneDriveUsedStorageGB: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Reports.Read.All" },
      sites: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Top sites derived from usage report" },
      partialData: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when one or more upstream collection calls failed"] },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when collection issues include permission-related failures"] },
      collectionIssues: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["Per-source issue details for failed Graph report calls"] },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 SharePoint data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 SharePoint data" });
  }
});

router.get("/m365/sharepoint/sharing-summary", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-sharepoint-sharing", collectSharePointSharing);
    res.json({ data });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch SharePoint sharing summary");
    res.status(500).json({ error: "Failed to fetch SharePoint sharing summary" });
  }
});

export default router;
