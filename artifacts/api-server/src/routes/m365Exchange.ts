import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectExchange } from "../lib/collectors/exchange.js";

const router = Router();

router.get("/m365/exchange", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-exchange", collectExchange);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Exchange data");
    res.status(500).json({ error: "Failed to fetch M365 Exchange data" });
  }
});

router.get("/m365/exchange/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-exchange", collectExchange);

    const fieldMetadata = {
      totalMailboxes: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      activeMailboxes: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      sharedMailboxes: { evidenceStatus: "manual" as const, confidenceLabel: "unknown" as const, sourceLabel: "Not currently derived from report CSV" },
      roomMailboxes: { evidenceStatus: "manual" as const, confidenceLabel: "unknown" as const, sourceLabel: "Not currently derived from report CSV" },
      totalStorageUsedGB: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      totalStorageAllocatedGB: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      storageUtilizationPercent: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Calculated from mailbox storage metrics" },
      mailboxSizeDistribution: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Derived from mailbox usage report rows" },
      emailActivityLast30Days: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Reports.Read.All" },
      quarantinedMessages: { evidenceStatus: "manual" as const, confidenceLabel: "unknown" as const, sourceLabel: "Placeholder metric" },
      malwareDetected: { evidenceStatus: "manual" as const, confidenceLabel: "unknown" as const, sourceLabel: "Placeholder metric" },
      spamFiltered: { evidenceStatus: "manual" as const, confidenceLabel: "unknown" as const, sourceLabel: "Placeholder metric" },
      partialData: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when one or more upstream collection calls failed"] },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when collection issues include permission-related failures"] },
      collectionIssues: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["Per-source issue details for failed Graph report calls"] },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Exchange data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 Exchange data" });
  }
});

export default router;
