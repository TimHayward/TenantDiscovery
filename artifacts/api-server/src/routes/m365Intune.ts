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
            "lastSyncDateTime,userDisplayName,userPrincipalName,manufacturer,model," +
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
      // Graph returns "Unknown" for non-mobile OSes, "False"/"false" for safe mobile, "True"/"true" for compromised
      const jailbrokenCount = devices.filter(
        (d: any) => typeof d.jailBroken === "string" && d.jailBroken.toLowerCase() === "true"
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

// ── Per-device compliance drill-down ─────────────────────────────────────────
router.get("/m365/intune/device/:deviceId/compliance", async (req, res) => {
  const { deviceId } = req.params;
  try {
    const token = await getToken();
    const encodedId = encodeURIComponent(deviceId);

    // Fetch all compliance policy states for this device
    const policyStatesResult = await fetchAllPages(
      `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodedId}/deviceCompliancePolicyStates`,
      token
    );

    if (policyStatesResult.permissionDenied) {
      return res.status(403).json({ error: "Permission denied" });
    }

    const policyStates = policyStatesResult.items;
    const NON_COMPLIANT = new Set(["noncompliant", "nonCompliant", "error"]);

    // For each non-compliant policy fetch its setting-level states in parallel
    const policies = await Promise.all(
      policyStates.map(async (policy: any) => {
        const isNonCompliant = NON_COMPLIANT.has(policy.state);
        let failingRules: Array<{
          settingName: string;
          state: string;
          errorDescription: string;
        }> = [];

        if (isNonCompliant) {
          try {
            const settingResult = await fetchAllPages(
              `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodedId}/deviceCompliancePolicyStates/${encodeURIComponent(policy.id)}/settingStates`,
              token
            );
            failingRules = settingResult.items
              .filter((s: any) => NON_COMPLIANT.has(s.state))
              .map((s: any) => ({
                settingName: s.settingName || "",
                state: s.state || "unknown",
                errorDescription: s.errorDescription || "",
              }));
          } catch {
            // setting states unavailable for this policy — skip gracefully
          }
        }

        return {
          policyId: policy.id as string,
          policyName: (policy.displayName || "Unknown Policy") as string,
          platformType: (policy.platformType || "unknown") as string,
          state: (policy.state || "unknown") as string,
          lastReportedDateTime: (policy.lastReportedDateTime || null) as string | null,
          failingRules,
        };
      })
    );

    res.json({
      deviceId,
      totalPolicies: policies.length,
      nonCompliantPolicies: policies.filter((p) => NON_COMPLIANT.has(p.state)).length,
      policies,
    });
  } catch (err: any) {
    req.log.error({ err }, "Device compliance detail error");
    res.status(500).json({ error: String(err.message) });
  }
});

// ── helper: derive UI platform from @odata.type ───────────────────────────────
function platformFromOdataType(odataType: string): string {
  const t = (odataType || "").toLowerCase();
  if (t.includes("windows") || t.includes("win32") || t.includes("microsoftedge")) return "Windows";
  if (t.includes("ios") || t.includes("ipad")) return "iOS";
  if (t.includes("android")) return "Android";
  if (t.includes("macos") || t.includes("mac")) return "macOS";
  if (t.includes("web")) return "Web";
  return "Other";
}

function platformFromDetected(platform: string): string {
  switch ((platform || "").toLowerCase()) {
    case "windows":       return "Windows";
    case "windowsmobile": return "Windows Mobile";
    case "ios":           return "iOS";
    case "android":       return "Android";
    case "macos":         return "macOS";
    default:              return "Other";
  }
}

router.get("/m365/intune/apps", async (req, res) => {
  try {
    const data = await getCached("m365-intune-apps", async () => {
      const token = await getToken();

      // ── fetch install report + detected apps in parallel ─────────────────
      const [installReportRaw, detectedAppsResult] = await Promise.all([
        // Reports API — returns columnar data with per-app install counts
        (async () => {
          const allRows: any[][] = [];
          let skip = 0;
          const top = 200;
          let totalRowCount = 0;
          let schema: { Column: string }[] = [];
          let permissionDenied = false;
          do {
            const resp = await fetch(
              "https://graph.microsoft.com/beta/deviceManagement/reports/getAppsInstallSummaryReport",
              {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ top, skip, filter: "" }),
              }
            );
            if (PERMISSION_ERROR_CODES.has(resp.status)) { permissionDenied = true; break; }
            if (!resp.ok) break;
            const d = await resp.json();
            if (schema.length === 0) schema = d.Schema || [];
            totalRowCount = d.TotalRowCount ?? 0;
            allRows.push(...(d.Values || []));
            skip += top;
          } while (allRows.length < totalRowCount);
          return { rows: allRows, schema, permissionDenied };
        })(),
        fetchAllPages(
          "https://graph.microsoft.com/beta/deviceManagement/detectedApps" +
            "?$select=id,displayName,version,sizeInByte,deviceCount,platform",
          token
        ),
      ]);

      const installPermissionRequired = installReportRaw.permissionDenied;
      const discoveryPermissionRequired = detectedAppsResult.permissionDenied;

      // Build column index map from schema
      const colIdx: Record<string, number> = {};
      installReportRaw.schema.forEach((s: { Column: string }, i: number) => { colIdx[s.Column] = i; });

      // ── Section 1: App installation health ───────────────────────────────
      let totalInstalled = 0, totalFailed = 0, totalPending = 0, totalNotApplicable = 0, totalNotInstalled = 0;
      const installMap: Record<string, { installed: number; failed: number; pending: number; notApplicable: number; notInstalled: number }> = {};

      const appInstallList = installReportRaw.rows.map((row: any[]) => {
        const id            = String(row[colIdx["ApplicationId"]]                ?? "");
        const displayName   = String(row[colIdx["DisplayName"]]                  ?? "Unknown");
        const publisher     = row[colIdx["Publisher"]] != null ? String(row[colIdx["Publisher"]]) : null;
        const platform      = String(row[colIdx["AppPlatform"]]                  ?? "Other");
        const installed     = Number(row[colIdx["InstalledDeviceCount"]])         || 0;
        const failed        = Number(row[colIdx["FailedDeviceCount"]])            || 0;
        const pending       = Number(row[colIdx["PendingInstallDeviceCount"]])    || 0;
        const notApplicable = Number(row[colIdx["NotApplicableDeviceCount"]])     || 0;
        const notInstalled  = Number(row[colIdx["NotInstalledDeviceCount"]])      || 0;

        totalInstalled     += installed;
        totalFailed        += failed;
        totalPending       += pending;
        totalNotApplicable += notApplicable;
        totalNotInstalled  += notInstalled;

        if (!installMap[platform]) installMap[platform] = { installed: 0, failed: 0, pending: 0, notApplicable: 0, notInstalled: 0 };
        installMap[platform].installed     += installed;
        installMap[platform].failed        += failed;
        installMap[platform].pending       += pending;
        installMap[platform].notApplicable += notApplicable;
        installMap[platform].notInstalled  += notInstalled;

        return { id, displayName, publisher, platform, installed, failed, pending, notApplicable, notInstalled };
      });

      const installByPlatform = Object.entries(installMap)
        .map(([platform, counts]) => ({ platform, ...counts }))
        .sort((a, b) => (b.installed + b.failed) - (a.installed + a.failed));

      // ── Section 2: Discovered app estate ─────────────────────────────────
      const detectedApps = detectedAppsResult.items;
      // Cross-reference managed app names from the install report
      const managedNames = new Set(appInstallList.map((a) => a.displayName.toLowerCase().trim()));

      let managedDiscoveredApps = 0, unmanagedDiscoveredApps = 0;
      const discoveredMap: Record<string, { managed: number; unmanaged: number }> = {};

      const discoveredAppList = detectedApps.map((app: any) => {
        const platform = platformFromDetected(app.platform || "");
        const managed = managedNames.has((app.displayName || "").toLowerCase().trim());
        if (!discoveredMap[platform]) discoveredMap[platform] = { managed: 0, unmanaged: 0 };
        if (managed) { managedDiscoveredApps++; discoveredMap[platform].managed++; }
        else          { unmanagedDiscoveredApps++; discoveredMap[platform].unmanaged++; }
        return {
          id: app.id,
          displayName: app.displayName || "Unknown",
          version: app.version ?? null,
          deviceCount: app.deviceCount ?? 0,
          platform,
          managed,
        };
      });

      const discoveredByPlatform = Object.entries(discoveredMap)
        .map(([platform, counts]) => ({ platform, ...counts }))
        .sort((a, b) => (b.managed + b.unmanaged) - (a.managed + a.unmanaged));

      return {
        installPermissionRequired,
        discoveryPermissionRequired,
        totalAssignedApps: appInstallList.length,
        totalInstalled,
        totalFailed,
        totalPending,
        totalNotApplicable,
        totalNotInstalled,
        installByPlatform,
        appInstallList,
        totalDiscoveredApps: detectedApps.length,
        managedDiscoveredApps,
        unmanagedDiscoveredApps,
        discoveredByPlatform,
        discoveredAppList,
      };
    });

    res.json(data);
  } catch (err: any) {
    req.log.error({ err }, "Intune apps error");
    res.status(500).json({ error: String(err.message) });
  }
});

export default router;
