import { getPermissionMetadataForFeature } from "../permissionMetadata.js";
import {
  fetchGraphJson,
  fetchAllGraphPages,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";
import type { GraphDlpPolicy, GraphSecureScore, GraphSensitivityLabel } from "./graphTypes.js";

export async function collectCompliance() {
  const labelsPermissionMetadata = getPermissionMetadataForFeature("compliance-sensitivity-labels");
  const collectionIssues: CollectionIssue[] = [];
  const collectionNotes: string[] = [];

  const [secScoreResult, eDiscoveryResult, dlpResult, labelsResult] = await Promise.all([
    fetchGraphJson<{ value?: GraphSecureScore[] }>("https://graph.microsoft.com/v1.0/security/secureScores?$top=1", "secureScores", undefined, ["SecurityEvents.Read.All"]),
    fetchGraphJson<{ value?: unknown[] }>("https://graph.microsoft.com/v1.0/security/cases/ediscoveryCases?$top=1", "eDiscoveryCases"),
    fetchAllGraphPages<GraphDlpPolicy>("https://graph.microsoft.com/v1.0/security/informationProtection/policies/dlp/policies?$top=999", "dlpPolicies"),
    fetchAllGraphPages<GraphSensitivityLabel>("https://graph.microsoft.com/beta/security/informationProtection/sensitivityLabels", "sensitivityLabels", ["InformationProtectionPolicy.Read.All"]),
  ]);

  if (secScoreResult.issue) collectionIssues.push(secScoreResult.issue);
  collectionIssues.push(...labelsResult.issues);

  // eDiscovery and DLP are not fixable by a simple application-permission grant, so
  // their failures are surfaced as explanatory notes rather than a "Permission required"
  // banner that would send the operator to grant a permission that won't unblock them.
  // - eDiscovery (app-only) needs eDiscovery.Read.All AND a Purview eDiscovery role-group
  //   assignment AND an eDiscovery (Premium) license.
  // - DLP policy listing is not exposed by a supported Microsoft Graph endpoint.
  if (eDiscoveryResult.issue) {
    collectionNotes.push(
      "eDiscovery case data isn't available. App-only access requires the eDiscovery.Read.All application permission plus a Microsoft Purview eDiscovery role-group assignment and an eDiscovery (Premium) license — a permission grant alone is not sufficient.",
    );
  }
  if (dlpResult.issues.length > 0) {
    collectionNotes.push(
      "DLP policy inventory isn't available through a supported Microsoft Graph endpoint; review Data Loss Prevention policies in the Microsoft Purview portal.",
    );
  }

  const secScore = secScoreResult.data?.value?.[0] ?? null;
  const complianceScore = secScore?.currentScore ?? 0;
  const complianceScoreMax = secScore?.maxScore ?? 100;
  const eDiscoveryCases = eDiscoveryResult.data?.value?.length ?? 0;

  const dlpList = dlpResult.items;
  const dlpPolicies = dlpList.length;
  const activeDlpPolicies = dlpList.filter((p) => p.mode === "Enable" || p.mode === "enable").length;

  const sensitivityLabelsPermissionRequired = labelsResult.permissionError;
  const sensitivityLabelsList = labelsResult.items.map((l) => ({
    id: l.id ?? "", name: l.name ?? "Unknown", description: l.description ?? "",
    tooltip: l.tooltip ?? "", color: l.color ?? "", sensitivity: l.sensitivity ?? 0,
    isActive: l.isActive ?? true, isAppliable: l.isAppliable ?? true,
    hasProtection: l.hasProtection ?? false, contentFormats: l.contentFormats ?? [],
    parent: l.parent?.id ?? null,
  }));

  // Real retention evidence: published retention labels via the records-management API.
  // managedAppPolicies (Intune MAM) was a misleading proxy and has been removed.
  // When the endpoint is unavailable or unpermitted we surface a manual check rather than a fabricated count.
  let retentionLabelCount: number | null = null;
  let retentionEvidence: "apiBacked" | "manual" = "manual";
  const retentionResult = await fetchGraphJson<{ value?: unknown[] }>(
    "https://graph.microsoft.com/beta/security/labels/retentionLabels?$top=999",
    "retentionLabels",
    undefined,
    ["RecordsManagement.Read.All"],
  );
  // Only treat a real 200 + value array as evidence. 404 (endpoint unavailable on
  // tenant) is the expected manual-fallback path and is NOT surfaced as an error.
  // A permission issue (401/403) is genuine and is surfaced so the UI can prompt for consent.
  if (Array.isArray(retentionResult.data?.value)) {
    retentionLabelCount = retentionResult.data.value.length;
    retentionEvidence = "apiBacked";
  } else if (retentionResult.issue && isPermissionIssue(retentionResult.issue)) {
    collectionIssues.push(retentionResult.issue);
  }

  return {
    dlpPolicies, activeDlpPolicies,
    retentionPolicies: retentionLabelCount ?? 0,
    retentionLabelCount, retentionEvidence,
    sensitivityLabels: sensitivityLabelsList.length,
    dlpPolicyMatches: 0, complianceScore, complianceScoreMax,
    auditLogEnabled: true, unifiedAuditLogEnabled: true,
    eDiscoveryCases, sensitivityLabelsList, sensitivityLabelsPermissionRequired,
    permissionMetadata: labelsPermissionMetadata,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
    collectionNotes,
  };
}
