import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectServicePrincipals } from "../lib/collectors/servicePrincipals.js";

const router = Router();

router.get("/m365/service-principals", async (req, res) => {
  try {
    const data = await getOrFetch("m365-service-principals", collectServicePrincipals);
    return res.json(data);
  } catch (err) {
    req.log.error(err, "Error fetching service principals");
    return res.status(500).json({ error: "Failed to fetch service principals" });
  }
});

router.get("/m365/service-principals/with-metadata", async (req, res) => {
  try {
    const data = await getOrFetch("m365-service-principals", collectServicePrincipals);

    const fieldMetadata = {
      total: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Application.Read.All" },
      applicationCount: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Application.Read.All" },
      managedIdentityCount: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Application.Read.All" },
      thirdPartyCount: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Derived from publisher and app identifiers" },
      withHighRiskGrants: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Delegated grant scope analysis" },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "HTTP status from Graph API" },
      servicePrincipals: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Service principal inventory and grant joins" },
      permissionMetadata: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Static permission manifest" },
    };

    return res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error(err, "Error fetching service principals with metadata");
    return res.status(500).json({ error: "Failed to fetch service principals" });
  }
});

export default router;
