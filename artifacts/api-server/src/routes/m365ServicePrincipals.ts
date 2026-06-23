import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectServicePrincipals } from "../lib/collectors/servicePrincipals.js";
import { createCollectionIssue, getErrorMessage, getErrorStatus } from "../lib/collectionIssues.js";

const router = Router();

// Zeroed fallback (with a 200) so the dashboard renders an explicit error state
// rather than a dead tab when the collector throws outright.
function spFallback(err: unknown) {
  const issue = createCollectionIssue("servicePrincipalsRoute", getErrorStatus(err), getErrorMessage(err));
  return {
    total: 0, applicationCount: 0, managedIdentityCount: 0, microsoftOwnedCount: 0,
    thirdPartyCount: 0, disabledCount: 0, withHighRiskGrants: 0,
    permissionError: issue.permissionRequired, servicePrincipals: [], permissionMetadata: null,
    partialData: true, collectionIssues: [issue],
  };
}

router.get("/m365/service-principals", async (req, res) => {
  try {
    const data = await getOrFetch("m365-service-principals", collectServicePrincipals);
    return res.json(data);
  } catch (err) {
    req.log.error(err, "Error fetching service principals");
    return res.status(200).json(spFallback(err));
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
