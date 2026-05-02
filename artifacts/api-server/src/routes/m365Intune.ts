import { Router } from "express";
import { getCached } from "../lib/graphClient.js";

const router = Router();

const PERMISSION_ERROR_CODES = new Set([403, 401]);

async function getToken(): Promise<string> {
  const { ClientSecretCredential } = await import("@azure/identity");
  const cred = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!,
    { tokenCachePersistenceOptions: { enabled: false } }
  );
  const token = await cred.getToken("https://graph.microsoft.com/.default");
  return token!.token;
}

async function fetchWithToken(url: string, bearerToken: string): Promise<{ data: any; status: number }> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  if (!resp.ok) return { data: null, status: resp.status };
  const data = await resp.json();
  return { data, status: resp.status };
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

router.get("/m365/intune", async (req, res) => {
  try {
    const data = await getCached("m365-intune", async () => {
      // ── single shared token ──────────────────────────────────────────────
      const token = await getToken();

      // ── parallel fetch ───────────────────────────────────────────────────
      const [
        devicesResult,
        compliancePoliciesResult,
        configProfilesResult,
        enrollmentConfigsResult,
        complianceSummaryResult,
        appProtectionPoliciesResult,
      ] = await Promise.all([
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices" +
            "?$select=id,deviceName,operatingSystem,osVersion,complianceState,enrolledDateTime," +
            "lastSyncDateTime,userDisplayName,userPrincipalName,manufacturer,model,deviceType," +
            "managementAgent,managementState,isEncrypted,isSupervised,jailBroken",
          token
        ),
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicies" +
            "?$select=id,displayName,description,createdDateTime,lastModifiedDateTime" +
            "&$expand=assignments($select=id,target)",
          token
        ),
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations" +
            "?$select=id,displayName,description,createdDateTime,lastModifiedDateTime" +
            "&$expand=assignments($select=id,target)",
          token
        ),
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/deviceManagement/deviceEnrollmentConfigurations" +
            "?$select=id,displayName,description,enrollmentConfigurationType,createdDateTime,lastModifiedDateTime,priority",
          token
        ),
        fetchWithToken(
          "https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicyDeviceStateSummary",
          token
        ),
        fetchAllPages(
          "https://graph.microsoft.com/beta/deviceAppManagement/managedAppPolicies" +
            "?$select=id,displayName,description,createdDateTime,lastModifiedDateTime,@odata.type",
          token
        ),
      ]);

      const devices = devicesResult.items;
      const compliancePolicies = compliancePoliciesResult.items;
      const configProfiles = configProfilesResult.items;
      const enrollmentConfigs = enrollmentConfigsResult.items;
      const complianceSummary = complianceSummaryResult.data;
      const appProtectionPolicies = appProtectionPoliciesResult.items;

      // ── permission check ─────────────────────────────────────────────────
      // Only true when the devices endpoint explicitly returned 403/401
      const permissionRequired = devicesResult.permissionDenied;

      // ── build overallCompliance from API summary (available even if device list is denied) ──
      const overallCompliance = complianceSummary
        ? {
            compliantDeviceCount: complianceSummary.compliantDeviceCount ?? 0,
            noncompliantDeviceCount: complianceSummary.nonCompliantDeviceCount ?? 0,
            remediatedDeviceCount: complianceSummary.remediatedDeviceCount ?? 0,
            notApplicableDeviceCount: complianceSummary.notApplicableDeviceCount ?? 0,
            notAssignedDeviceCount: complianceSummary.notAssignedDeviceCount ?? 0,
            gracePeriodCount: complianceSummary.inGracePeriodCount ?? 0,
            configManagerCount: complianceSummary.configManagerCount ?? 0,
          }
        : null;

      // ── KPIs: prefer device list, fall back to summary ───────────────────
      const hasDeviceList = devices.length > 0;

      // Total devices: use summary when device list unavailable
      const totalDevices = hasDeviceList
        ? devices.length
        : overallCompliance
        ? (overallCompliance.compliantDeviceCount +
           overallCompliance.noncompliantDeviceCount +
           overallCompliance.remediatedDeviceCount +
           overallCompliance.notApplicableDeviceCount +
           overallCompliance.gracePeriodCount)
        : 0;

      // Compliance count: prefer device list, fall back to summary
      const compliantCount = hasDeviceList
        ? devices.filter((d: any) => d.complianceState === "compliant").length
        : (overallCompliance?.compliantDeviceCount ?? 0);

      const nonCompliantFromSummary = overallCompliance?.noncompliantDeviceCount ?? 0;

      const overallCompliancePercent =
        totalDevices > 0 ? Math.round((compliantCount / totalDevices) * 100) : 0;

      // Compliance state breakdown (device-list only)
      const compMap: Record<string, number> = {};
      for (const d of devices) {
        const state = d.complianceState || "unknown";
        compMap[state] = (compMap[state] || 0) + 1;
      }
      // If device list unavailable, seed from summary
      if (!hasDeviceList && overallCompliance) {
        if (overallCompliance.compliantDeviceCount > 0) compMap["compliant"] = overallCompliance.compliantDeviceCount;
        if (overallCompliance.noncompliantDeviceCount > 0) compMap["noncompliant"] = overallCompliance.noncompliantDeviceCount;
        if (overallCompliance.gracePeriodCount > 0) compMap["inGracePeriod"] = overallCompliance.gracePeriodCount;
        if (overallCompliance.notApplicableDeviceCount > 0) compMap["notApplicable"] = overallCompliance.notApplicableDeviceCount;
        if (overallCompliance.notAssignedDeviceCount > 0) compMap["notAssigned"] = overallCompliance.notAssignedDeviceCount;
      }
      const complianceByState = Object.entries(compMap)
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count);

      // Enrolled by OS (device-list only)
      const byOS: Record<string, number> = {};
      for (const d of devices) {
        const os = d.operatingSystem || "Unknown";
        byOS[os] = (byOS[os] || 0) + 1;
      }
      const enrolledByOS = Object.entries(byOS)
        .map(([os, count]) => ({ os, count }))
        .sort((a, b) => b.count - a.count);

      // OS version breakdown
      const osVersionMap: Record<string, Record<string, number>> = {};
      for (const d of devices) {
        const os = d.operatingSystem || "Unknown";
        const ver = d.osVersion || "Unknown";
        if (!osVersionMap[os]) osVersionMap[os] = {};
        osVersionMap[os][ver] = (osVersionMap[os][ver] || 0) + 1;
      }
      const osVersionBreakdown = Object.entries(osVersionMap).map(([os, versions]) => ({
        os,
        versions: Object.entries(versions)
          .map(([version, count]) => ({ version, count }))
          .sort((a, b) => b.count - a.count),
      }));

      // Compliance per OS
      const osCompMap: Record<string, { compliant: number; total: number }> = {};
      for (const d of devices) {
        const os = d.operatingSystem || "Unknown";
        if (!osCompMap[os]) osCompMap[os] = { compliant: 0, total: 0 };
        osCompMap[os].total++;
        if (d.complianceState === "compliant") osCompMap[os].compliant++;
      }
      const complianceByOS = Object.entries(osCompMap)
        .map(([os, { compliant, total }]) => ({
          os,
          compliant,
          nonCompliant: total - compliant,
          total,
          compliancePercent: Math.round((compliant / total) * 100),
        }))
        .sort((a, b) => b.total - a.total);

      // Device list
      const deviceList = devices.map((d: any) => ({
        id: d.id,
        deviceName: d.deviceName || "Unknown",
        operatingSystem: d.operatingSystem || "Unknown",
        osVersion: d.osVersion || "Unknown",
        complianceState: d.complianceState || "unknown",
        enrolledDateTime: d.enrolledDateTime ?? null,
        lastSyncDateTime: d.lastSyncDateTime ?? null,
        userDisplayName: d.userDisplayName || "Unknown",
        userPrincipalName: d.userPrincipalName || "",
        manufacturer: d.manufacturer || "",
        model: d.model || "",
        deviceType: d.deviceType || "unknown",
        managementAgent: d.managementAgent || "unknown",
        managementState: d.managementState || "managed",
        isEncrypted: d.isEncrypted ?? null,
        isSupervised: d.isSupervised ?? null,
        jailBroken: d.jailBroken || "Unknown",
      }));

      const getPlatform = (oDataType: string) => {
        const t = (oDataType || "").toLowerCase();
        if (t.includes("windows")) return "Windows";
        if (t.includes("ios")) return "iOS";
        if (t.includes("android")) return "Android";
        if (t.includes("macos")) return "macOS";
        return "Unknown";
      };

      // Compliance policies list
      const compliancePoliciesList = compliancePolicies.map((p: any) => ({
        id: p.id,
        displayName: p.displayName || "Unnamed",
        description: p.description || "",
        platform: getPlatform(p["@odata.type"]),
        assignedGroups: (p.assignments || []).length,
        createdDateTime: p.createdDateTime ?? null,
        lastModifiedDateTime: p.lastModifiedDateTime ?? null,
      }));

      // Config profiles list
      const configProfilesList = configProfiles.map((p: any) => ({
        id: p.id,
        displayName: p.displayName || "Unnamed",
        description: p.description || "",
        platform: getPlatform(p["@odata.type"]),
        assignedGroups: (p.assignments || []).length,
        createdDateTime: p.createdDateTime ?? null,
        lastModifiedDateTime: p.lastModifiedDateTime ?? null,
      }));

      // Enrollment configs
      const enrollmentConfigsList = enrollmentConfigs.map((e: any) => ({
        id: e.id,
        displayName: e.displayName || "Unnamed",
        type: e.enrollmentConfigurationType || "unknown",
        priority: e.priority ?? 0,
        createdDateTime: e.createdDateTime ?? null,
        lastModifiedDateTime: e.lastModifiedDateTime ?? null,
      }));

      // App protection policies
      const appProtectionList = appProtectionPolicies.map((p: any) => ({
        id: p.id,
        displayName: p.displayName || "Unnamed",
        description: p.description || "",
        platform: getPlatform(p["@odata.type"]),
        assignedGroups: 0,
        createdDateTime: p.createdDateTime ?? null,
        lastModifiedDateTime: p.lastModifiedDateTime ?? null,
      }));

      // Policy summary by OS
      const policyByOS: Record<string, { totalPolicies: number; policyNames: string[] }> = {};
      for (const p of compliancePolicies) {
        const platform = getPlatform(p["@odata.type"]);
        if (!policyByOS[platform]) policyByOS[platform] = { totalPolicies: 0, policyNames: [] };
        policyByOS[platform].totalPolicies++;
        policyByOS[platform].policyNames.push(p.displayName || "Unnamed");
      }
      const policySummaryByOS = Object.entries(policyByOS).map(([os, info]) => ({ os, ...info }));

      // Encryption / jailbreak (device-list only)
      const encryptedCount = devices.filter((d: any) => d.isEncrypted === true).length;
      const encryptionPercent =
        hasDeviceList ? Math.round((encryptedCount / totalDevices) * 100) : 0;
      const jailbrokenCount = devices.filter(
        (d: any) => d.jailBroken && d.jailBroken !== "Unknown" && d.jailBroken !== "Not applicable"
      ).length;

      const effectiveNonCompliant = hasDeviceList
        ? (compMap["noncompliant"] || 0)
        : nonCompliantFromSummary;

      // ── Section 4 assessment items ────────────────────────────────────────
      const assessmentItems = [
        {
          area: "Enrollment",
          item: "MDM Authority",
          value: "Microsoft Intune",
          status: totalDevices > 0 ? "Configured" : "Not configured",
          notes: "Microsoft Intune is the MDM authority for this tenant",
        },
        {
          area: "Enrollment",
          item: "Total Enrolled Devices",
          value: String(totalDevices),
          status: totalDevices > 0 ? "Active" : "None",
          notes: `${totalDevices} device(s) enrolled in Intune MDM`,
        },
        ...enrolledByOS.map((e) => ({
          area: "Enrollment",
          item: `Enrolled ${e.os} Devices`,
          value: String(e.count),
          status: "Enrolled",
          notes: `${e.count} ${e.os} device(s) under management`,
        })),
        {
          area: "Compliance",
          item: "Overall Device Compliance",
          value: `${overallCompliancePercent}%`,
          status:
            overallCompliancePercent >= 90
              ? "Good"
              : overallCompliancePercent >= 70
              ? "Warning"
              : "Critical",
          notes: `${compliantCount} of ${totalDevices} devices are compliant`,
        },
        ...complianceByOS.map((c) => ({
          area: "Compliance",
          item: `${c.os} Compliance`,
          value: `${c.compliancePercent}%`,
          status: c.compliancePercent >= 90 ? "Good" : c.compliancePercent >= 70 ? "Warning" : "Critical",
          notes: `${c.compliant} compliant / ${c.nonCompliant} non-compliant out of ${c.total}`,
        })),
        {
          area: "Compliance",
          item: "Non-Compliant Devices",
          value: String(effectiveNonCompliant),
          status: effectiveNonCompliant === 0 ? "Good" : "Action Required",
          notes: "Devices failing one or more compliance policies",
        },
        {
          area: "Compliance",
          item: "Devices in Grace Period",
          value: String(overallCompliance?.gracePeriodCount ?? 0),
          status: (overallCompliance?.gracePeriodCount ?? 0) === 0 ? "Good" : "Monitor",
          notes: "Devices with compliance issues but within the grace period",
        },
        {
          area: "Policies",
          item: "Compliance Policies Configured",
          value: String(compliancePolicies.length),
          status: compliancePolicies.length > 0 ? "Configured" : "Not configured",
          notes: `${compliancePolicies.length} compliance polic${compliancePolicies.length === 1 ? "y" : "ies"} defined`,
        },
        {
          area: "Policies",
          item: "Configuration Profiles",
          value: String(configProfiles.length),
          status: configProfiles.length > 0 ? "Configured" : "Not configured",
          notes: `${configProfiles.length} device configuration profile(s) deployed`,
        },
        {
          area: "Policies",
          item: "Enrollment Configurations",
          value: String(enrollmentConfigs.length),
          status: enrollmentConfigs.length > 0 ? "Configured" : "Not configured",
          notes: "Device enrollment restriction and limit configurations",
        },
        {
          area: "App Protection",
          item: "App Protection Policies",
          value: String(appProtectionPolicies.length),
          status: appProtectionPolicies.length > 0 ? "Configured" : "Not configured",
          notes: `${appProtectionPolicies.length} MAM app protection polic${appProtectionPolicies.length === 1 ? "y" : "ies"} in place`,
        },
        {
          area: "Security",
          item: "Device Encryption",
          value: `${encryptionPercent}%`,
          status:
            !hasDeviceList
              ? "N/A — device list unavailable"
              : encryptionPercent >= 90
              ? "Good"
              : encryptionPercent >= 70
              ? "Warning"
              : "Critical",
          notes: hasDeviceList
            ? `${encryptedCount} of ${totalDevices} devices reporting encryption enabled`
            : "Encryption data requires DeviceManagementManagedDevices.Read.All",
        },
        {
          area: "Security",
          item: "Jailbroken / Rooted Devices",
          value: hasDeviceList ? String(jailbrokenCount) : "N/A",
          status: !hasDeviceList ? "N/A" : jailbrokenCount === 0 ? "Good" : "Critical",
          notes: hasDeviceList
            ? jailbrokenCount === 0
              ? "No jailbroken or rooted devices detected"
              : `${jailbrokenCount} device(s) detected as jailbroken or rooted`
            : "Jailbreak data requires DeviceManagementManagedDevices.Read.All",
        },
      ];

      return {
        totalDevices,
        overallCompliancePercent,
        compliantDevices: compliantCount,
        nonCompliantDevices: effectiveNonCompliant,
        totalCompliancePolicies: compliancePolicies.length,
        totalConfigProfiles: configProfiles.length,
        totalAppProtectionPolicies: appProtectionPolicies.length,
        enrolledByOS,
        osVersionBreakdown,
        complianceByState,
        complianceByOS,
        deviceList,
        compliancePoliciesList,
        configProfilesList,
        enrollmentConfigsList,
        appProtectionList,
        overallCompliance,
        assessmentItems,
        encryptedDevices: encryptedCount,
        encryptionPercent,
        jailbrokenCount,
        permissionRequired,
        deviceListAvailable: hasDeviceList,
        policySummaryByOS,
      };
    });

    res.json(data);
  } catch (err: any) {
    req.log.error({ err }, "Intune route error");
    res.status(500).json({ error: String(err.message) });
  }
});

export default router;
