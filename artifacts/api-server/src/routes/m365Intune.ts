import { Router } from "express";
import { getCached } from "../lib/graphClient.js";

const router = Router();

async function fetchWithToken(url: string): Promise<any> {
  const { ClientSecretCredential } = await import("@azure/identity");
  const cred = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!
  );
  const token = await cred.getToken("https://graph.microsoft.com/.default");
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token!.token}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function fetchAllPages(firstUrl: string): Promise<any[]> {
  const results: any[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const page: any = await fetchWithToken(url);
    if (!page || !page.value) break;
    results.push(...page.value);
    url = page["@odata.nextLink"] ?? null;
  }
  return results;
}

router.get("/m365/intune", async (req, res) => {
  try {
    const data = await getCached("m365-intune", async () => {
      // ── parallel fetch ───────────────────────────────────────────────────
      const [
        devices,
        compliancePolicies,
        configProfiles,
        enrollmentConfigs,
        complianceSummary,
        appProtectionPolicies,
      ] = await Promise.all([
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices" +
            "?$select=id,deviceName,operatingSystem,osVersion,complianceState,enrolledDateTime," +
            "lastSyncDateTime,userDisplayName,userPrincipalName,manufacturer,model,deviceType," +
            "managementAgent,managementState,isEncrypted,isSupervised,jailBroken"
        ),
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicies" +
            "?$select=id,displayName,description,createdDateTime,lastModifiedDateTime&$expand=assignments($select=id,target)"
        ),
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations" +
            "?$select=id,displayName,description,createdDateTime,lastModifiedDateTime&$expand=assignments($select=id,target)"
        ),
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/deviceManagement/deviceEnrollmentConfigurations" +
            "?$select=id,displayName,description,enrollmentConfigurationType,createdDateTime,lastModifiedDateTime,priority"
        ),
        fetchWithToken(
          "https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicyDeviceStateSummary"
        ),
        fetchAllPages(
          "https://graph.microsoft.com/beta/deviceAppManagement/managedAppPolicies" +
            "?$select=id,displayName,description,createdDateTime,lastModifiedDateTime"
        ),
      ]);

      // ── permission check ─────────────────────────────────────────────────
      const permissionRequired = !devices || devices.length === 0;

      // ── KPIs ─────────────────────────────────────────────────────────────
      const totalDevices = devices.length;

      // Enrolled by OS
      const byOS: Record<string, number> = {};
      for (const d of devices) {
        const os = d.operatingSystem || "Unknown";
        byOS[os] = (byOS[os] || 0) + 1;
      }
      const enrolledByOS = Object.entries(byOS)
        .map(([os, count]) => ({ os, count }))
        .sort((a, b) => b.count - a.count);

      // OS version breakdown per platform
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

      // Compliance state breakdown
      const compMap: Record<string, number> = {};
      for (const d of devices) {
        const state = d.complianceState || "unknown";
        compMap[state] = (compMap[state] || 0) + 1;
      }
      const complianceByState = Object.entries(compMap)
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count);

      const compliantCount = compMap["compliant"] || 0;
      const overallCompliancePercent =
        totalDevices > 0 ? Math.round((compliantCount / totalDevices) * 100) : 0;

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

      // Device list with enriched fields
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

      // Policy summary per OS
      const policyByOS: Record<string, { totalPolicies: number; policyNames: string[] }> = {};
      for (const d of deviceList) {
        if (!policyByOS[d.operatingSystem]) {
          policyByOS[d.operatingSystem] = { totalPolicies: 0, policyNames: [] };
        }
      }
      for (const p of compliancePolicies) {
        const type: string = (p["@odata.type"] || "").toLowerCase();
        let platform = "Unknown";
        if (type.includes("windows")) platform = "Windows";
        else if (type.includes("ios")) platform = "iOS";
        else if (type.includes("android")) platform = "Android";
        else if (type.includes("macos")) platform = "macOS";
        if (!policyByOS[platform]) policyByOS[platform] = { totalPolicies: 0, policyNames: [] };
        policyByOS[platform].totalPolicies++;
        policyByOS[platform].policyNames.push(p.displayName || "Unnamed");
      }
      const policySummaryByOS = Object.entries(policyByOS).map(([os, info]) => ({ os, ...info }));

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

      // Encryption summary
      const encryptedCount = devices.filter((d: any) => d.isEncrypted === true).length;
      const encryptionPercent =
        totalDevices > 0 ? Math.round((encryptedCount / totalDevices) * 100) : 0;

      // Jailbroken/rooted
      const jailbrokenCount = devices.filter(
        (d: any) =>
          d.jailBroken &&
          d.jailBroken !== "Unknown" &&
          d.jailBroken !== "Not applicable"
      ).length;

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

      // Overall compliance summary from API
      const overallCompliance = complianceSummary
        ? {
            compliantDeviceCount: complianceSummary.compliantDeviceCount ?? compliantCount,
            noncompliantDeviceCount:
              complianceSummary.nonCompliantDeviceCount ?? (compMap["noncompliant"] || 0),
            remediatedDeviceCount: complianceSummary.remediatedDeviceCount ?? 0,
            notApplicableDeviceCount: complianceSummary.notApplicableDeviceCount ?? 0,
            notAssignedDeviceCount:
              complianceSummary.notAssignedDeviceCount ?? (compMap["unknown"] || 0),
            gracePeriodCount: complianceSummary.inGracePeriodCount ?? 0,
            configManagerCount: complianceSummary.configManagerCount ?? 0,
          }
        : null;

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
          status:
            c.compliancePercent >= 90 ? "Good" : c.compliancePercent >= 70 ? "Warning" : "Critical",
          notes: `${c.compliant} compliant / ${c.nonCompliant} non-compliant out of ${c.total}`,
        })),
        {
          area: "Compliance",
          item: "Non-Compliant Devices",
          value: String(compMap["noncompliant"] || 0),
          status: (compMap["noncompliant"] || 0) === 0 ? "Good" : "Action Required",
          notes: "Devices failing one or more compliance policies",
        },
        {
          area: "Compliance",
          item: "Devices in Grace Period",
          value: String(overallCompliance?.gracePeriodCount ?? compMap["inGracePeriod"] ?? 0),
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
            encryptionPercent >= 90
              ? "Good"
              : encryptionPercent >= 70
              ? "Warning"
              : totalDevices === 0
              ? "N/A"
              : "Critical",
          notes: `${encryptedCount} of ${totalDevices} devices reporting encryption enabled`,
        },
        {
          area: "Security",
          item: "Jailbroken / Rooted Devices",
          value: String(jailbrokenCount),
          status: jailbrokenCount === 0 ? "Good" : "Critical",
          notes:
            jailbrokenCount === 0
              ? "No jailbroken or rooted devices detected"
              : `${jailbrokenCount} device(s) detected as jailbroken or rooted`,
        },
      ];

      return {
        totalDevices,
        overallCompliancePercent,
        compliantDevices: compliantCount,
        nonCompliantDevices: compMap["noncompliant"] || 0,
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
