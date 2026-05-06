import {
  getFeaturePermissionDetails,
  type FeatureId,
} from "@workspace/permissions-manifest";

export interface RoutePermissionMetadata {
  featureId: string;
  title: string;
  behavior: "hard-fail" | "partial-data" | "future";
  requiredPermissions: string[];
  optionalPermissions: string[];
  futurePermissions: string[];
}

export function getPermissionMetadataForFeature(
  featureId: FeatureId | string
): RoutePermissionMetadata | null {
  const details = getFeaturePermissionDetails(featureId);
  if (!details) return null;

  return {
    featureId: details.id,
    title: details.title,
    behavior: details.behavior,
    requiredPermissions: details.requiredPermissions.map((p) => p.name),
    optionalPermissions: details.optionalPermissions.map((p) => p.name),
    futurePermissions: details.futurePermissions.map((p) => p.name),
  };
}

export function getPermissionMetadataForFeatures(
  featureIds: Array<FeatureId | string>
) {
  return featureIds
    .map((featureId) => getPermissionMetadataForFeature(featureId))
    .filter((metadata): metadata is RoutePermissionMetadata => metadata !== null);
}
