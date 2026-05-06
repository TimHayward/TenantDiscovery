import {
  getFeaturePermissionDetails,
  getPermissionNamesForFeature,
} from "@workspace/permissions-manifest";

function requireFeature(featureId: string) {
  const feature = getFeaturePermissionDetails(featureId);
  if (!feature) {
    throw new Error(`Missing permissions manifest entry for feature: ${featureId}`);
  }
  return feature;
}

export const ENTERPRISE_APPS_PERMISSIONS = requireFeature("enterprise-apps");
export const SERVICE_PRINCIPALS_PERMISSIONS = requireFeature("service-principals");
export const INTUNE_DEVICE_PERMISSIONS = requireFeature("intune-devices");
export const INTUNE_APP_INSTALL_PERMISSIONS = requireFeature("intune-app-installations");
export const INTUNE_DISCOVERED_APPS_PERMISSIONS = requireFeature("intune-discovered-apps");
export const COMPLIANCE_SENSITIVITY_LABELS_PERMISSIONS = requireFeature("compliance-sensitivity-labels");

export const INTUNE_DEVICE_DETAIL_PERMISSION =
  getPermissionNamesForFeature("intune-devices", "required")[0] ?? "DeviceManagementManagedDevices.Read.All";

export const INTUNE_APP_INSTALL_PERMISSION =
  getPermissionNamesForFeature("intune-app-installations", "optional")[0] ?? "DeviceManagementApps.Read.All";

export const INTUNE_DISCOVERED_APPS_PERMISSION =
  getPermissionNamesForFeature("intune-discovered-apps", "optional")[0] ?? "DeviceManagementManagedDevices.Read.All";

export const COMPLIANCE_SENSITIVITY_LABELS_PERMISSION =
  getPermissionNamesForFeature("compliance-sensitivity-labels", "optional")[0] ?? "InformationProtectionPolicy.Read.All";