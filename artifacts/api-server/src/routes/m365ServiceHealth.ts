import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectServiceHealth } from "../lib/collectors/serviceHealth.js";

const router = Router();

router.get("/m365/service-health", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-service-health", collectServiceHealth);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 service health");
    res.status(500).json({ error: "Failed to fetch M365 service health" });
  }
});

router.get("/m365/service-health/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-service-health", collectServiceHealth);

    const fieldMetadata = {
      overallStatus: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "ServiceHealth.Read.All", notes: ["Derived from health overview status and issues count. Source: Graph /admin/serviceAnnouncement endpoints"] },
      servicesHealthy: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "ServiceHealth.Read.All", notes: ["Count of services with operational status. Direct count from Graph API."] },
      servicesWithIssues: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "ServiceHealth.Read.All", notes: ["Count of services with non-operational status or active issues. Direct count from Graph API."] },
      totalServices: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "ServiceHealth.Read.All", notes: ["Total count of monitored services. Source: /admin/serviceAnnouncement/healthOverviews"] },
      activeIncidents: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "ServiceHealth.Read.All", notes: ["Count of unresolved issues classified as incidents. Source: /admin/serviceAnnouncement/issues with isResolved=false"] },
      activeAdvisories: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "ServiceHealth.Read.All", notes: ["Count of unresolved issues classified as advisories. Source: /admin/serviceAnnouncement/issues with isResolved=false"] },
      partialData: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when one or more upstream collection calls failed"] },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when collection issues include permission-related failures"] },
      collectionIssues: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["Per-source issue details for failed Graph collection calls"] },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 service health with metadata");
    res.status(500).json({ error: "Failed to fetch M365 service health" });
  }
});

export default router;
