import { getPermissionMetadataForFeature } from "../permissionMetadata.js";
import {
  fetchGraphJson,
  fetchAllGraphPages,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";

export async function collectCompliance() {
  const labelsPermissionMetadata = getPermissionMetadataForFeature("compliance-sensitivity-labels");
  const collectionIssues: CollectionIssue[] = [];

  const [secScoreResult, eDiscoveryResult, dlpResult, labelsResult] = await Promise.all([
    fetchGraphJson<any>("https://graph.microsoft.com/v1.0/security/secureScores?$top=1", "secureScores"),
    fetchGraphJson<any>("https://graph.microsoft.com/v1.0/security/cases/ediscoveryCases?$top=1", "eDiscoveryCases"),
    fetchAllGraphPages<any>("https://graph.microsoft.com/v1.0/security/informationProtection/policies/dlp/policies?$top=999", "dlpPolicies"),
    fetchAllGraphPages<any>("https://graph.microsoft.com/beta/security/informationProtection/sensitivityLabels", "sensitivityLabels"),
  ]);

  if (secScoreResult.issue) collectionIssues.push(secScoreResult.issue);
  if (eDiscoveryResult.issue) collectionIssues.push(eDiscoveryResult.issue);
  collectionIssues.push(...dlpResult.issues, ...labelsResult.issues);

  const secScore = secScoreResult.data?.value?.[0] ?? null;
  const complianceScore = secScore?.currentScore ?? 0;
  const complianceScoreMax = secScore?.maxScore ?? 100;
  const eDiscoveryCases = eDiscoveryResult.data?.value?.length ?? 0;

  const dlpList = dlpResult.items;
  const dlpPolicies = dlpList.length;
  const activeDlpPolicies = dlpList.filter((p: any) => p.mode === "Enable" || p.mode === "enable").length;

  const sensitivityLabelsPermissionRequired = labelsResult.permissionError;
  const sensitivityLabelsList = labelsResult.items.map((l: any) => ({
    id: l.id, name: l.name ?? "Unknown", description: l.description ?? "",
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
  const retentionResult = await fetchGraphJson<any>(
    "https://graph.microsoft.com/beta/security/labels/retentionLabels?$top=999",
    "retentionLabels",
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
  };
}
