import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";

const router = Router();

router.get("/m365/compliance", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-compliance", async () => {
      const [dlpRes, retentionRes, labelsRes, compScoreRes] = await Promise.allSettled([
        graphClient.api("/security/informationProtection/policies/dlp/policies").get(),
        graphClient.api("/security/compliance/ediscovery/cases").top(1).get(),
        graphClient.api("/security/informationProtection/sensitivityLabels").get(),
        graphClient.api("/security/secureScores").top(1).get(),
      ]);

      const dlpPolicies = dlpRes.status === "fulfilled" ? dlpRes.value?.value ?? [] : [];
      const cases = retentionRes.status === "fulfilled" ? retentionRes.value?.value ?? [] : [];
      const labels = labelsRes.status === "fulfilled" ? labelsRes.value?.value ?? [] : [];
      const secScore = compScoreRes.status === "fulfilled" ? compScoreRes.value?.value?.[0] : null;

      const activeDlpPolicies = dlpPolicies.filter((p: any) => p.mode === "Enable" || p.mode === "enable").length;

      let retentionPolicies = 0;
      try {
        const retRes = await graphClient.api("/security/compliance/policies/retentionPolicies").get();
        retentionPolicies = retRes?.value?.length ?? 0;
      } catch {
        retentionPolicies = 0;
      }

      const complianceScore = secScore?.currentScore ?? 0;
      const complianceScoreMax = secScore?.maxScore ?? 100;

      return {
        dlpPolicies: dlpPolicies.length,
        activeDlpPolicies,
        retentionPolicies,
        sensitivityLabels: labels.length,
        dlpPolicyMatches: 0,
        complianceScore,
        complianceScoreMax,
        auditLogEnabled: true,
        unifiedAuditLogEnabled: true,
        eDiscoveryCases: cases.length,
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 compliance data");
    res.status(500).json({ error: "Failed to fetch M365 compliance data" });
  }
});

export default router;
