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
  if (include.includes("All")) parts.push("All Users");
  else if (include.includes("GuestsOrExternalUsers")) parts.push("Guests & External");
  else if (include.length > 0) parts.push(`${include.length} User(s)`);
  if (roles.length > 0) parts.push(`Admin Roles (${roles.length})`);
  if (groups.length > 0) parts.push(`Groups (${groups.length})`);
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

// Microsoft-documented MFA method strength ranking
const MFA_METHOD_META: Record<string, { displayName: string; strength: string; strengthLevel: number }> = {
  // Phishing-resistant (level 4)
  fido2:                              { displayName: "FIDO2 Security Key",              strength: "Phishing-resistant", strengthLevel: 4 },
  windowsHelloForBusiness:            { displayName: "Windows Hello for Business",      strength: "Phishing-resistant", strengthLevel: 4 },
  x509CertificateMultiFactor:         { displayName: "Certificate-based Auth (MFA)",    strength: "Phishing-resistant", strengthLevel: 4 },
  microsoftAuthenticatorPasswordless: { displayName: "Authenticator Passwordless",      strength: "Phishing-resistant", strengthLevel: 4 },
  passKeyDeviceBound:                 { displayName: "Passkey (Device-bound)",          strength: "Phishing-resistant", strengthLevel: 4 },
  passKeyDeviceBoundAuthenticator:    { displayName: "Passkey (Authenticator)",         strength: "Phishing-resistant", strengthLevel: 4 },
  // Strong (level 3)
  microsoftAuthenticatorPush:         { displayName: "Microsoft Authenticator (Push)",  strength: "Strong",             strengthLevel: 3 },
  microsoftAuthenticator:             { displayName: "Microsoft Authenticator",         strength: "Strong",             strengthLevel: 3 },
  // Medium (level 2)
  hardwareOneTimePasscode:            { displayName: "Hardware OATH Token",             strength: "Medium",             strengthLevel: 2 },
  softwareOneTimePasscode:            { displayName: "Software OATH / TOTP App",        strength: "Medium",             strengthLevel: 2 },
  x509CertificateSingleFactor:        { displayName: "Certificate-based Auth (Single)", strength: "Medium",             strengthLevel: 2 },
  temporaryAccessPass:                { displayName: "Temporary Access Pass",           strength: "Medium",             strengthLevel: 2 },
  // Weak (level 1)
  mobilePhone:                        { displayName: "Mobile Phone (SMS/Voice)",        strength: "Weak",               strengthLevel: 1 },
  sms:                                { displayName: "SMS Text Message",                strength: "Weak",               strengthLevel: 1 },
  voice:                              { displayName: "Voice Call",                      strength: "Weak",               strengthLevel: 1 },
  email:                              { displayName: "Email OTP",                       strength: "Weak",               strengthLevel: 1 },
  alternateMobilePhone:               { displayName: "Alternate Mobile Phone",          strength: "Weak",               strengthLevel: 1 },
  officePhone:                        { displayName: "Office Phone",                    strength: "Weak",               strengthLevel: 1 },
};

router.get("/m365/security", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-security", async () => {
      const [secScoreData, secScoreHistoryData, caPoliciesData, mfaDetailData, usersData] =
        await Promise.all([
          fetchWithToken("https://graph.microsoft.com/v1.0/security/secureScores?$top=1"),
          fetchWithToken("https://graph.microsoft.com/v1.0/security/secureScores?$top=30"),
          fetchAllPages("https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?$top=999"),
          fetchAllPages(
            "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails" +
            "?$select=id,userPrincipalName,userDisplayName,isMfaRegistered,isPasswordlessCapable,isSsprRegistered,methodsRegistered" +
            "&$top=999"
          ),
          fetchAllPages(
            "https://graph.microsoft.com/v1.0/users" +
            "?$select=id,accountEnabled,userType&$top=999"
          ),
        ]);

      const latestScore = secScoreData?.value?.[0] ?? null;
      const scoreHistory: any[] = secScoreHistoryData?.value ?? [];
      const caps: any[] = caPoliciesData ?? [];
      const mfaDetails: any[] = mfaDetailData ?? [];
      const rawUsers: any[] = usersData ?? [];

      // Build user lookup for accountEnabled/userType
      const userMap = new Map<string, { accountEnabled: boolean; userType: string }>();
      for (const u of rawUsers) {
        userMap.set(u.id, { accountEnabled: u.accountEnabled ?? true, userType: u.userType ?? "Member" });
      }

      const secureScore = latestScore?.currentScore ?? 0;
      const secureScoreMax = latestScore?.maxScore ?? 100;
      const secureScorePercent = secureScoreMax > 0 ? Math.round((secureScore / secureScoreMax) * 100) : 0;

      const mfaEnabledUsers = mfaDetails.filter((u) => u.isMfaRegistered).length;
      const mfaDisabledUsers = mfaDetails.length - mfaEnabledUsers;
      const mfaEnabledPercent = mfaDetails.length > 0 ? Math.round((mfaEnabledUsers / mfaDetails.length) * 100) : 0;

      // Per-user MFA list
      const mfaUsersList = mfaDetails.map((u: any) => {
        const extra = userMap.get(u.id) ?? { accountEnabled: true, userType: "Member" };
        return {
          id: u.id,
          displayName: u.userDisplayName ?? u.userPrincipalName ?? u.id,
          userPrincipalName: u.userPrincipalName ?? "",
          isMfaRegistered: u.isMfaRegistered ?? false,
          isPasswordlessCapable: u.isPasswordlessCapable ?? false,
          isSsprRegistered: u.isSsprRegistered ?? false,
          methodsRegistered: u.methodsRegistered ?? [],
          accountEnabled: extra.accountEnabled,
          userType: extra.userType,
        };
      });

      // MFA method breakdown
      const methodCounts = new Map<string, number>();
      for (const u of mfaDetails) {
        for (const method of (u.methodsRegistered ?? [])) {
          methodCounts.set(method, (methodCounts.get(method) ?? 0) + 1);
        }
      }
      const totalUsers = mfaDetails.length;
      const mfaMethodsBreakdown = Array.from(methodCounts.entries())
        .map(([method, count]) => {
          const meta = MFA_METHOD_META[method] ?? { displayName: method, strength: "Unknown", strengthLevel: 0 };
          return {
            method,
            displayName: meta.displayName,
            strength: meta.strength,
            strengthLevel: meta.strengthLevel,
            count,
            percentOfUsers: totalUsers > 0 ? Math.round((count / totalUsers) * 100 * 10) / 10 : 0,
          };
        })
        .sort((a, b) => b.strengthLevel - a.strengthLevel || b.count - a.count);

      const enabledCAPs = caps.filter((c) => c.state === "enabled").length;
      const disabledCAPs = caps.filter((c) => c.state === "disabled").length;
      const reportOnlyCAPs = caps.filter((c) => c.state === "enabledForReportingButNotEnforced").length;

      const secureScoreHistory = scoreHistory.slice(0, 30).reverse().map((s: any) => ({
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
        mfaUsersList,
        mfaMethodsBreakdown,
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 security data");
    res.status(500).json({ error: "Failed to fetch M365 security data" });
  }
});

export default router;
