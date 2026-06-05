import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectLicenses } from "../lib/collectors/licenses.js";

const router = Router();

router.get("/m365/licenses", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-licenses", collectLicenses);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 licenses");
    res.status(500).json({ error: "Failed to fetch M365 licenses" });
  }
});

router.get("/m365/licenses/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-licenses", collectLicenses);

    const fieldMetadata = {
      totalLicenses: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Organization.Read.All", notes: ["Sum of all subscribed SKU prepaid units (enabled). Source: Graph /subscribedSkus"] },
      assignedLicenses: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Organization.Read.All", notes: ["Sum of all consumed units across SKUs. Source: Graph /subscribedSkus"] },
      availableLicenses: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Organization.Read.All", notes: ["Calculated as total - assigned. Direct measurement."] },
      utilizationPercent: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Organization.Read.All", notes: ["Percentage of assigned / total licenses. Direct calculation from API metrics."] },
      partialData: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when one or more upstream collection calls failed"] },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when collection issues include permission-related failures"] },
      collectionIssues: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["Per-source issue details for failed Graph collection calls"] },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 licenses with metadata");
    res.status(500).json({ error: "Failed to fetch M365 licenses" });
  }
});

export default router;
