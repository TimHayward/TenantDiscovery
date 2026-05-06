import { Router } from "express";
import { ClientSecretCredential } from "@azure/identity";
import { getCached } from "../lib/graphClient.js";
import { getPermissionMetadataForFeature } from "../lib/permissionMetadata.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

const PERMISSION_ERROR_CODES = new Set([401, 403]);

async function getToken(): Promise<string> {
  const cred = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!
  );
  const result = await cred.getToken("https://graph.microsoft.com/.default");
  return result!.token;
}

async function fetchWithToken(
  url: string,
  token: string
): Promise<{ data: any; status: number }> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return { data: null, status: resp.status };
  return { data: await resp.json(), status: resp.status };
}

async function fetchAllPages(
  firstUrl: string,
  token: string
): Promise<{ items: any[]; permissionDenied: boolean }> {
  const items: any[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const { data, status } = await fetchWithToken(url, token);
    if (PERMISSION_ERROR_CODES.has(status)) return { items: [], permissionDenied: true };
    if (!data || !data.value) break;
    items.push(...data.value);
    url = data["@odata.nextLink"] ?? null;
  }
  return { items, permissionDenied: false };
}

async function getComplianceData() {
  const labelsPermissionMetadata = getPermissionMetadataForFeature("compliance-sensitivity-labels");
  return getCached("m365-compliance", async () => {
    const token = await getToken();

    const [secScoreResult, eDiscoveryResult, dlpResult, labelsResult] =
      await Promise.all([
        fetchWithToken(
          "https://graph.microsoft.com/v1.0/security/secureScores?$top=1",
          token
        ),
        fetchWithToken(
          "https://graph.microsoft.com/v1.0/security/cases/ediscoveryCases?$top=1",
          token
        ).catch(() => ({ data: null, status: 500 })),
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/security/informationProtection/policies/dlp/policies?$top=999",
          token
        ).catch(() => ({ items: [], permissionDenied: false })),
        fetchAllPages(
          "https://graph.microsoft.com/beta/security/informationProtection/sensitivityLabels",
          token
        ),
      ]);

    const secScore = secScoreResult.data?.value?.[0] ?? null;
    const complianceScore = secScore?.currentScore ?? 0;
    const complianceScoreMax = secScore?.maxScore ?? 100;

    const eDiscoveryCases = eDiscoveryResult.data?.value?.length ?? 0;

    const dlpList = dlpResult.items;
    const dlpPolicies = dlpList.length;
    const activeDlpPolicies = dlpList.filter(
      (p: any) => p.mode === "Enable" || p.mode === "enable"
    ).length;

    const sensitivityLabelsPermissionRequired = labelsResult.permissionDenied;
    const sensitivityLabelsList = labelsResult.items.map((l: any) => ({
      id: l.id,
      name: l.name ?? "Unknown",
      description: l.description ?? "",
      tooltip: l.tooltip ?? "",
      color: l.color ?? "",
      sensitivity: l.sensitivity ?? 0,
      isActive: l.isActive ?? true,
      isAppliable: l.isAppliable ?? true,
      hasProtection: l.hasProtection ?? false,
      contentFormats: l.contentFormats ?? [],
      parent: l.parent?.id ?? null,
    }));

    let retentionPolicies = 0;
    try {
      const { data: retData } = await fetchWithToken(
        "https://graph.microsoft.com/beta/deviceAppManagement/managedAppPolicies?$top=999",
        token
      );
      retentionPolicies = retData?.value?.length ?? 0;
    } catch {
      retentionPolicies = 0;
    }

    return {
      dlpPolicies,
      activeDlpPolicies,
      retentionPolicies,
      sensitivityLabels: sensitivityLabelsList.length,
      dlpPolicyMatches: 0,
      complianceScore,
      complianceScoreMax,
      auditLogEnabled: true,
      unifiedAuditLogEnabled: true,
      eDiscoveryCases,
      sensitivityLabelsList,
      sensitivityLabelsPermissionRequired,
      permissionMetadata: labelsPermissionMetadata,
    };
  });
}

router.get("/m365/compliance", async (req, res): Promise<void> => {
  try {
    const data = await getComplianceData();

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 compliance data");
    res.status(500).json({ error: "Failed to fetch M365 compliance data" });
  }
});

router.get("/m365/compliance/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getComplianceData();

    const fieldMetadata = {
      dlpPolicies: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "InformationProtectionPolicy.Read.All",
      },
      activeDlpPolicies: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "InformationProtectionPolicy.Read.All",
      },
      retentionPolicies: {
        evidenceStatus: "partial" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "DeviceAppManagement.Read.All",
        notes: ["Proxy count from managed app policies"],
      },
      sensitivityLabels: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "InformationProtectionPolicy.Read.All",
      },
      complianceScore: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SecurityEvents.Read.All",
      },
      complianceScoreMax: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SecurityEvents.Read.All",
      },
      eDiscoveryCases: {
        evidenceStatus: "partial" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "eDiscovery.Read.All",
      },
      sensitivityLabelsList: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "InformationProtectionPolicy.Read.All",
      },
      sensitivityLabelsPermissionRequired: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Derived from labels endpoint permission probe",
      },
      permissionMetadata: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Static permission manifest",
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 compliance data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 compliance data" });
  }
});

export default router;
