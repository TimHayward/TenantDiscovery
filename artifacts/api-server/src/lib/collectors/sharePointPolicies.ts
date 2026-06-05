import {
  fetchGraphJson,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";

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

export async function collectSharePointPolicies() {
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
}
