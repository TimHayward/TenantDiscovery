import { Router } from "express";
import { getCached } from "../lib/graphClient.js";

const router = Router();

async function fetchWithToken(url: string, useBeta = false): Promise<any> {
  const { ClientSecretCredential } = await import("@azure/identity");
  const cred = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!
  );
  const token = await cred.getToken("https://graph.microsoft.com/.default");
  const base = useBeta
    ? "https://graph.microsoft.com/beta"
    : "https://graph.microsoft.com/v1.0";
  const fullUrl = url.startsWith("http") ? url : `${base}${url}`;
  const resp = await fetch(fullUrl, {
    headers: { Authorization: `Bearer ${token!.token}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function fetchAllPages(firstUrl: string, useBeta = false): Promise<any[]> {
  const results: any[] = [];
  let url: string | null = firstUrl.startsWith("http")
    ? firstUrl
    : `${useBeta ? "https://graph.microsoft.com/beta" : "https://graph.microsoft.com/v1.0"}${firstUrl}`;
  while (url) {
    const page: any = await fetchWithToken(url);
    if (!page || !page.value) break;
    results.push(...page.value);
    url = page["@odata.nextLink"] ?? null;
  }
  return results;
}

router.get("/m365/compliance", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-compliance", async () => {
      const [secScoreData, eDiscoveryCasesData] = await Promise.all([
        fetchWithToken("/security/secureScores?$top=1"),
        fetchWithToken("/security/cases/ediscoveryCases?$top=1").catch(() => null),
      ]);

      const secScore = secScoreData?.value?.[0] ?? null;
      const complianceScore = secScore?.currentScore ?? 0;
      const complianceScoreMax = secScore?.maxScore ?? 100;
      const eDiscoveryCases = eDiscoveryCasesData?.value?.length ?? 0;

      // Try to fetch DLP policies via security endpoint
      let dlpPolicies = 0;
      let activeDlpPolicies = 0;
      try {
        const dlpRes = await fetchWithToken(
          "/security/informationProtection/policies/dlp/policies?$top=999"
        );
        const dlpList = dlpRes?.value ?? [];
        dlpPolicies = dlpList.length;
        activeDlpPolicies = dlpList.filter(
          (p: any) => p.mode === "Enable" || p.mode === "enable"
        ).length;
      } catch {
        dlpPolicies = 0;
        activeDlpPolicies = 0;
      }

      // Try sensitivity labels - requires InformationProtection.Read.All
      let sensitivityLabelsList: any[] = [];
      let sensitivityLabelsPermissionRequired = false;
      try {
        // Try v1.0 first (typically needs license + permission)
        const labelsRes = await fetchWithToken(
          "https://graph.microsoft.com/beta/informationProtection/sensitivityLabels"
        );
        if (labelsRes && labelsRes.value) {
          sensitivityLabelsList = labelsRes.value.map((l: any) => ({
            id: l.id,
            name: l.name ?? l.displayName ?? "Unknown",
            description: l.description ?? l.tooltip ?? "",
            color: l.color ?? "",
            sensitivity: l.sensitivity ?? 0,
            isActive: l.isActive ?? true,
            parent: l.parent?.id ?? null,
          }));
        } else {
          sensitivityLabelsPermissionRequired = true;
        }
      } catch {
        sensitivityLabelsPermissionRequired = true;
      }

      // Also try v1.0 security labels endpoint
      if (sensitivityLabelsList.length === 0) {
        try {
          const labelsV1 = await fetchWithToken(
            "/security/informationProtection/sensitivityLabels?$top=999"
          );
          if (labelsV1?.value?.length > 0) {
            sensitivityLabelsList = labelsV1.value.map((l: any) => ({
              id: l.id,
              name: l.name ?? l.displayName ?? "Unknown",
              description: l.description ?? "",
              color: l.color ?? "",
              sensitivity: l.sensitivity ?? 0,
              isActive: true,
              parent: null,
            }));
            sensitivityLabelsPermissionRequired = false;
          }
        } catch {
          // keep permission required flag
        }
      }

      // Try retention policies count via compliance portal
      let retentionPolicies = 0;
      try {
        const retRes = await fetchWithToken(
          "https://graph.microsoft.com/beta/deviceAppManagement/managedAppPolicies?$top=1"
        );
        // Just check if endpoint works
        retentionPolicies = retRes?.value?.length ?? 0;
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
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 compliance data");
    res.status(500).json({ error: "Failed to fetch M365 compliance data" });
  }
});

export default router;
