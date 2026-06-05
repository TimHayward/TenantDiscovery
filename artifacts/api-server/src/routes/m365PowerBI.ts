import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectPowerBI } from "../lib/collectors/powerBI.js";

const router = Router();

router.get("/m365/powerbi", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-powerbi", collectPowerBI);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch Power BI data");
    res.status(500).json({ error: "Failed to fetch Power BI data" });
  }
});

router.get("/m365/powerbi/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-powerbi", collectPowerBI);

    const fieldMetadata = {
      available: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Power BI Admin API token acquisition", notes: ["False when Power BI API token cannot be acquired — typically means the service principal lacks Power BI admin consent"] },
      totalWorkspaces: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Power BI Admin API /admin/groups" },
      activeWorkspaces: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Power BI Admin API /admin/groups (state=Active)" },
      orphanedWorkspaces: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Computed from workspace admin user count", notes: ["Workspace is orphaned when no user has groupUserAccessRight=Admin"] },
      personalWorkspaces: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Power BI Admin API (type=PersonalGroup)" },
      dedicatedCapacityWorkspaces: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Power BI Admin API (isOnDedicatedCapacity=true)" },
      totalDatasets: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Power BI Admin API workspaces $expand=datasets" },
      refreshableDatasets: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "isRefreshable flag from Power BI Admin API" },
      totalReports: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Power BI Admin API workspaces $expand=reports" },
      capacities: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Power BI Admin API /admin/capacities" },
      workspaces: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Power BI Admin API /admin/groups", notes: ["Limited to first 200 workspaces; larger tenants may require pagination"] },
      partialData: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when one or more upstream collection calls failed"] },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when collection issues include permission-related failures"] },
      collectionIssues: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["Per-source issue details for failed Power BI API calls"] },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch Power BI data with metadata");
    res.status(500).json({ error: "Failed to fetch Power BI data" });
  }
});

export default router;
