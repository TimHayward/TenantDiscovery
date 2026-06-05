import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectIntune, collectIntuneApps } from "../lib/collectors/intune.js";
import { getGraphCredentialValues } from "../lib/graphClient.js";
import {
  getPermissionMetadataForFeature,
} from "../lib/permissionMetadata.js";

const router = Router();

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

router.get("/m365/intune", async (req, res) => {
  try {
    const data = await getOrFetch("m365-intune", collectIntune);
    res.json(data);
  } catch (err: any) {
    req.log.error({ err }, "Intune route error");
    res.status(500).json({ error: String(err.message) });
  }
});

router.get("/m365/intune/with-metadata", async (req, res) => {
  try {
    const data = await getOrFetch("m365-intune", collectIntune);

    const fieldMetadata = {
      totalDevices: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["Falls back to compliance summary when managedDevices list is unavailable"] },
      overallCompliancePercent: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["Computed from available device or summary counts"] },
      compliantDevices: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["May be sourced from summary endpoint when device list is denied"] },
      nonCompliantDevices: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["May be sourced from summary endpoint when device list is denied"] },
      totalCompliancePolicies: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "DeviceManagementConfiguration.Read.All", notes: ["Count of compliance policies from Graph deviceManagement endpoint"] },
      totalConfigProfiles: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "DeviceManagementConfiguration.Read.All", notes: ["Count of device configuration profiles from Graph"] },
      totalAppProtectionPolicies: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementApps.Read.All", notes: ["Uses beta managed app policies endpoint"] },
      tamperProtectionEnabledDevices: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["Counted from windowsProtectionState.tamperProtectionEnabled on Windows managed devices"] },
      tamperProtectionDisabledDevices: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["Counted from windowsProtectionState.tamperProtectionEnabled on Windows managed devices"] },
      tamperProtectionUnknownDevices: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["Windows devices that did not return a tamper protection state"] },
      tamperProtectionPercent: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["Derived from the Windows managed device protection state"] },
      enrolledByOS: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["Available only when managed device list is accessible"] },
      complianceByState: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["Combines direct device states with summary fallback"] },
      deviceList: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "DeviceManagementManagedDevices.Read.All", notes: ["Empty when permission denied or endpoint unavailable"] },
      permissionRequired: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "HTTP status inspection", notes: ["True when managedDevices endpoint returns 401/403"] },
      deviceListAvailable: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route execution state", notes: ["Indicates whether detailed device list is present"] },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err: any) {
    req.log.error({ err }, "Intune route with metadata error");
    res.status(500).json({ error: String(err.message) });
  }
});

// Per-device compliance drill-down — not cached (per-device, dynamic)
router.get("/m365/intune/device/:deviceId/compliance", async (req, res) => {
  const { deviceId } = req.params;
  try {
    const token = await getToken();
    const encodedId = encodeURIComponent(deviceId);

    const policyStatesResult = await fetchAllPages(
      `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodedId}/deviceCompliancePolicyStates`,
      token,
    );

    if (policyStatesResult.permissionDenied) {
      return res.status(403).json({ error: "Permission denied", permissionMetadata: getPermissionMetadataForFeature("intune-devices") });
    }

    const policyStates = policyStatesResult.items;
    const NON_COMPLIANT = new Set(["noncompliant", "nonCompliant", "error"]);

    const policies = await Promise.all(policyStates.map(async (policy: any) => {
      const isNonCompliant = NON_COMPLIANT.has(policy.state);
      let failingRules: Array<{ settingName: string; state: string; errorDescription: string }> = [];
      if (isNonCompliant) {
        try {
          const settingResult = await fetchAllPages(
            `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${encodedId}/deviceCompliancePolicyStates/${encodeURIComponent(policy.id)}/settingStates`,
            token,
          );
          failingRules = settingResult.items.filter((s: any) => NON_COMPLIANT.has(s.state)).map((s: any) => ({ settingName: s.settingName || "", state: s.state || "unknown", errorDescription: s.errorDescription || "" }));
        } catch { /* skip gracefully */ }
      }
      return { policyId: policy.id as string, policyName: (policy.displayName || "Unknown Policy") as string, platformType: (policy.platformType || "unknown") as string, state: (policy.state || "unknown") as string, lastReportedDateTime: (policy.lastReportedDateTime || null) as string | null, failingRules };
    }));

    return res.json({ deviceId, totalPolicies: policies.length, nonCompliantPolicies: policies.filter((p) => NON_COMPLIANT.has(p.state)).length, policies });
  } catch (err: any) {
    req.log.error({ err }, "Device compliance detail error");
    return res.status(500).json({ error: String(err.message) });
  }
});

router.get("/m365/intune/apps", async (req, res) => {
  try {
    const data = await getOrFetch("m365-intune-apps", collectIntuneApps);
    res.json(data);
  } catch (err: any) {
    req.log.error({ err }, "Intune apps error");
    res.status(500).json({ error: String(err.message) });
  }
});

export default router;
