import { getGraphCredentialValues } from "../graphClient.js";
import { getPermissionMetadataForFeature, getPermissionMetadataForFeatures } from "../permissionMetadata.js";

const PERMISSION_ERROR_CODES = new Set([403, 401]);

async function getToken(): Promise<string> {
  const { ClientSecretCredential } = await import("@azure/identity");
  const { tenantId, clientId, clientSecret } = await getGraphCredentialValues();
  const cred = new ClientSecretCredential(tenantId, clientId, clientSecret, { tokenCachePersistenceOptions: { enabled: false } });
  const token = await cred.getToken("https://graph.microsoft.com/.default");
  return token!.token;
}

async function fetchWithToken(url: string, bearerToken: string): Promise<{ data: any; status: number }> {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${bearerToken}` } });
  if (!resp.ok) return { data: null, status: resp.status };
  return { data: await resp.json(), status: resp.status };
}

async function fetchAllPages(firstUrl: string, bearerToken: string): Promise<{ items: any[]; permissionDenied: boolean }> {
  const items: any[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const { data, status } = await fetchWithToken(url, bearerToken);
    if (PERMISSION_ERROR_CODES.has(status)) return { items: [], permissionDenied: true };
    if (!data || !data.value) break;
    items.push(...data.value);
    url = data["@odata.nextLink"] ?? null;
  }
  return { items, permissionDenied: false };
}

function isWindowsDevice(device: any): boolean {
  return (device.operatingSystem ?? "").toLowerCase().includes("windows");
}

function getTamperProtectionEnabled(device: any): boolean | null {
  const value = device.windowsProtectionState?.tamperProtectionEnabled;
  return typeof value === "boolean" ? value : null;
}

function getTamperProtectionSummary(devices: any[]) {
  const windowsDevices = devices.filter(isWindowsDevice);
  const windowsDevicesWithState = windowsDevices.filter((device) => getTamperProtectionEnabled(device) !== null);
  const enabledDevices = windowsDevicesWithState.filter((device) => getTamperProtectionEnabled(device) === true).length;
  const disabledDevices = windowsDevicesWithState.filter((device) => getTamperProtectionEnabled(device) === false).length;
  const unknownDevices = Math.max(windowsDevices.length - windowsDevicesWithState.length, 0);
  const reportedDevices = enabledDevices + disabledDevices;
  const percent = reportedDevices > 0 ? Math.round((enabledDevices / reportedDevices) * 100) : 0;
  return { enabledDevices, disabledDevices, unknownDevices, reportedDevices, windowsDevices: windowsDevices.length, percent };
}

function buildManagedDevicesUrl(): string {
  return (
    "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices" +
    "?$select=id,deviceName,operatingSystem,osVersion,complianceState,enrolledDateTime," +
    "lastSyncDateTime,userDisplayName,userPrincipalName,manufacturer,model," +
    "managementAgent,managementState,isEncrypted,isSupervised,jailBroken" +
    "&$expand=windowsProtectionState($select=tamperProtectionEnabled)"
  );
}

function getPlatform(oDataType: string): string {
  const t = (oDataType || "").toLowerCase();
  if (t.includes("windows")) return "Windows";
  if (t.includes("ios")) return "iOS";
  if (t.includes("android")) return "Android";
  if (t.includes("macos")) return "macOS";
  return "Unknown";
}

async function computeIntuneData(token: string) {
  const [devicesResult, compliancePoliciesResult, configProfilesResult, enrollmentConfigsResult, complianceSummaryResult, appProtectionPoliciesResult] = await Promise.all([
    fetchAllPages(buildManagedDevicesUrl(), token),
    fetchAllPages("https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicies?$select=id,displayName,description,createdDateTime,lastModifiedDateTime&$expand=assignments($select=id,target)", token),
    fetchAllPages("https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations?$select=id,displayName,description,createdDateTime,lastModifiedDateTime&$expand=assignments($select=id,target)", token),
    fetchAllPages("https://graph.microsoft.com/v1.0/deviceManagement/deviceEnrollmentConfigurations?$select=id,displayName,description,enrollmentConfigurationType,createdDateTime,lastModifiedDateTime,priority", token),
    fetchWithToken("https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicyDeviceStateSummary", token),
    fetchAllPages("https://graph.microsoft.com/beta/deviceAppManagement/managedAppPolicies?$select=id,displayName,description,createdDateTime,lastModifiedDateTime,@odata.type", token),
  ]);

  const devices = devicesResult.items;
  const compliancePolicies = compliancePoliciesResult.items;
  const configProfiles = configProfilesResult.items;
  const enrollmentConfigs = enrollmentConfigsResult.items;
  const complianceSummary = complianceSummaryResult.data;
  const appProtectionPolicies = appProtectionPoliciesResult.items;
  const tamperProtection = getTamperProtectionSummary(devices);
  const permissionRequired = devicesResult.permissionDenied;

  const overallCompliance = complianceSummary ? {
    compliantDeviceCount: complianceSummary.compliantDeviceCount ?? 0,
    noncompliantDeviceCount: complianceSummary.nonCompliantDeviceCount ?? 0,
    remediatedDeviceCount: complianceSummary.remediatedDeviceCount ?? 0,
    notApplicableDeviceCount: complianceSummary.notApplicableDeviceCount ?? 0,
    notAssignedDeviceCount: complianceSummary.notAssignedDeviceCount ?? 0,
    gracePeriodCount: complianceSummary.inGracePeriodCount ?? 0,
    configManagerCount: complianceSummary.configManagerCount ?? 0,
  } : null;

  const hasDeviceList = devices.length > 0;
  const totalDevices = hasDeviceList ? devices.length
    : overallCompliance ? (overallCompliance.compliantDeviceCount + overallCompliance.noncompliantDeviceCount + overallCompliance.remediatedDeviceCount + overallCompliance.notApplicableDeviceCount + overallCompliance.gracePeriodCount) : 0;
  const compliantCount = hasDeviceList ? devices.filter((d: any) => d.complianceState === "compliant").length : (overallCompliance?.compliantDeviceCount ?? 0);
  const nonCompliantFromSummary = overallCompliance?.noncompliantDeviceCount ?? 0;
  const overallCompliancePercent = totalDevices > 0 ? Math.round((compliantCount / totalDevices) * 100) : 0;

  const compMap: Record<string, number> = {};
  for (const d of devices) { const state = d.complianceState || "unknown"; compMap[state] = (compMap[state] || 0) + 1; }
  if (!hasDeviceList && overallCompliance) {
    if (overallCompliance.compliantDeviceCount > 0) compMap["compliant"] = overallCompliance.compliantDeviceCount;
    if (overallCompliance.noncompliantDeviceCount > 0) compMap["noncompliant"] = overallCompliance.noncompliantDeviceCount;
    if (overallCompliance.gracePeriodCount > 0) compMap["inGracePeriod"] = overallCompliance.gracePeriodCount;
    if (overallCompliance.notApplicableDeviceCount > 0) compMap["notApplicable"] = overallCompliance.notApplicableDeviceCount;
    if (overallCompliance.notAssignedDeviceCount > 0) compMap["notAssigned"] = overallCompliance.notAssignedDeviceCount;
  }
  const complianceByState = Object.entries(compMap).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count);

  const byOS: Record<string, number> = {};
  for (const d of devices) { const os = d.operatingSystem || "Unknown"; byOS[os] = (byOS[os] || 0) + 1; }
  const enrolledByOS = Object.entries(byOS).map(([os, count]) => ({ os, count })).sort((a, b) => b.count - a.count);

  const osVersionMap: Record<string, Record<string, number>> = {};
  for (const d of devices) {
    const os = d.operatingSystem || "Unknown"; const ver = d.osVersion || "Unknown";
    if (!osVersionMap[os]) osVersionMap[os] = {};
    osVersionMap[os][ver] = (osVersionMap[os][ver] || 0) + 1;
  }
  const osVersionBreakdown = Object.entries(osVersionMap).map(([os, versions]) => ({ os, versions: Object.entries(versions).map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count) }));

  const osCompMap: Record<string, { compliant: number; total: number }> = {};
  for (const d of devices) {
    const os = d.operatingSystem || "Unknown";
    if (!osCompMap[os]) osCompMap[os] = { compliant: 0, total: 0 };
    osCompMap[os].total++;
    if (d.complianceState === "compliant") osCompMap[os].compliant++;
  }
  const complianceByOS = Object.entries(osCompMap).map(([os, { compliant, total }]) => ({ os, compliant, nonCompliant: total - compliant, total, compliancePercent: Math.round((compliant / total) * 100) })).sort((a, b) => b.total - a.total);

  const deviceList = devices.map((d: any) => ({
    id: d.id, deviceName: d.deviceName || "Unknown", operatingSystem: d.operatingSystem || "Unknown",
    osVersion: d.osVersion || "Unknown", complianceState: d.complianceState || "unknown",
    enrolledDateTime: d.enrolledDateTime ?? null, lastSyncDateTime: d.lastSyncDateTime ?? null,
    userDisplayName: d.userDisplayName || "Unknown", userPrincipalName: d.userPrincipalName || "",
    manufacturer: d.manufacturer || "", model: d.model || "",
    deviceType: d.deviceType || "unknown", managementAgent: d.managementAgent || "unknown",
    managementState: d.managementState || "managed", isEncrypted: d.isEncrypted ?? null,
    isSupervised: d.isSupervised ?? null, jailBroken: d.jailBroken || "Unknown",
    tamperProtectionEnabled: getTamperProtectionEnabled(d),
  }));

  const compliancePoliciesList = compliancePolicies.map((p: any) => ({ id: p.id, displayName: p.displayName || "Unnamed", description: p.description || "", platform: getPlatform(p["@odata.type"]), assignedGroups: (p.assignments || []).length, createdDateTime: p.createdDateTime ?? null, lastModifiedDateTime: p.lastModifiedDateTime ?? null }));
  const configProfilesList = configProfiles.map((p: any) => ({ id: p.id, displayName: p.displayName || "Unnamed", description: p.description || "", platform: getPlatform(p["@odata.type"]), assignedGroups: (p.assignments || []).length, createdDateTime: p.createdDateTime ?? null, lastModifiedDateTime: p.lastModifiedDateTime ?? null }));
  const enrollmentConfigsList = enrollmentConfigs.map((e: any) => ({ id: e.id, displayName: e.displayName || "Unnamed", type: e.enrollmentConfigurationType || "unknown", priority: e.priority ?? 0, createdDateTime: e.createdDateTime ?? null, lastModifiedDateTime: e.lastModifiedDateTime ?? null }));
  const appProtectionList = appProtectionPolicies.map((p: any) => ({ id: p.id, displayName: p.displayName || "Unnamed", description: p.description || "", platform: getPlatform(p["@odata.type"]), assignedGroups: 0, createdDateTime: p.createdDateTime ?? null, lastModifiedDateTime: p.lastModifiedDateTime ?? null }));

  const policyByOS: Record<string, { totalPolicies: number; policyNames: string[] }> = {};
  for (const p of compliancePolicies) {
    const platform = getPlatform(p["@odata.type"]);
    if (!policyByOS[platform]) policyByOS[platform] = { totalPolicies: 0, policyNames: [] };
    policyByOS[platform].totalPolicies++;
    policyByOS[platform].policyNames.push(p.displayName || "Unnamed");
  }
  const policySummaryByOS = Object.entries(policyByOS).map(([os, info]) => ({ os, ...info }));

  const encryptedCount = devices.filter((d: any) => d.isEncrypted === true).length;
  const encryptionPercent = hasDeviceList ? Math.round((encryptedCount / totalDevices) * 100) : 0;
  const jailbrokenCount = devices.filter((d: any) => typeof d.jailBroken === "string" && d.jailBroken.toLowerCase() === "true").length;
  const effectiveNonCompliant = hasDeviceList ? (compMap["noncompliant"] || 0) : nonCompliantFromSummary;

  const assessmentItems = [
    { area: "Enrollment", item: "MDM Authority", value: "Microsoft Intune", status: totalDevices > 0 ? "Configured" : "Not configured", notes: "Microsoft Intune is the MDM authority for this tenant" },
    { area: "Enrollment", item: "Total Enrolled Devices", value: String(totalDevices), status: totalDevices > 0 ? "Active" : "None", notes: `${totalDevices} device(s) enrolled in Intune MDM` },
    ...enrolledByOS.map((e) => ({ area: "Enrollment", item: `Enrolled ${e.os} Devices`, value: String(e.count), status: "Enrolled", notes: `${e.count} ${e.os} device(s) under management` })),
    { area: "Compliance", item: "Overall Device Compliance", value: `${overallCompliancePercent}%`, status: overallCompliancePercent >= 90 ? "Good" : overallCompliancePercent >= 70 ? "Warning" : "Critical", notes: `${compliantCount} of ${totalDevices} devices are compliant` },
    ...complianceByOS.map((c) => ({ area: "Compliance", item: `${c.os} Compliance`, value: `${c.compliancePercent}%`, status: c.compliancePercent >= 90 ? "Good" : c.compliancePercent >= 70 ? "Warning" : "Critical", notes: `${c.compliant} compliant / ${c.nonCompliant} non-compliant out of ${c.total}` })),
    { area: "Compliance", item: "Non-Compliant Devices", value: String(effectiveNonCompliant), status: effectiveNonCompliant === 0 ? "Good" : "Action Required", notes: "Devices failing one or more compliance policies" },
    { area: "Compliance", item: "Devices in Grace Period", value: String(overallCompliance?.gracePeriodCount ?? 0), status: (overallCompliance?.gracePeriodCount ?? 0) === 0 ? "Good" : "Monitor", notes: "Devices with compliance issues but within the grace period" },
    { area: "Policies", item: "Compliance Policies Configured", value: String(compliancePolicies.length), status: compliancePolicies.length > 0 ? "Configured" : "Not configured", notes: `${compliancePolicies.length} compliance polic${compliancePolicies.length === 1 ? "y" : "ies"} defined` },
    { area: "Policies", item: "Configuration Profiles", value: String(configProfiles.length), status: configProfiles.length > 0 ? "Configured" : "Not configured", notes: `${configProfiles.length} device configuration profile(s) deployed` },
    { area: "Policies", item: "Enrollment Configurations", value: String(enrollmentConfigs.length), status: enrollmentConfigs.length > 0 ? "Configured" : "Not configured", notes: "Device enrollment restriction and limit configurations" },
    { area: "App Protection", item: "App Protection Policies", value: String(appProtectionPolicies.length), status: appProtectionPolicies.length > 0 ? "Configured" : "Not configured", notes: `${appProtectionPolicies.length} MAM app protection polic${appProtectionPolicies.length === 1 ? "y" : "ies"} in place` },
    { area: "Security", item: "Device Encryption", value: `${encryptionPercent}%`, status: !hasDeviceList ? "N/A — device list unavailable" : encryptionPercent >= 90 ? "Good" : encryptionPercent >= 70 ? "Warning" : "Critical", notes: hasDeviceList ? `${encryptedCount} of ${totalDevices} devices reporting encryption enabled` : "Encryption data requires DeviceManagementManagedDevices.Read.All" },
    { area: "Security", item: "Tamper Protection", value: tamperProtection.reportedDevices > 0 ? `${tamperProtection.percent}%` : "N/A", status: tamperProtection.reportedDevices === 0 ? "N/A — tamper protection data unavailable" : tamperProtection.percent >= 90 ? "Good" : tamperProtection.percent >= 70 ? "Warning" : "Critical", notes: tamperProtection.reportedDevices > 0 ? `${tamperProtection.enabledDevices} of ${tamperProtection.reportedDevices} Windows device(s) reporting tamper protection enabled${tamperProtection.unknownDevices > 0 ? `; ${tamperProtection.unknownDevices} device(s) did not report a state` : ""}` : "Tamper protection requires Intune managed Windows device protection state data" },
    { area: "Security", item: "Jailbroken / Rooted Devices", value: hasDeviceList ? String(jailbrokenCount) : "N/A", status: !hasDeviceList ? "N/A" : jailbrokenCount === 0 ? "Good" : "Critical", notes: hasDeviceList ? (jailbrokenCount === 0 ? "No jailbroken or rooted devices detected" : `${jailbrokenCount} device(s) detected as jailbroken or rooted`) : "Jailbreak data requires DeviceManagementManagedDevices.Read.All" },
  ];

  return {
    totalDevices, overallCompliancePercent, compliantDevices: compliantCount, nonCompliantDevices: effectiveNonCompliant,
    totalCompliancePolicies: compliancePolicies.length, totalConfigProfiles: configProfiles.length, totalAppProtectionPolicies: appProtectionPolicies.length,
    enrolledByOS, osVersionBreakdown, complianceByState, complianceByOS, deviceList,
    compliancePoliciesList, configProfilesList, enrollmentConfigsList, appProtectionList,
    overallCompliance, assessmentItems, encryptedDevices: encryptedCount, encryptionPercent,
    tamperProtectionEnabledDevices: tamperProtection.enabledDevices, tamperProtectionDisabledDevices: tamperProtection.disabledDevices,
    tamperProtectionUnknownDevices: tamperProtection.unknownDevices, tamperProtectionPercent: tamperProtection.percent,
    jailbrokenCount, permissionRequired, deviceListAvailable: hasDeviceList, policySummaryByOS,
  };
}

export async function collectIntune() {
  const intunePermissionMetadata = getPermissionMetadataForFeature("intune-devices");
  const token = await getToken();
  const data = await computeIntuneData(token);
  return { ...data, permissionMetadata: intunePermissionMetadata };
}

export async function collectIntuneApps() {
  const intuneAppsPermissionMetadata = getPermissionMetadataForFeatures(["intune-app-installations", "intune-discovered-apps"]);
  const token = await getToken();

  const [installReportRaw, detectedAppsResult] = await Promise.all([
    (async () => {
      const allRows: any[][] = [];
      let skip = 0; const top = 200; let totalRowCount = 0; let schema: { Column: string }[] = []; let permissionDenied = false;
      do {
        const resp = await fetch("https://graph.microsoft.com/beta/deviceManagement/reports/getAppsInstallSummaryReport", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ top, skip, filter: "" }),
        });
        if (PERMISSION_ERROR_CODES.has(resp.status)) { permissionDenied = true; break; }
        if (!resp.ok) break;
        const d = await resp.json() as any;
        if (schema.length === 0) schema = d.Schema || [];
        totalRowCount = d.TotalRowCount ?? 0;
        allRows.push(...(d.Values || []));
        skip += top;
      } while (allRows.length < totalRowCount);
      return { rows: allRows, schema, permissionDenied };
    })(),
    fetchAllPages("https://graph.microsoft.com/beta/deviceManagement/detectedApps?$select=id,displayName,version,sizeInByte,deviceCount,platform", token),
  ]);

  const installPermissionRequired = installReportRaw.permissionDenied;
  const discoveryPermissionRequired = detectedAppsResult.permissionDenied;

  const colIdx: Record<string, number> = {};
  installReportRaw.schema.forEach((s: { Column: string }, i: number) => { colIdx[s.Column] = i; });

  let totalInstalled = 0, totalFailed = 0, totalPending = 0, totalNotApplicable = 0, totalNotInstalled = 0;
  const installMap: Record<string, { installed: number; failed: number; pending: number; notApplicable: number; notInstalled: number }> = {};

  const appInstallList = installReportRaw.rows.map((row: any[]) => {
    const id = String(row[colIdx["ApplicationId"]] ?? ""); const displayName = String(row[colIdx["DisplayName"]] ?? "Unknown"); const publisher = row[colIdx["Publisher"]] != null ? String(row[colIdx["Publisher"]]) : null; const platform = String(row[colIdx["AppPlatform"]] ?? "Other");
    const installed = Number(row[colIdx["InstalledDeviceCount"]]) || 0; const failed = Number(row[colIdx["FailedDeviceCount"]]) || 0; const pending = Number(row[colIdx["PendingInstallDeviceCount"]]) || 0; const notApplicable = Number(row[colIdx["NotApplicableDeviceCount"]]) || 0; const notInstalled = Number(row[colIdx["NotInstalledDeviceCount"]]) || 0;
    totalInstalled += installed; totalFailed += failed; totalPending += pending; totalNotApplicable += notApplicable; totalNotInstalled += notInstalled;
    if (!installMap[platform]) installMap[platform] = { installed: 0, failed: 0, pending: 0, notApplicable: 0, notInstalled: 0 };
    installMap[platform].installed += installed; installMap[platform].failed += failed; installMap[platform].pending += pending; installMap[platform].notApplicable += notApplicable; installMap[platform].notInstalled += notInstalled;
    return { id, displayName, publisher, platform, installed, failed, pending, notApplicable, notInstalled };
  });

  const installByPlatform = Object.entries(installMap).map(([platform, counts]) => ({ platform, ...counts })).sort((a, b) => (b.installed + b.failed) - (a.installed + a.failed));

  function platformFromDetected(platform: string): string {
    switch ((platform || "").toLowerCase()) {
      case "windows": return "Windows"; case "windowsmobile": return "Windows Mobile"; case "ios": return "iOS"; case "android": return "Android"; case "macos": return "macOS"; default: return "Other";
    }
  }

  const detectedApps = detectedAppsResult.items;
  const managedNames = new Set(appInstallList.map((a) => a.displayName.toLowerCase().trim()));
  let managedDiscoveredApps = 0, unmanagedDiscoveredApps = 0;
  const discoveredMap: Record<string, { managed: number; unmanaged: number }> = {};

  const discoveredAppList = detectedApps.map((app: any) => {
    const platform = platformFromDetected(app.platform || "");
    const managed = managedNames.has((app.displayName || "").toLowerCase().trim());
    if (!discoveredMap[platform]) discoveredMap[platform] = { managed: 0, unmanaged: 0 };
    if (managed) { managedDiscoveredApps++; discoveredMap[platform].managed++; } else { unmanagedDiscoveredApps++; discoveredMap[platform].unmanaged++; }
    return { id: app.id, displayName: app.displayName || "Unknown", version: app.version ?? null, deviceCount: app.deviceCount ?? 0, platform, managed };
  });

  const discoveredByPlatform = Object.entries(discoveredMap).map(([platform, counts]) => ({ platform, ...counts })).sort((a, b) => (b.managed + b.unmanaged) - (a.managed + a.unmanaged));

  return {
    installPermissionRequired, discoveryPermissionRequired, permissionMetadata: intuneAppsPermissionMetadata,
    totalAssignedApps: appInstallList.length, totalInstalled, totalFailed, totalPending, totalNotApplicable, totalNotInstalled,
    installByPlatform, appInstallList, totalDiscoveredApps: detectedApps.length,
    managedDiscoveredApps, unmanagedDiscoveredApps, discoveredByPlatform, discoveredAppList,
  };
}
