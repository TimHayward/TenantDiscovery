import { Router } from "express";
import { cache, getCached, getGraphCredentialValues } from "../lib/graphClient.js";
import {
  createCollectionIssue,
  fetchAllGraphPages,
  fetchGraphJson,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

async function fetchDefenderMachinesWithDiagnostics(): Promise<{
  machines: any[];
  status: number | null;
  error: string | null;
  scope: string | null;
}> {
  const { ClientSecretCredential } = await import("@azure/identity");
  const { tenantId, clientId, clientSecret } = await getGraphCredentialValues();
  const cred = new ClientSecretCredential(
    tenantId,
    clientId,
    clientSecret
  );
  const defenderScopes = [
    "https://api.securitycenter.microsoft.com/.default",
    "https://api.security.microsoft.com/.default",
  ];

  let token: { token: string } | null = null;
  let usedScope: string | null = null;
  for (const scope of defenderScopes) {
    try {
      const candidate = await Promise.race([
        cred.getToken(scope),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Defender token acquisition timed out after 8s")), 8_000),
        ),
      ]);
      if (candidate?.token) {
        token = { token: candidate.token };
        usedScope = scope;
        break;
      }
    } catch {
      // Try next scope alias.
    }
  }

  if (!token) {
    return {
      machines: [],
      status: null,
      error: "Failed to acquire Defender token for known scopes.",
      scope: null,
    };
  }

  const machines: any[] = [];
  let url: string | null = "https://api.security.microsoft.com/api/machines?$top=10000";
  let lastStatus: number | null = null;

  while (url) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token.token}` },
      signal: AbortSignal.timeout(25_000),
    });
    lastStatus = resp.status;
    if (!resp.ok) {
      const body = await resp.text();
      return {
        machines: [],
        status: resp.status,
        error: body.slice(0, 500),
        scope: usedScope,
      };
    }
    const page: any = await resp.json();
    if (Array.isArray(page.value)) machines.push(...page.value);
    url = page["@odata.nextLink"] ?? page.nextLink ?? null;
  }

  return { machines, status: lastStatus, error: null, scope: usedScope };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected route processing error";
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number") return statusCode;
  }
  return null;
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

async function getSecurityData() {
  return getCached("m365-security", async () => {
    const [secScoreData, secScoreHistoryData, caPoliciesData, mfaDetailData, usersData, riskDetectionsData, riskyUsersData, legacyAuthData] =
      await Promise.all([
        fetchGraphJson<any>(
          "https://graph.microsoft.com/v1.0/security/secureScores?$top=1",
          "secureScoresLatest",
        ),
        fetchGraphJson<any>(
          "https://graph.microsoft.com/v1.0/security/secureScores?$top=90",
          "secureScoresHistory",
        ),
        fetchAllGraphPages(
          "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?$top=999",
          "conditionalAccessPolicies",
        ),
        fetchAllGraphPages(
          "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails" +
            "?$select=id,userPrincipalName,userDisplayName,isMfaRegistered,isPasswordlessCapable,isSsprRegistered,methodsRegistered" +
            "&$top=999",
          "userRegistrationDetails",
        ),
        fetchAllGraphPages(
          "https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,userType&$top=999",
          "users",
        ),
        fetchAllGraphPages(
          "https://graph.microsoft.com/v1.0/identityProtection/riskDetections" +
            "?$select=id,activityDateTime,riskLevel,riskDetail,detectionTimingType&$top=999" +
            "&$orderby=activityDateTime desc",
          "riskDetections",
        ),
        fetchAllGraphPages(
          "https://graph.microsoft.com/v1.0/identityProtection/riskyUsers" +
            "?$select=id,displayName,userPrincipalName,riskLevel,riskState,riskLastUpdatedDateTime" +
            "&$filter=riskState eq 'atRisk' or riskState eq 'confirmedCompromised'" +
            "&$top=999",
          "riskyUsers",
        ),
        // Legacy auth: sign-ins using non-modern auth protocols ($count requires ConsistencyLevel header)
        fetchGraphJson<any>(
          "https://graph.microsoft.com/v1.0/auditLogs/signIns" +
            "?$filter=clientAppUsed eq 'Other clients'" +
            "&$top=1&$count=true&$select=id",
          "legacyAuthSignIns",
          { "ConsistencyLevel": "eventual" },
        ),
      ]);

    const collectionIssues: CollectionIssue[] = [];
    if (secScoreData.issue) collectionIssues.push(secScoreData.issue);
    if (secScoreHistoryData.issue) collectionIssues.push(secScoreHistoryData.issue);
    collectionIssues.push(...caPoliciesData.issues);
    collectionIssues.push(...mfaDetailData.issues);
    collectionIssues.push(...usersData.issues);
    collectionIssues.push(...riskDetectionsData.issues);
    collectionIssues.push(...riskyUsersData.issues);
    if (legacyAuthData.issue) collectionIssues.push(legacyAuthData.issue);

    const latestScore = secScoreData.data?.value?.[0] ?? null;
    const scoreHistory: any[] = secScoreHistoryData.data?.value ?? [];
    const caps: any[] = caPoliciesData.items;
    const mfaDetails: any[] = mfaDetailData.items;
    const rawUsers: any[] = usersData.items;
    const riskDetections: any[] = riskDetectionsData.items;
    const riskyUsersRaw: any[] = riskyUsersData.items;

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

    const riskByDate = new Map<string, { high: number; medium: number; low: number; total: number }>();
    for (const d of riskDetections) {
      const date = (d.activityDateTime ?? d.detectedDateTime ?? "").split("T")[0];
      if (!date) continue;
      const existing = riskByDate.get(date) ?? { high: 0, medium: 0, low: 0, total: 0 };
      const level: string = (d.riskLevel ?? "").toLowerCase();
      if (level === "high") existing.high++;
      else if (level === "medium") existing.medium++;
      else if (level === "low") existing.low++;
      existing.total++;
      riskByDate.set(date, existing);
    }
    const riskDetectionTimeline = Array.from(riskByDate.entries())
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-90);

    const riskyUsersDetail = riskyUsersRaw.map((u: any) => ({
      id: u.id,
      displayName: u.displayName ?? u.userPrincipalName ?? u.id,
      userPrincipalName: u.userPrincipalName ?? "",
      riskLevel: u.riskLevel ?? "none",
      riskState: u.riskState ?? "none",
      riskLastUpdatedDateTime: u.riskLastUpdatedDateTime ?? null,
    }));

    const enabledCAPs = caps.filter((c) => c.state === "enabled").length;
    const disabledCAPs = caps.filter((c) => c.state === "disabled").length;
    const reportOnlyCAPs = caps.filter((c) => c.state === "enabledForReportingButNotEnforced").length;

    const secureScoreHistory = scoreHistory.slice(0, 90).reverse().map((s: any) => ({
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

    const secureScoreControls = (latestScore?.controlScores ?? []).map((ctrl: any) => {
      const pct: number = ctrl.scoreInPercentage ?? 0;
      const status = pct >= 80 ? "configured" : pct > 0 ? "partial" : "notConfigured";
      return {
        controlName: ctrl.controlName ?? "",
        controlCategory: ctrl.controlCategory ?? "Other",
        description: ctrl.description ?? "",
        score: ctrl.score ?? 0,
        scoreInPercentage: pct,
        implementationStatus: ctrl.implementationStatus ?? "",
        lastSynced: ctrl.lastSynced ?? null,
        status,
      };
    });

    // Legacy auth: "@odata.count" is returned when $count=true is used
    const legacyAuthSignInCount = legacyAuthData.issue
      ? null
      : ((legacyAuthData.data?.["@odata.count"] as number | undefined) ?? (legacyAuthData.data?.value?.length ?? 0));

    // Check if any enabled CA policy explicitly blocks legacy auth (Other clients / Exchange ActiveSync)
    const legacyAuthBlockedByCA = caps.some((p: any) => {
      if (p.state !== "enabled") return false;
      const clientTypes: string[] = p.conditions?.clientAppTypes ?? [];
      const hasLegacyClient = clientTypes.some((t: string) =>
        ["exchangeActiveSync", "other"].includes(t)
      );
      const blocksAccess = p.grantControls?.builtInControls?.includes("block") ||
        (p.grantControls === null && p.sessionControls !== null);
      return hasLegacyClient && blocksAccess;
    });

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
      riskyUsers: riskyUsersDetail.length,
      adminsWithoutMfa: mfaDisabledUsers,
      mfaUsersList,
      mfaMethodsBreakdown,
      riskDetectionTimeline,
      riskyUsersDetail,
      secureScoreControls,
      legacyAuthSignInCount,
      legacyAuthBlockedByCA,
      partialData: collectionIssues.length > 0,
      permissionError: collectionIssues.some(isPermissionIssue),
      collectionIssues,
    };
  });
}

router.get("/m365/security", async (req, res): Promise<void> => {
  try {
    const data = await getSecurityData();

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 security data");
    const fallbackIssue = createCollectionIssue(
      "securityRoute",
      getErrorStatus(err),
      getErrorMessage(err),
    );
    res.status(200).json({
      secureScore: 0,
      secureScoreMax: 100,
      secureScorePercent: 0,
      mfaEnabledUsers: 0,
      mfaDisabledUsers: 0,
      mfaEnabledPercent: 0,
      conditionalAccessPolicies: 0,
      enabledCAPs: 0,
      disabledCAPs: 0,
      reportOnlyCAPs: 0,
      secureScoreHistory: [],
      controlCategories: [],
      caPolicies: [],
      riskyUsers: 0,
      adminsWithoutMfa: 0,
      mfaUsersList: [],
      mfaMethodsBreakdown: [],
      riskDetectionTimeline: [],
      riskyUsersDetail: [],
      secureScoreControls: [],
      legacyAuthSignInCount: null,
      legacyAuthBlockedByCA: false,
      partialData: true,
      permissionError: isPermissionIssue(fallbackIssue),
      collectionIssues: [fallbackIssue],
    });
  }
});

router.get("/m365/security/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getSecurityData();

    const fieldMetadata = {
      secureScore: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "SecurityEvents.Read.All",
      },
      secureScorePercent: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Derived from secure score current/max",
      },
      mfaEnabledUsers: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
      },
      mfaDisabledUsers: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
      },
      conditionalAccessPolicies: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Policy.Read.All",
      },
      caPolicies: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Identity conditional access policies",
      },
      secureScoreHistory: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Security secure score snapshots",
      },
      riskDetectionTimeline: {
        evidenceStatus: "partial" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Identity Protection detections",
      },
      riskyUsersDetail: {
        evidenceStatus: "partial" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Identity Protection risky users",
      },
      secureScoreControls: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Secure score controlScores",
      },
      partialData: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when one or more upstream collection calls failed"],
      },
      permissionError: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when collection issues include permission-related failures"],
      },
      collectionIssues: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["Per-source issue details for failed Graph collection calls"],
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 security data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 security data" });
  }
});

export interface DefenderOfficeAlert {
  id: string;
  title: string;
  severity: string;
  status: string;
  serviceSource: string;
  category: string;
  createdDateTime: string | null;
}

interface IncidentAlert30DaySummary {
  unresolvedIncidents: number;
  resolvedIncidents: number;
  unresolvedAlerts: number;
  resolvedAlerts: number;
}

async function fetchDefenderAlertsBySource(
  serviceSource: string,
  source: string,
): Promise<{ alerts: DefenderOfficeAlert[]; error: string | null }> {
  const endpoint =
    "https://graph.microsoft.com/v1.0/security/alerts_v2" +
    `?$filter=serviceSource+eq+'${serviceSource}'` +
    "&$top=100" +
    "&$orderby=createdDateTime+desc" +
    "&$select=id,title,severity,status,serviceSource,category,createdDateTime";

  const result = await fetchGraphJson<{ value?: any[] }>(endpoint, source);
  if (result.issue) {
    return { alerts: [], error: result.issue.message };
  }

  const rawAlerts = Array.isArray(result.data?.value) ? result.data.value : [];
  const alerts: DefenderOfficeAlert[] = rawAlerts.map((a: any) => ({
    id: a.id ?? "",
    title: a.title ?? "",
    severity: a.severity ?? "Unknown",
    status: a.status ?? "Unknown",
    serviceSource: a.serviceSource ?? "",
    category: a.category ?? "",
    createdDateTime: a.createdDateTime ?? null,
  }));

  return { alerts, error: null };
}

async function fetchDefenderOfficeAlerts(): Promise<{ alerts: DefenderOfficeAlert[]; error: string | null }> {
  return fetchDefenderAlertsBySource(
    "microsoftDefenderForOffice365",
    "securityDefenderOfficeAlerts",
  );
}

async function fetchDefenderEndpointAlerts(): Promise<{ alerts: DefenderOfficeAlert[]; error: string | null }> {
  return fetchDefenderAlertsBySource(
    "microsoftDefenderForEndpoint",
    "securityDefenderEndpointAlerts",
  );
}

async function fetchIncidentAlert30DaySummary(): Promise<{ summary: IncidentAlert30DaySummary; error: string | null }> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const filter = encodeURIComponent(`createdDateTime ge ${since}`);
  const resolvedLikeStatuses = new Set(["resolved", "redirected", "closed", "dismissed"]);

  const incidentsResult = await fetchAllGraphPages<any>(
    "https://graph.microsoft.com/v1.0/security/incidents" +
      `?$filter=${filter}` +
      "&$top=50" +
      "&$select=id,status,createdDateTime",
    "securityIncidentSummary30dIncidents",
  );

  const alertsResult = await fetchAllGraphPages<any>(
    "https://graph.microsoft.com/v1.0/security/alerts_v2" +
      `?$filter=${filter}` +
      "&$top=50" +
      "&$select=id,status,createdDateTime",
    "securityIncidentSummary30dAlerts",
  );

  const resolvedIncidents = incidentsResult.items.filter(
    (i: any) => resolvedLikeStatuses.has(((i.status as string | undefined) ?? "").toLowerCase()),
  ).length;
  const resolvedAlerts = alertsResult.items.filter(
    (a: any) => resolvedLikeStatuses.has(((a.status as string | undefined) ?? "").toLowerCase()),
  ).length;

  const summary: IncidentAlert30DaySummary = {
    unresolvedIncidents: incidentsResult.items.length - resolvedIncidents,
    resolvedIncidents,
    unresolvedAlerts: alertsResult.items.length - resolvedAlerts,
    resolvedAlerts,
  };

  const firstError = incidentsResult.issues[0]?.message ?? alertsResult.issues[0]?.message ?? null;
  return { summary, error: firstError };
}

// ── /m365/security/estate — discovered devices, SaaS apps, OAuth apps ─────────

const MICROSOFT_TENANT_ID = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";

async function getSecurityEstateData(refreshRequested = false) {
  if (refreshRequested) {
    cache.del("m365-security-estate");
  }

  return getCached("m365-security-estate", async () => {
    const [devicesRawResult, managedDevicesRawResult, servicePrincipalsRawResult, oauthGrantsRawResult, mdeResult, defenderOfficeAlertsResult, defenderEndpointAlertsResult, incidentAlert30dResult] = await Promise.all([
      fetchAllGraphPages<any>(
        "https://graph.microsoft.com/v1.0/devices" +
        "?$select=id,displayName,operatingSystem,operatingSystemVersion,trustType,isManaged,isCompliant,managementType,approximateLastSignInDateTime" +
        "&$top=999",
        "securityEstateDevices",
      ),
      fetchAllGraphPages<any>(
        "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices" +
        "?$select=id,deviceName,azureADDeviceId,operatingSystem,osVersion,lastSyncDateTime,managementAgent,complianceState" +
        "&$top=999",
        "securityEstateManagedDevices",
      ),
      fetchAllGraphPages<any>(
        "https://graph.microsoft.com/v1.0/servicePrincipals" +
        "?$select=id,displayName,appId,publisherName,servicePrincipalType,appOwnerOrganizationId,createdDateTime,tags" +
        "&$top=999",
        "securityEstateServicePrincipals",
      ),
      fetchAllGraphPages<any>(
        "https://graph.microsoft.com/v1.0/oauth2PermissionGrants" +
        "?$select=clientId,consentType,principalId,scope" +
        "&$top=999",
        "securityEstateOauth2PermissionGrants",
      ),
      fetchDefenderMachinesWithDiagnostics(),
      fetchDefenderOfficeAlerts(),
      fetchDefenderEndpointAlerts(),
      fetchIncidentAlert30DaySummary(),
    ]);

    const devicesRaw = devicesRawResult.items;
    const managedDevicesRaw = managedDevicesRawResult.items;
    const servicePrincipalsRaw = servicePrincipalsRawResult.items;
    const oauthGrantsRaw = oauthGrantsRawResult.items;

    const mdeMachinesRaw = mdeResult.machines;

    const mdeDeviceInventory = mdeMachinesRaw.map((m: any) => ({
      id:
        (m.aadDeviceId as string | undefined) ??
        `mde:${(m.id as string | undefined) ?? Math.random().toString(36).slice(2)}`,
      displayName:
        (m.computerDnsName as string | undefined) ??
        (m.deviceName as string | undefined) ??
        (m.id as string | undefined) ??
        "Unknown",
      operatingSystem:
        (m.osPlatform as string | undefined) ??
        (m.osProcessor as string | undefined) ??
        "Unknown",
      operatingSystemVersion: (m.osVersion as string | undefined) ?? null,
      trustType: null as string | null,
      isManaged: true,
      isCompliant: null as boolean | null,
      managementType: "MicrosoftSense" as string | null,
      approximateLastSignInDateTime: (m.lastSeen as string | undefined) ?? null,
    }));

    const spNameMap = new Map<string, string>();
    for (const sp of servicePrincipalsRaw) {
      spNameMap.set(sp.id as string, (sp.displayName as string) ?? sp.id);
    }

    const deviceList = devicesRaw.map((d: any) => ({
      id: d.id as string,
      displayName: (d.displayName as string) ?? "Unknown",
      operatingSystem: (d.operatingSystem as string) ?? "Unknown",
      operatingSystemVersion: (d.operatingSystemVersion as string | undefined) ?? null,
      trustType: (d.trustType as string | undefined) ?? null,
      isManaged: (d.isManaged as boolean) ?? false,
      isCompliant: d.isCompliant as boolean | null ?? null,
      managementType: (d.managementType as string | undefined) ?? null,
      approximateLastSignInDateTime: (d.approximateLastSignInDateTime as string | undefined) ?? null,
    }));

    const normalizeName = (s: string | null | undefined) =>
      (s ?? "").trim().toLowerCase();

    const byId = new Map(deviceList.map((d) => [d.id, d]));
    const byName = new Map(
      deviceList
        .map((d) => [normalizeName(d.displayName), d] as const)
        .filter(([name]) => name.length > 0)
    );
    for (const md of managedDevicesRaw) {
      const aadDeviceId = (md.azureADDeviceId as string | undefined) ?? null;
      const deviceName = (md.deviceName as string | undefined) ?? "Unknown";
      const existingByName = byName.get(normalizeName(deviceName));
      const id = aadDeviceId ?? `intune:${(md.id as string) ?? Math.random().toString(36).slice(2)}`;
      const existing = byId.get(id) ?? (!aadDeviceId ? existingByName : undefined);
      const complianceState = (md.complianceState as string | undefined)?.toLowerCase() ?? "unknown";
      const inferredCompliance =
        complianceState === "compliant" ? true :
        complianceState === "noncompliant" ? false :
        null;
      if (existing) {
        existing.isManaged = true;
        if (!existing.managementType) existing.managementType = "MDM";
        if (existing.isCompliant === null) existing.isCompliant = inferredCompliance;
        if (!existing.approximateLastSignInDateTime) {
          existing.approximateLastSignInDateTime =
            (md.lastSyncDateTime as string | undefined) ?? existing.approximateLastSignInDateTime;
        }
        continue;
      }

      const merged = {
        id,
        displayName: deviceName,
        operatingSystem: (md.operatingSystem as string | undefined) ?? "Unknown",
        operatingSystemVersion: (md.osVersion as string | undefined) ?? null,
        trustType: null as string | null,
        isManaged: true,
        isCompliant: inferredCompliance,
        managementType: "MDM" as string | null,
        approximateLastSignInDateTime: (md.lastSyncDateTime as string | undefined) ?? null,
      };
      deviceList.push(merged);
      byId.set(merged.id, merged);
      const normalizedName = normalizeName(merged.displayName);
      if (normalizedName.length > 0) byName.set(normalizedName, merged);
    }

    for (const m of mdeMachinesRaw) {
      const aadDeviceId = (m.aadDeviceId as string | undefined) ?? null;
      const mdeDisplayName =
        (m.computerDnsName as string | undefined) ??
        (m.deviceName as string | undefined) ??
        (m.id as string | undefined) ??
        "Unknown";
      const existingByName = byName.get(normalizeName(mdeDisplayName));
      const id = aadDeviceId ?? `mde:${(m.id as string) ?? Math.random().toString(36).slice(2)}`;
      const existing = byId.get(id) ?? (!aadDeviceId ? existingByName : undefined);
      if (existing) {
        existing.managementType = "MicrosoftSense";
        existing.isManaged = true;
        if (!existing.approximateLastSignInDateTime) {
          existing.approximateLastSignInDateTime =
            (m.lastSeen as string | undefined) ?? existing.approximateLastSignInDateTime;
        }
        continue;
      }

      const merged = {
        id,
        displayName: mdeDisplayName,
        operatingSystem:
          (m.osPlatform as string | undefined) ??
          (m.osProcessor as string | undefined) ??
          "Unknown",
        operatingSystemVersion: (m.osVersion as string | undefined) ?? null,
        trustType: null as string | null,
        isManaged: true,
        isCompliant: null as boolean | null,
        managementType: "MicrosoftSense" as string | null,
        approximateLastSignInDateTime: (m.lastSeen as string | undefined) ?? null,
      };
      deviceList.push(merged);
      byId.set(merged.id, merged);
      const normalizedName = normalizeName(merged.displayName);
      if (normalizedName.length > 0) byName.set(normalizedName, merged);
    }

    const managed = deviceList.filter((d) => d.isManaged || !!d.managementType).length;
    const mde = mdeDeviceInventory.length;
    const azureAdJoined = deviceList.filter((d) => d.trustType === "AzureAd").length;
    const hybridJoined = deviceList.filter((d) => d.trustType === "ServerAd").length;
    const registered = deviceList.filter((d) => d.trustType === "Workplace").length;
    const unknownTrust = deviceList.filter((d) => !d.trustType).length;

    const osCounts: Record<string, number> = {};
    for (const d of deviceList) {
      const os = d.operatingSystem ?? "Unknown";
      osCounts[os] = (osCounts[os] ?? 0) + 1;
    }

    const deviceSummary = {
      total: deviceList.length,
      managed,
      unmanaged: deviceList.length - managed,
      mde,
      azureAdJoined,
      hybridJoined,
      registered,
      unknown: unknownTrust,
      byOs: osCounts,
    };

    const saasApps = servicePrincipalsRaw
      .filter((sp: any) => sp.servicePrincipalType === "Application")
      .map((sp: any) => ({
        id: sp.id as string,
        displayName: (sp.displayName as string) ?? "Unknown",
        publisherName: (sp.publisherName as string) ?? null,
        appOwnerOrganizationId: (sp.appOwnerOrganizationId as string) ?? null,
        isFirstParty: (sp.appOwnerOrganizationId as string) === MICROSOFT_TENANT_ID,
        createdDateTime: (sp.createdDateTime as string) ?? null,
        tags: (sp.tags as string[]) ?? [],
      }))
      .sort((a: any, b: any) => (a.isFirstParty === b.isFirstParty ? 0 : a.isFirstParty ? 1 : -1));

    const oauthMap = new Map<string, {
      clientId: string; displayName: string; consentType: string; scopes: string[]; isOrgWide: boolean;
    }>();
    for (const grant of oauthGrantsRaw) {
      const clientId = grant.clientId as string;
      const scopeWords = ((grant.scope as string) ?? "").split(/\s+/).filter(Boolean);
      const existing = oauthMap.get(clientId);
      if (existing) {
        for (const s of scopeWords) {
          if (!existing.scopes.includes(s)) existing.scopes.push(s);
        }
        if (grant.consentType === "AllPrincipals") {
          existing.consentType = "AllPrincipals";
          existing.isOrgWide = true;
        }
      } else {
        oauthMap.set(clientId, {
          clientId,
          displayName: spNameMap.get(clientId) ?? clientId,
          consentType: (grant.consentType as string) ?? "Unknown",
          scopes: scopeWords,
          isOrgWide: grant.consentType === "AllPrincipals",
        });
      }
    }
    const oauthApps = Array.from(oauthMap.values())
      .sort((a, b) => (a.isOrgWide === b.isOrgWide ? 0 : a.isOrgWide ? -1 : 1));

    const mdeStatus = {
      ok: !mdeResult.error,
      status: mdeResult.status,
      count: mdeMachinesRaw.length,
      scope: mdeResult.scope,
      error: mdeResult.error,
    };

    // Defender for Office 365 alert summary
    const defenderOfficeAlerts = defenderOfficeAlertsResult.alerts;
    const defenderOfficeAlertsBySeverity = {
      high:     defenderOfficeAlerts.filter((a) => a.severity.toLowerCase() === "high").length,
      medium:   defenderOfficeAlerts.filter((a) => a.severity.toLowerCase() === "medium").length,
      low:      defenderOfficeAlerts.filter((a) => a.severity.toLowerCase() === "low").length,
      informational: defenderOfficeAlerts.filter((a) => a.severity.toLowerCase() === "informational").length,
    };
    const defenderOfficeStatus = {
      ok: !defenderOfficeAlertsResult.error,
      error: defenderOfficeAlertsResult.error,
      totalAlerts: defenderOfficeAlerts.length,
      ...defenderOfficeAlertsBySeverity,
    };

    const defenderEndpointAlerts = defenderEndpointAlertsResult.alerts;
    const defenderEndpointAlertsBySeverity = {
      high: defenderEndpointAlerts.filter((a) => a.severity.toLowerCase() === "high").length,
      medium: defenderEndpointAlerts.filter((a) => a.severity.toLowerCase() === "medium").length,
      low: defenderEndpointAlerts.filter((a) => a.severity.toLowerCase() === "low").length,
      informational: defenderEndpointAlerts.filter((a) => a.severity.toLowerCase() === "informational").length,
    };
    const defenderEndpointStatus = {
      ok: !defenderEndpointAlertsResult.error,
      error: defenderEndpointAlertsResult.error,
      totalAlerts: defenderEndpointAlerts.length,
      ...defenderEndpointAlertsBySeverity,
    };

    return {
      deviceSummary,
      deviceList,
      mdeDeviceInventory,
      mdeStatus,
      saasApps,
      oauthApps,
      defenderOfficeAlerts,
      defenderOfficeStatus,
      defenderEndpointAlerts,
      defenderEndpointStatus,
      incidentAlert30dSummary: incidentAlert30dResult.summary,
      incidentAlert30dStatus: {
        ok: !incidentAlert30dResult.error,
        error: incidentAlert30dResult.error,
      },
    };
  });
}

router.get("/m365/security/estate", async (req, res): Promise<void> => {
  try {
    const refreshRequested = req.query.refresh === "1";
    const data = await getSecurityEstateData(refreshRequested);

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 security estate data");
    res.status(500).json({ error: "Failed to fetch M365 security estate data" });
  }
});

router.get("/m365/security/estate/with-metadata", async (req, res): Promise<void> => {
  try {
    const refreshRequested = req.query.refresh === "1";
    const data = await getSecurityEstateData(refreshRequested);

    const fieldMetadata = {
      deviceSummary: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Graph devices + Intune managedDevices + Defender machines",
      },
      deviceList: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Merged device inventory",
      },
      mdeDeviceInventory: {
        evidenceStatus: "partial" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Defender for Endpoint machines API",
      },
      mdeStatus: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Defender machine API status and diagnostics",
      },
      defenderEndpointAlerts: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Graph security alerts_v2 filtered to Defender for Endpoint",
      },
      incidentAlert30dSummary: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Graph security incidents + alerts_v2 from last 30 days",
      },
      saasApps: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Service principals inventory",
      },
      oauthApps: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "OAuth2 permission grants",
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 security estate data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 security estate data" });
  }
});

export default router;
