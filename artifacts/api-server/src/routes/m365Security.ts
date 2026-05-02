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

function summariseUsers(users: any): string {
  const include: string[] = users?.includeUsers ?? [];
  const roles: string[] = users?.includeRoles ?? [];
  const groups: string[] = users?.includeGroups ?? [];
  const parts: string[] = [];

  if (include.includes("All")) {
    parts.push("All Users");
  } else if (include.includes("GuestsOrExternalUsers")) {
    parts.push("Guests & External");
  } else if (include.length > 0) {
    parts.push(`${include.length} User(s)`);
  }

  if (roles.length > 0) {
    parts.push(`Admin Roles (${roles.length})`);
  }
  if (groups.length > 0) {
    parts.push(`Groups (${groups.length})`);
  }

  return parts.length > 0 ? parts.join(", ") : "None";
}

function summariseApps(apps: any): string {
  const include: string[] = apps?.includeApplications ?? [];
  const actions: string[] = apps?.includeUserActions ?? [];

  if (include.includes("All")) return "All Applications";
  if (actions.length > 0) return `User Actions (${actions.join(", ")})`;
  if (include.length > 0) return `${include.length} Application(s)`;
  return "None";
}

function summariseAuthStrength(grantControls: any): string {
  if (!grantControls) return "None";
  const strength = grantControls.authenticationStrength?.displayName;
  if (strength) return strength;
  const builtIn: string[] = grantControls.builtInControls ?? [];
  if (builtIn.length === 0) return "None";
  const labelMap: Record<string, string> = {
    mfa: "MFA Required",
    compliantDevice: "Compliant Device",
    domainJoinedDevice: "Domain Joined Device",
    approvedApplication: "Approved App",
    passwordChange: "Password Change",
    block: "Block",
  };
  return builtIn.map((c: string) => labelMap[c] ?? c).join(" + ");
}

router.get("/m365/security", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-security", async () => {
      const [secScoreData, secScoreHistoryData, caPoliciesData, mfaData, userCountData] =
        await Promise.all([
          fetchWithToken(
            "https://graph.microsoft.com/v1.0/security/secureScores?$top=1"
          ),
          fetchWithToken(
            "https://graph.microsoft.com/v1.0/security/secureScores?$top=30"
          ),
          fetchAllPages(
            "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?$top=999"
          ),
          fetchAllPages(
            "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$select=id,isMfaRegistered&$top=999"
          ),
          fetchWithToken(
            "https://graph.microsoft.com/v1.0/users/$count?$filter=accountEnabled eq true"
          ).catch(() => null),
        ]);

      const latestScore = secScoreData?.value?.[0] ?? null;
      const scoreHistory: any[] = secScoreHistoryData?.value ?? [];
      const caps: any[] = caPoliciesData ?? [];
      const mfaUsers: any[] = mfaData ?? [];

      const secureScore = latestScore?.currentScore ?? 0;
      const secureScoreMax = latestScore?.maxScore ?? 100;
      const secureScorePercent =
        secureScoreMax > 0
          ? Math.round((secureScore / secureScoreMax) * 100)
          : 0;

      const mfaEnabledUsers = mfaUsers.filter((u: any) => u.isMfaRegistered)
        .length;
      const mfaDisabledUsers = mfaUsers.length - mfaEnabledUsers;
      const mfaEnabledPercent =
        mfaUsers.length > 0
          ? Math.round((mfaEnabledUsers / mfaUsers.length) * 100)
          : 0;

      const enabledCAPs = caps.filter((c: any) => c.state === "enabled").length;
      const disabledCAPs = caps.filter(
        (c: any) => c.state === "disabled"
      ).length;
      const reportOnlyCAPs = caps.filter(
        (c: any) => c.state === "enabledForReportingButNotEnforced"
      ).length;

      const secureScoreHistory = scoreHistory
        .slice(0, 30)
        .reverse()
        .map((s: any) => ({
          date: s.createdDateTime?.split("T")[0] ?? "",
          score: s.currentScore ?? 0,
          maxScore: s.maxScore ?? 100,
        }));

      const controlCategories: {
        category: string;
        score: number;
        maxScore: number;
      }[] = [];
      if (latestScore?.controlScores) {
        const catMap = new Map<string, { score: number; maxScore: number }>();
        for (const ctrl of latestScore.controlScores) {
          const cat = ctrl.controlCategory ?? "Other";
          const existing = catMap.get(cat) ?? { score: 0, maxScore: 0 };
          catMap.set(cat, {
            score: existing.score + (ctrl.score ?? 0),
            maxScore:
              existing.maxScore +
              (ctrl.controlContributionToScore ?? ctrl.maxScore ?? 0),
          });
        }
        for (const [category, vals] of catMap.entries()) {
          controlCategories.push({
            category,
            score: Math.round(vals.score),
            maxScore: Math.round(vals.maxScore),
          });
        }
      }

      const caPolicies = caps.map((p: any) => ({
        id: p.id,
        displayName: p.displayName ?? "Unnamed Policy",
        state: p.state ?? "unknown",
        targetUsers: summariseUsers(p.conditions?.users),
        targetApps: summariseApps(p.conditions?.applications),
        authStrength: summariseAuthStrength(p.grantControls),
        modifiedDateTime: p.modifiedDateTime ?? null,
      }));

      let riskyUsers = 0;
      try {
        const riskyRes = await fetchWithToken(
          "https://graph.microsoft.com/v1.0/identityProtection/riskyUsers?$filter=riskState eq 'atRisk'&$count=true"
        );
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
        caPolicies,
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
