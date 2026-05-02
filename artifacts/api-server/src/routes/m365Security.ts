import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";

const router = Router();

router.get("/m365/security", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-security", async () => {
      const [secScoreRes, secScoreHistoryRes, capRes, mfaRes, userCountRes] = await Promise.allSettled([
        graphClient.api("/security/secureScores").top(1).get(),
        graphClient.api("/security/secureScores").top(30).get(),
        graphClient.api("/identity/conditionalAccess/policies").select("id,displayName,state").get(),
        graphClient.api("/reports/authenticationMethods/userRegistrationDetails").select("id,isMfaRegistered").top(999).get(),
        graphClient.api("/users").count(true).header("ConsistencyLevel", "eventual").select("id").get(),
      ]);

      const latestScore = secScoreRes.status === "fulfilled" ? secScoreRes.value?.value?.[0] : null;
      const scoreHistory = secScoreHistoryRes.status === "fulfilled" ? secScoreHistoryRes.value?.value ?? [] : [];
      const caps = capRes.status === "fulfilled" ? capRes.value?.value ?? [] : [];
      const mfaUsers = mfaRes.status === "fulfilled" ? mfaRes.value?.value ?? [] : [];
      const totalUsers = userCountRes.status === "fulfilled"
        ? (userCountRes.value?.["@odata.count"] ?? userCountRes.value?.value?.length ?? 0)
        : 0;

      const secureScore = latestScore?.currentScore ?? 0;
      const secureScoreMax = latestScore?.maxScore ?? 100;
      const secureScorePercent = secureScoreMax > 0 ? Math.round((secureScore / secureScoreMax) * 100) : 0;

      const mfaEnabledUsers = mfaUsers.filter((u: any) => u.isMfaRegistered).length;
      const mfaDisabledUsers = mfaUsers.length - mfaEnabledUsers;
      const mfaEnabledPercent = mfaUsers.length > 0
        ? Math.round((mfaEnabledUsers / mfaUsers.length) * 100)
        : 0;

      const enabledCAPs = caps.filter((c: any) => c.state === "enabled").length;
      const disabledCAPs = caps.filter((c: any) => c.state === "disabled").length;
      const reportOnlyCAPs = caps.filter((c: any) => c.state === "enabledForReportingButNotEnforced").length;

      const secureScoreHistory = scoreHistory
        .slice(0, 30)
        .reverse()
        .map((s: any) => ({
          date: s.createdDateTime?.split("T")[0] ?? "",
          score: s.currentScore ?? 0,
          maxScore: s.maxScore ?? 100,
        }));

      const controlCategories: { category: string; score: number; maxScore: number }[] = [];
      if (latestScore?.controlScores) {
        const catMap = new Map<string, { score: number; maxScore: number }>();
        for (const ctrl of latestScore.controlScores) {
          const cat = ctrl.controlCategory ?? "Other";
          const existing = catMap.get(cat) ?? { score: 0, maxScore: 0 };
          catMap.set(cat, {
            score: existing.score + (ctrl.score ?? 0),
            maxScore: existing.maxScore + (ctrl.controlContributionToScore ?? ctrl.maxScore ?? 0),
          });
        }
        for (const [category, vals] of catMap.entries()) {
          controlCategories.push({ category, score: Math.round(vals.score), maxScore: Math.round(vals.maxScore) });
        }
      }

      let riskyUsers = 0;
      try {
        const riskyRes = await graphClient.api("/identityProtection/riskyUsers")
          .filter("riskState eq 'atRisk'")
          .count(true)
          .header("ConsistencyLevel", "eventual")
          .get();
        riskyUsers = riskyRes?.["@odata.count"] ?? 0;
      } catch {
        riskyUsers = 0;
      }

      return {
        secureScore,
        secureScoreMax,
        secureScorePercent,
        mfaEnabledUsers,
        mfaDisabledUsers,
        mfaEnabledPercent,
        conditionalAccessPolicies: caps.length,
        enabledCAPs,
        disabledCAPs,
        reportOnlyCAPs,
        secureScoreHistory,
        controlCategories,
        riskyUsers,
        adminsWithoutMfa: mfaDisabledUsers,
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 security data");
    res.status(500).json({ error: "Failed to fetch M365 security data" });
  }
});

export default router;
