import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectCompliance } from "../lib/collectors/compliance.js";

const router = Router();

router.get("/m365/compliance", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-compliance", collectCompliance);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 compliance data");
    res.status(500).json({ error: "Failed to fetch M365 compliance data" });
  }
});

router.get("/m365/compliance/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-compliance", collectCompliance);

    const fieldMetadata = {
      dlpPolicies: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "InformationProtectionPolicy.Read.All" },
      activeDlpPolicies: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "InformationProtectionPolicy.Read.All" },
      retentionPolicies: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceAppManagement.Read.All", notes: ["Proxy count from managed app policies"] },
      sensitivityLabels: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "InformationProtectionPolicy.Read.All" },
      complianceScore: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SecurityEvents.Read.All" },
      complianceScoreMax: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SecurityEvents.Read.All" },
      eDiscoveryCases: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "eDiscovery.Read.All" },
      sensitivityLabelsList: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "InformationProtectionPolicy.Read.All" },
      sensitivityLabelsPermissionRequired: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Derived from labels endpoint permission probe" },
      permissionMetadata: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Static permission manifest" },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 compliance data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 compliance data" });
  }
});

export default router;
