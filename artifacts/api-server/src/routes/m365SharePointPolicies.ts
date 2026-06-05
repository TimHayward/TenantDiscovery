import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectSharePointPolicies } from "../lib/collectors/sharePointPolicies.js";

const router = Router();

router.get("/m365/sharepoint/policies", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-sharepoint-policies", collectSharePointPolicies);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 SharePoint policies data");
    res.status(500).json({ error: "Failed to fetch M365 SharePoint policies data" });
  }
});

router.get("/m365/sharepoint/policies/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-sharepoint-policies", collectSharePointPolicies);

    const fieldMetadata = {
      sharingCapability: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SharePointTenantSettings.Read.All" },
      oneDriveSharingCapability: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SharePointTenantSettings.Read.All" },
      sharingDomainRestrictionMode: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SharePointTenantSettings.Read.All" },
      sharingAllowedDomainCount: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SharePointTenantSettings.Read.All" },
      sharingBlockedDomainCount: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SharePointTenantSettings.Read.All" },
      defaultSharingLinkType: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SharePointTenantSettings.Read.All" },
      defaultLinkPermission: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SharePointTenantSettings.Read.All" },
      anyoneLinkExpirationInDays: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SharePointTenantSettings.Read.All" },
      policyPermissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when settings collection failed due to missing Graph permission"] },
      partialData: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics" },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics" },
      collectionIssues: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics" },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 SharePoint policies data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 SharePoint policies data" });
  }
});

export default router;
