import { Router } from "express";
import { getCached } from "../lib/graphClient.js";
import {
  fetchGraphJson,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

interface SharePointSettingsResponse {
  sharingCapability?: string;
  oneDriveSharingCapability?: string;
  sharingDomainRestrictionMode?: string;
  sharingAllowedDomainList?: string[];
  sharingBlockedDomainList?: string[];
  defaultSharingLinkType?: string;
  defaultLinkPermission?: string;
  anyoneLinkExpirationInDays?: number;
}

async function getSharePointPoliciesData() {
  return getCached("m365-sharepoint-policies", async () => {
    const settings = await fetchGraphJson<SharePointSettingsResponse>(
      "https://graph.microsoft.com/v1.0/admin/sharepoint/settings",
      "sharePointSettings",
    );

    const collectionIssues: CollectionIssue[] = [];
    if (settings.issue) collectionIssues.push(settings.issue);

    const data = settings.data ?? {};

    return {
      sharingCapability: data.sharingCapability ?? null,
      oneDriveSharingCapability: data.oneDriveSharingCapability ?? null,
      sharingDomainRestrictionMode: data.sharingDomainRestrictionMode ?? null,
      sharingAllowedDomainCount: data.sharingAllowedDomainList?.length ?? 0,
      sharingBlockedDomainCount: data.sharingBlockedDomainList?.length ?? 0,
      defaultSharingLinkType: data.defaultSharingLinkType ?? null,
      defaultLinkPermission: data.defaultLinkPermission ?? null,
      anyoneLinkExpirationInDays: data.anyoneLinkExpirationInDays ?? null,
      policyPermissionError: settings.issue ? isPermissionIssue(settings.issue) : false,
      partialData: collectionIssues.length > 0,
      permissionError: collectionIssues.some(isPermissionIssue),
      collectionIssues,
    };
  });
}

router.get("/m365/sharepoint/policies", async (req, res): Promise<void> => {
  try {
    const data = await getSharePointPoliciesData();
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 SharePoint policies data");
    res.status(500).json({ error: "Failed to fetch M365 SharePoint policies data" });
  }
});

router.get("/m365/sharepoint/policies/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getSharePointPoliciesData();

    const fieldMetadata = {
      sharingCapability: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SharePointTenantSettings.Read.All",
      },
      oneDriveSharingCapability: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SharePointTenantSettings.Read.All",
      },
      sharingDomainRestrictionMode: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SharePointTenantSettings.Read.All",
      },
      sharingAllowedDomainCount: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SharePointTenantSettings.Read.All",
      },
      sharingBlockedDomainCount: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SharePointTenantSettings.Read.All",
      },
      defaultSharingLinkType: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SharePointTenantSettings.Read.All",
      },
      defaultLinkPermission: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SharePointTenantSettings.Read.All",
      },
      anyoneLinkExpirationInDays: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SharePointTenantSettings.Read.All",
      },
      policyPermissionError: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when settings collection failed due to missing Graph permission"],
      },
      partialData: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
      },
      permissionError: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
      },
      collectionIssues: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 SharePoint policies data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 SharePoint policies data" });
  }
});

export default router;
