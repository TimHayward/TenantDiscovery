import { createHash } from "node:crypto";
import {
  createCollectionIssue,
  fetchAllGraphPages,
  fetchAllResourcePages,
  fetchGraphJson,
  getAccessToken,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";
import type {
  GraphAlertV2,
  GraphCAPolicy,
  GraphCAPolicyConditions,
  GraphCAPolicyGrantControls,
  GraphControlProfile,
  GraphDevice,
  GraphIncident,
  GraphManagedDevice,
  GraphOAuthGrant,
  GraphRegistrationDetail,
  GraphRiskDetection,
  GraphRiskyUser,
  GraphSecureScore,
  GraphServicePrincipal,
  GraphUserBasic,
  MdeMachine,
} from "./graphTypes.js";

const GRAPH_MAX_PAGE_SIZE = 500;

const MFA_METHOD_META: Record<string, { displayName: string; strength: string; strengthLevel: number }> = {
  fido2:                              { displayName: "FIDO2 Security Key",              strength: "Phishing-resistant", strengthLevel: 4 },
  windowsHelloForBusiness:            { displayName: "Windows Hello for Business",      strength: "Phishing-resistant", strengthLevel: 4 },
  x509CertificateMultiFactor:         { displayName: "Certificate-based Auth (MFA)",    strength: "Phishing-resistant", strengthLevel: 4 },
  microsoftAuthenticatorPasswordless: { displayName: "Authenticator Passwordless",      strength: "Phishing-resistant", strengthLevel: 4 },
  passKeyDeviceBound:                 { displayName: "Passkey (Device-bound)",          strength: "Phishing-resistant", strengthLevel: 4 },
  passKeyDeviceBoundAuthenticator:    { displayName: "Passkey (Authenticator)",         strength: "Phishing-resistant", strengthLevel: 4 },
  microsoftAuthenticatorPush:         { displayName: "Microsoft Authenticator (Push)",  strength: "Strong",             strengthLevel: 3 },
  microsoftAuthenticator:             { displayName: "Microsoft Authenticator",         strength: "Strong",             strengthLevel: 3 },
  hardwareOneTimePasscode:            { displayName: "Hardware OATH Token",             strength: "Medium",             strengthLevel: 2 },
  softwareOneTimePasscode:            { displayName: "Software OATH / TOTP App",        strength: "Medium",             strengthLevel: 2 },
  x509CertificateSingleFactor:        { displayName: "Certificate-based Auth (Single)", strength: "Medium",             strengthLevel: 2 },
  temporaryAccessPass:                { displayName: "Temporary Access Pass",           strength: "Medium",             strengthLevel: 2 },
  mobilePhone:                        { displayName: "Mobile Phone (SMS/Voice)",        strength: "Weak",               strengthLevel: 1 },
  sms:                                { displayName: "SMS Text Message",                strength: "Weak",               strengthLevel: 1 },
  voice:                              { displayName: "Voice Call",                      strength: "Weak",               strengthLevel: 1 },
  email:                              { displayName: "Email OTP",                       strength: "Weak",               strengthLevel: 1 },
  alternateMobilePhone:               { displayName: "Alternate Mobile Phone",          strength: "Weak",               strengthLevel: 1 },
  officePhone:                        { displayName: "Office Phone",                    strength: "Weak",               strengthLevel: 1 },
};

const DEFENDER_MACHINES_URL = "https://api.security.microsoft.com/api/machines?$top=10000";

/**
 * Two aliases for the same resource. Which one a tenant will issue a token for
 * depends on how the app registration was consented, so both are tried.
 */
const DEFENDER_SCOPES = [
  "https://api.securitycenter.microsoft.com/.default",
  "https://api.security.microsoft.com/.default",
];

interface DefenderMachinesResult {
  machines: MdeMachine[];
  status: number | null;
  error: string | null;
  scope: string | null;
  issues: CollectionIssue[];
}

/**
 * Find the Defender scope alias this tenant will issue a token for.
 *
 * This probe is genuinely Defender-specific and stays here; the request itself
 * goes through the shared helpers.
 */
async function resolveDefenderScope(): Promise<string | null> {
  for (const scope of DEFENDER_SCOPES) {
    try {
      await Promise.race([
        getAccessToken(scope),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Defender token acquisition timed out after 8s")), 8_000),
        ),
      ]);
      return scope;
    } catch { /* Try next scope alias */ }
  }
  return null;
}

async function fetchDefenderMachinesWithDiagnostics(): Promise<DefenderMachinesResult> {
  const usedScope = await resolveDefenderScope();

  if (!usedScope) {
    const message = "Failed to acquire Defender token for known scopes.";
    return {
      machines: [],
      status: null,
      error: message,
      scope: null,
      issues: [createCollectionIssue("securityEstateDefenderMachines", null, message)],
    };
  }

  // Defender is a different host with a different token scope, so it uses the
  // scope-parameterised variant of the shared paging helper. That gives it the
  // same timeout (GRAPH_FETCH_TIMEOUT_MS), the same bounded retry
  // (GRAPH_MAX_RETRIES), its own per-host concurrency budget
  // (DEFENDER_MAX_CONCURRENCY) and the same collection-issue capture as Graph.
  const paged = await fetchAllResourcePages<MdeMachine>(
    DEFENDER_MACHINES_URL,
    "securityEstateDefenderMachines",
    { scope: usedScope },
  );

  const firstIssue = paged.issues[0] ?? null;

  return {
    // A partial machine list is discarded on failure, as it was before this
    // collector moved onto the shared helper. Reporting the machines collected
    // before the failing page would be an improvement, but it would change what
    // the device inventory contains, which is not this change's business.
    machines: firstIssue ? [] : paged.items,
    // The helper only reports a status when a page failed. Every page that did
    // not fail was 2xx by definition, and in practice 200.
    status: firstIssue ? firstIssue.status : 200,
    error: firstIssue ? firstIssue.message : null,
    scope: usedScope,
    issues: paged.issues,
  };
}

/**
 * A device identity that does not change between collections.
 *
 * Intune and Defender records that are not Entra joined used to fall back to
 * `Math.random()` when the source identifier was absent, so the merged
 * inventory came out different on every run and drift reported the whole
 * non-Entra estate as churn. The tuple hashed here is made only of fields that
 * do not move: a name, an operating system and, where available, an enrolment
 * date. Patch levels and last-seen timestamps are deliberately excluded.
 *
 * Returns null when the anchor is missing, because a key derived from an
 * operating system alone would collide across unrelated devices. The caller
 * excludes those devices and records a collection note instead of inventing an
 * identity for them.
 */
function stableDeviceKey(
  prefix: string,
  anchor: string | null | undefined,
  ...rest: Array<string | null | undefined>
): string | null {
  const normalisedAnchor = (anchor ?? "").trim().toLowerCase();
  if (normalisedAnchor.length === 0) return null;
  const tuple = [normalisedAnchor, ...rest.map((part) => (part ?? "").trim().toLowerCase())];
  const digest = createHash("sha256").update(tuple.join("\u0000")).digest("hex").slice(0, 32);
  return `${prefix}:${digest}`;
}

/** Merge identity for an Intune managed device, or null when nothing stable exists. */
function managedDeviceIdentity(md: GraphManagedDevice): string | null {
  if (md.azureADDeviceId) return md.azureADDeviceId;
  if (md.id) return `intune:${md.id}`;
  return stableDeviceKey("intune", md.deviceName, md.operatingSystem, md.enrolledDateTime);
}

/** Merge identity for a Defender machine, or null when nothing stable exists. */
function mdeMachineIdentity(m: MdeMachine): string | null {
  if (m.aadDeviceId) return m.aadDeviceId;
  if (m.id) return `mde:${m.id}`;
  return stableDeviceKey("mde", m.computerDnsName ?? m.deviceName, m.osPlatform);
}

function summariseUsers(users: GraphCAPolicyConditions["users"]): string {
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

function summariseApps(apps: GraphCAPolicyConditions["applications"]): string {
  const include: string[] = apps?.includeApplications ?? [];
  const actions: string[] = apps?.includeUserActions ?? [];
  if (include.includes("All")) return "All Applications";
  if (actions.length > 0) return `User Actions (${actions.join(", ")})`;
  if (include.length > 0) return `${include.length} Application(s)`;
  return "None";
}

function summariseAuthStrength(grantControls: GraphCAPolicyGrantControls | null | undefined): string {
  if (!grantControls) return "None";
  const strength = grantControls.authenticationStrength?.displayName;
  if (strength) return strength;
  const builtIn: string[] = grantControls.builtInControls ?? [];
  if (builtIn.length === 0) return "None";
  const labelMap: Record<string, string> = {
    mfa: "MFA Required", compliantDevice: "Compliant Device",
    domainJoinedDevice: "Domain Joined Device", approvedApplication: "Approved App",
    passwordChange: "Password Change", block: "Block",
  };
  return builtIn.map((c) => labelMap[c] ?? c).join(" + ");
}

export async function collectSecurity() {
  const [secScoreData, secScoreHistoryData, controlProfilesData, caPoliciesData, mfaDetailData, usersData, riskDetectionsData, riskyUsersData, legacyAuthData] =
    await Promise.all([
      fetchGraphJson<{ value?: GraphSecureScore[] }>("https://graph.microsoft.com/v1.0/security/secureScores?$top=1", "secureScoresLatest"),
      fetchGraphJson<{ value?: GraphSecureScore[] }>("https://graph.microsoft.com/v1.0/security/secureScores?$top=90", "secureScoresHistory"),
      fetchAllGraphPages<GraphControlProfile>(`https://graph.microsoft.com/v1.0/security/secureScoreControlProfiles?$top=${GRAPH_MAX_PAGE_SIZE}`, "secureScoreControlProfiles"),
      fetchAllGraphPages<GraphCAPolicy>(`https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?$top=${GRAPH_MAX_PAGE_SIZE}`, "conditionalAccessPolicies"),
      fetchAllGraphPages<GraphRegistrationDetail>(
        "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails" +
          `?$select=id,userPrincipalName,userDisplayName,isMfaRegistered,isPasswordlessCapable,isSsprRegistered,methodsRegistered&$top=${GRAPH_MAX_PAGE_SIZE}`,
        "userRegistrationDetails",
      ),
      fetchAllGraphPages<GraphUserBasic>(`https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,userType&$top=${GRAPH_MAX_PAGE_SIZE}`, "users"),
      fetchAllGraphPages<GraphRiskDetection>(
        "https://graph.microsoft.com/v1.0/identityProtection/riskDetections" +
          `?$select=id,activityDateTime,riskLevel,riskDetail,detectionTimingType&$top=${GRAPH_MAX_PAGE_SIZE}&$orderby=activityDateTime desc`,
        "riskDetections",
      ),
      fetchAllGraphPages<GraphRiskyUser>(
        "https://graph.microsoft.com/v1.0/identityProtection/riskyUsers" +
          "?$select=id,userDisplayName,userPrincipalName,riskLevel,riskState,riskLastUpdatedDateTime" +
          `&$filter=riskState eq 'atRisk' or riskState eq 'confirmedCompromised'&$top=${GRAPH_MAX_PAGE_SIZE}`,
        "riskyUsers",
      ),
      fetchGraphJson<{ "@odata.count"?: number; value?: unknown[] }>(
        "https://graph.microsoft.com/v1.0/auditLogs/signIns?$filter=clientAppUsed eq 'Other clients'&$top=1&$count=true&$select=id",
        "legacyAuthSignIns",
        { "ConsistencyLevel": "eventual" },
      ),
    ]);

  const collectionIssues: CollectionIssue[] = [];
  if (secScoreData.issue) collectionIssues.push(secScoreData.issue);
  if (secScoreHistoryData.issue) collectionIssues.push(secScoreHistoryData.issue);
  collectionIssues.push(...controlProfilesData.issues);
  collectionIssues.push(...caPoliciesData.issues);
  collectionIssues.push(...mfaDetailData.issues);
  collectionIssues.push(...usersData.issues);
  collectionIssues.push(...riskDetectionsData.issues);
  collectionIssues.push(...riskyUsersData.issues);
  if (legacyAuthData.issue) collectionIssues.push(legacyAuthData.issue);

  const latestScore = secScoreData.data?.value?.[0] ?? null;
  const scoreHistory = secScoreHistoryData.data?.value ?? [];
  const controlProfiles = controlProfilesData.items;
  const caps = caPoliciesData.items;
  const mfaDetails = mfaDetailData.items;
  const rawUsers = usersData.items;
  const riskDetections = riskDetectionsData.items;
  const riskyUsersRaw = riskyUsersData.items;

  const userMap = new Map<string, { accountEnabled: boolean; userType: string }>();
  for (const u of rawUsers) {
    if (!u.id) continue;
    userMap.set(u.id, { accountEnabled: u.accountEnabled ?? true, userType: u.userType ?? "Member" });
  }

  const secureScore = latestScore?.currentScore ?? 0;
  const secureScoreMax = latestScore?.maxScore ?? 100;
  const secureScorePercent = secureScoreMax > 0 ? Math.round((secureScore / secureScoreMax) * 100) : 0;

  const mfaEnabledUsers = mfaDetails.filter((u) => u.isMfaRegistered).length;
  const mfaDisabledUsers = mfaDetails.length - mfaEnabledUsers;
  const mfaEnabledPercent = mfaDetails.length > 0 ? Math.round((mfaEnabledUsers / mfaDetails.length) * 100) : 0;

  const mfaUsersList = mfaDetails.map((u) => {
    const extra = (u.id ? userMap.get(u.id) : undefined) ?? { accountEnabled: true, userType: "Member" };
    return {
      id: u.id ?? "",
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
        method, displayName: meta.displayName, strength: meta.strength, strengthLevel: meta.strengthLevel,
        count, percentOfUsers: totalUsers > 0 ? Math.round((count / totalUsers) * 100 * 10) / 10 : 0,
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

  const riskyUsersDetail = riskyUsersRaw.map((u) => ({
    id: u.id ?? "",
    displayName: u.userDisplayName ?? u.userPrincipalName ?? u.id,
    userPrincipalName: u.userPrincipalName ?? "",
    riskLevel: u.riskLevel ?? "none",
    riskState: u.riskState ?? "none",
    riskLastUpdatedDateTime: u.riskLastUpdatedDateTime ?? null,
  }));

  const enabledCAPs = caps.filter((c) => c.state === "enabled").length;
  const disabledCAPs = caps.filter((c) => c.state === "disabled").length;
  const reportOnlyCAPs = caps.filter((c) => c.state === "enabledForReportingButNotEnforced").length;

  const secureScoreHistory = scoreHistory.slice(0, 90).reverse().map((s) => ({
    date: s.createdDateTime?.split("T")[0] ?? "",
    score: s.currentScore ?? 0,
    maxScore: s.maxScore ?? 100,
  }));

  const parseFiniteNumber = (value: unknown): number | undefined => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  const profileTitleById = new Map<string, string>();
  for (const profile of controlProfiles) {
    if (profile.id && profile.title) profileTitleById.set(profile.id, profile.title);
  }

  const controlCategories: { category: string; score: number; maxScore: number }[] = [];
  if (latestScore?.controlScores) {
    const profileMaxById = new Map<string, number>();
    for (const profile of controlProfiles) {
      const maxScore = parseFiniteNumber(profile.maxScore);
      if (!profile.id || maxScore == null) continue;
      profileMaxById.set(profile.id, maxScore);
    }
    const catMap = new Map<string, { score: number; maxScore: number }>();
    for (const ctrl of latestScore.controlScores) {
      const cat = ctrl.controlCategory ?? "Other";
      const existing = catMap.get(cat) ?? { score: 0, maxScore: 0 };
      const score = parseFiniteNumber(ctrl.score) ?? 0;
      const profileMax = profileMaxById.get(ctrl.controlName ?? "") ?? 0;
      catMap.set(cat, { score: existing.score + score, maxScore: existing.maxScore + profileMax });
    }
    for (const [category, vals] of catMap.entries()) {
      controlCategories.push({ category, score: vals.score, maxScore: vals.maxScore });
    }
  }

  const caPolicies = caps.map((p) => ({
    id: p.id ?? "",
    displayName: p.displayName ?? "Unnamed Policy",
    state: p.state ?? "unknown",
    targetUsers: summariseUsers(p.conditions?.users),
    targetApps: summariseApps(p.conditions?.applications),
    authStrength: summariseAuthStrength(p.grantControls),
    modifiedDateTime: p.modifiedDateTime ?? null,
  }));

  const secureScoreControls = (latestScore?.controlScores ?? []).map((ctrl) => {
    const score = parseFiniteNumber(ctrl.score) ?? 0;
    const maxScore = parseFiniteNumber(ctrl.maxScore) ?? parseFiniteNumber(ctrl.controlContributionToScore) ?? 0;
    const pct: number = parseFiniteNumber(ctrl.scoreInPercentage)
      ?? (maxScore > 0 ? Math.round((score / maxScore) * 100) : 0);
    const status = pct >= 80 ? "configured" : pct > 0 ? "partial" : "notConfigured";
    const name = ctrl.controlName ?? "";
    return {
      controlName: name,
      title: profileTitleById.get(name) ?? name,
      controlCategory: ctrl.controlCategory ?? "Other",
      description: ctrl.description ?? "",
      score, scoreInPercentage: pct,
      implementationStatus: ctrl.implementationStatus ?? "",
      lastSynced: ctrl.lastSynced ?? null,
      status,
    };
  });

  const legacyAuthSignInCount = legacyAuthData.issue
    ? null
    : (legacyAuthData.data?.["@odata.count"] ?? (legacyAuthData.data?.value?.length ?? 0));

  const legacyAuthBlockedByCA = caps.some((p) => {
    if (p.state !== "enabled") return false;
    const clientTypes = p.conditions?.clientAppTypes ?? [];
    const hasLegacyClient = clientTypes.some((t) => ["exchangeActiveSync", "other"].includes(t));
    const blocksAccess = p.grantControls?.builtInControls?.includes("block") ||
      (p.grantControls === null && p.sessionControls !== null);
    return hasLegacyClient && blocksAccess;
  });

  return {
    secureScore, secureScoreMax, secureScorePercent,
    mfaEnabledUsers, mfaDisabledUsers, mfaEnabledPercent,
    conditionalAccessPolicies: caps.length,
    enabledCAPs, disabledCAPs, reportOnlyCAPs,
    secureScoreHistory, controlCategories, caPolicies,
    riskyUsers: riskyUsersDetail.length,
    adminsWithoutMfa: mfaDisabledUsers,
    mfaUsersList, mfaMethodsBreakdown, riskDetectionTimeline, riskyUsersDetail, secureScoreControls,
    legacyAuthSignInCount, legacyAuthBlockedByCA,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}

export async function collectSecurityEstate() {
  interface AlertItem {
    id: string; title: string; severity: string; status: string;
    serviceSource: string; category: string; createdDateTime: string | null;
  }

  async function fetchDefenderAlertsBySource(serviceSource: string, source: string): Promise<{ alerts: AlertItem[]; error: string | null }> {
    const endpoint =
      "https://graph.microsoft.com/v1.0/security/alerts_v2" +
      `?$filter=serviceSource+eq+'${serviceSource}'&$top=100&$orderby=createdDateTime+desc` +
      "&$select=id,title,severity,status,serviceSource,category,createdDateTime";
    const result = await fetchGraphJson<{ value?: GraphAlertV2[] }>(endpoint, source);
    if (result.issue) return { alerts: [], error: result.issue.message };
    const rawAlerts = Array.isArray(result.data?.value) ? result.data.value : [];
    return {
      alerts: rawAlerts.map((a) => ({
        id: a.id ?? "", title: a.title ?? "", severity: a.severity ?? "Unknown",
        status: a.status ?? "Unknown", serviceSource: a.serviceSource ?? "",
        category: a.category ?? "", createdDateTime: a.createdDateTime ?? null,
      })),
      error: null,
    };
  }

  const MICROSOFT_TENANT_ID = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const filter = encodeURIComponent(`createdDateTime ge ${since}`);
  const resolvedLikeStatuses = new Set(["resolved", "redirected", "closed", "dismissed"]);

  const [devicesRawResult, managedDevicesRawResult, servicePrincipalsRawResult, oauthGrantsRawResult,
    mdeResult, defenderOfficeAlertsResult, defenderEndpointAlertsResult,
    incidentsResult, alertsResult] = await Promise.all([
    fetchAllGraphPages<GraphDevice>(
      "https://graph.microsoft.com/v1.0/devices" +
        `?$select=id,displayName,operatingSystem,operatingSystemVersion,trustType,isManaged,isCompliant,managementType,approximateLastSignInDateTime&$top=${GRAPH_MAX_PAGE_SIZE}`,
      "securityEstateDevices",
    ),
    fetchAllGraphPages<GraphManagedDevice>(
      "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices" +
        // enrolledDateTime is selected for its stability, not for display: it is
        // part of the tuple that keys a managed device carrying no identifier.
        `?$select=id,deviceName,azureADDeviceId,operatingSystem,osVersion,lastSyncDateTime,enrolledDateTime,managementAgent,complianceState&$top=${GRAPH_MAX_PAGE_SIZE}`,
      "securityEstateManagedDevices",
    ),
    fetchAllGraphPages<GraphServicePrincipal>(
      "https://graph.microsoft.com/v1.0/servicePrincipals" +
        `?$select=id,displayName,appId,publisherName,servicePrincipalType,appOwnerOrganizationId,createdDateTime,tags&$top=${GRAPH_MAX_PAGE_SIZE}`,
      "securityEstateServicePrincipals",
    ),
    fetchAllGraphPages<GraphOAuthGrant>(
      `https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$select=clientId,consentType,principalId,scope&$top=${GRAPH_MAX_PAGE_SIZE}`,
      "securityEstateOauth2PermissionGrants",
    ),
    fetchDefenderMachinesWithDiagnostics(),
    fetchDefenderAlertsBySource("microsoftDefenderForOffice365", "securityDefenderOfficeAlerts"),
    fetchDefenderAlertsBySource("microsoftDefenderForEndpoint", "securityDefenderEndpointAlerts"),
    fetchAllGraphPages<GraphIncident>(
      `https://graph.microsoft.com/v1.0/security/incidents?$filter=${filter}&$top=50&$select=id,status,createdDateTime`,
      "securityIncidentSummary30dIncidents",
    ),
    fetchAllGraphPages<GraphAlertV2>(
      `https://graph.microsoft.com/v1.0/security/alerts_v2?$filter=${filter}&$top=50&$select=id,status,createdDateTime`,
      "securityIncidentSummary30dAlerts",
    ),
  ]);

  const devicesRaw = devicesRawResult.items;
  const managedDevicesRaw = managedDevicesRawResult.items;
  const servicePrincipalsRaw = servicePrincipalsRawResult.items;
  const oauthGrantsRaw = oauthGrantsRawResult.items;
  const mdeMachinesRaw = mdeResult.machines;

  const spNameMap = new Map<string, string>();
  for (const sp of servicePrincipalsRaw) {
    if (sp.id) spNameMap.set(sp.id, sp.displayName ?? sp.id);
  }

  const normalizeName = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

  interface DeviceEstateEntry {
    id: string;
    displayName: string;
    operatingSystem: string;
    operatingSystemVersion: string | null;
    trustType: string | null;
    isManaged: boolean;
    isCompliant: boolean | null;
    managementType: string | null;
    approximateLastSignInDateTime: string | null;
  }

  const deviceList: DeviceEstateEntry[] = devicesRaw.map((d) => ({
    id: d.id ?? "",
    displayName: d.displayName ?? "Unknown",
    operatingSystem: d.operatingSystem ?? "Unknown",
    operatingSystemVersion: d.operatingSystemVersion ?? null,
    trustType: d.trustType ?? null,
    isManaged: d.isManaged ?? false,
    isCompliant: d.isCompliant ?? null,
    managementType: d.managementType ?? null,
    approximateLastSignInDateTime: d.approximateLastSignInDateTime ?? null,
  }));

  const byId = new Map(deviceList.map((d) => [d.id, d]));
  const byName = new Map(deviceList.map((d) => [normalizeName(d.displayName), d] as const).filter(([name]) => name.length > 0));

  let unidentifiableManagedDevices = 0;
  let unidentifiableMdeMachines = 0;

  for (const md of managedDevicesRaw) {
    const aadDeviceId = md.azureADDeviceId ?? null;
    const deviceName = md.deviceName ?? "Unknown";
    const existingByName = byName.get(normalizeName(deviceName));
    const id = managedDeviceIdentity(md);
    if (!id) {
      unidentifiableManagedDevices += 1;
      continue;
    }
    const existing = byId.get(id) ?? (!aadDeviceId ? existingByName : undefined);
    const complianceState = md.complianceState?.toLowerCase() ?? "unknown";
    const inferredCompliance = complianceState === "compliant" ? true : complianceState === "noncompliant" ? false : null;
    if (existing) {
      existing.isManaged = true;
      if (!existing.managementType) existing.managementType = "MDM";
      if (existing.isCompliant === null) existing.isCompliant = inferredCompliance;
      if (!existing.approximateLastSignInDateTime) existing.approximateLastSignInDateTime = md.lastSyncDateTime ?? existing.approximateLastSignInDateTime;
      continue;
    }
    const merged: DeviceEstateEntry = {
      id, displayName: deviceName, operatingSystem: md.operatingSystem ?? "Unknown",
      operatingSystemVersion: md.osVersion ?? null, trustType: null,
      isManaged: true, isCompliant: inferredCompliance, managementType: "MDM",
      approximateLastSignInDateTime: md.lastSyncDateTime ?? null,
    };
    deviceList.push(merged);
    byId.set(merged.id, merged);
    const n = normalizeName(merged.displayName);
    if (n.length > 0) byName.set(n, merged);
  }

  for (const m of mdeMachinesRaw) {
    const aadDeviceId = m.aadDeviceId ?? null;
    const mdeDisplayName = m.computerDnsName ?? m.deviceName ?? m.id ?? "Unknown";
    const existingByName = byName.get(normalizeName(mdeDisplayName));
    const id = mdeMachineIdentity(m);
    if (!id) {
      unidentifiableMdeMachines += 1;
      continue;
    }
    const existing = byId.get(id) ?? (!aadDeviceId ? existingByName : undefined);
    if (existing) {
      existing.managementType = "MicrosoftSense";
      existing.isManaged = true;
      if (!existing.approximateLastSignInDateTime) existing.approximateLastSignInDateTime = m.lastSeen ?? existing.approximateLastSignInDateTime;
      continue;
    }
    const merged: DeviceEstateEntry = {
      id, displayName: mdeDisplayName,
      operatingSystem: m.osPlatform ?? m.osProcessor ?? "Unknown",
      operatingSystemVersion: m.osVersion ?? null, trustType: null,
      isManaged: true, isCompliant: null, managementType: "MicrosoftSense",
      approximateLastSignInDateTime: m.lastSeen ?? null,
    };
    deviceList.push(merged);
    byId.set(merged.id, merged);
    const n = normalizeName(merged.displayName);
    if (n.length > 0) byName.set(n, merged);
  }

  const managed = deviceList.filter((d) => d.isManaged || !!d.managementType).length;
  const mde = mdeMachinesRaw.length;
  const azureAdJoined = deviceList.filter((d) => d.trustType === "AzureAd").length;
  const hybridJoined = deviceList.filter((d) => d.trustType === "ServerAd").length;
  const registered = deviceList.filter((d) => d.trustType === "Workplace").length;
  const unknownTrust = deviceList.filter((d) => !d.trustType).length;
  const osCounts: Record<string, number> = {};
  for (const d of deviceList) { const os = d.operatingSystem ?? "Unknown"; osCounts[os] = (osCounts[os] ?? 0) + 1; }

  const deviceSummary = { total: deviceList.length, managed, unmanaged: deviceList.length - managed, mde, azureAdJoined, hybridJoined, registered, unknown: unknownTrust, byOs: osCounts };

  const saasApps = servicePrincipalsRaw
    .filter((sp) => sp.servicePrincipalType === "Application")
    .map((sp) => ({
      id: sp.id ?? "", displayName: sp.displayName ?? "Unknown",
      publisherName: sp.publisherName ?? null,
      appOwnerOrganizationId: sp.appOwnerOrganizationId ?? null,
      isFirstParty: sp.appOwnerOrganizationId === MICROSOFT_TENANT_ID,
      createdDateTime: sp.createdDateTime ?? null, tags: sp.tags ?? [],
    }))
    .sort((a, b) => (a.isFirstParty === b.isFirstParty ? 0 : a.isFirstParty ? 1 : -1));

  const oauthMap = new Map<string, { clientId: string; displayName: string; consentType: string; scopes: string[]; isOrgWide: boolean }>();
  for (const grant of oauthGrantsRaw) {
    const clientId = grant.clientId ?? "";
    const scopeWords = (grant.scope ?? "").split(/\s+/).filter(Boolean);
    const existing = oauthMap.get(clientId);
    if (existing) {
      for (const s of scopeWords) if (!existing.scopes.includes(s)) existing.scopes.push(s);
      if (grant.consentType === "AllPrincipals") { existing.consentType = "AllPrincipals"; existing.isOrgWide = true; }
    } else {
      oauthMap.set(clientId, { clientId, displayName: spNameMap.get(clientId) ?? clientId, consentType: grant.consentType ?? "Unknown", scopes: scopeWords, isOrgWide: grant.consentType === "AllPrincipals" });
    }
  }
  const oauthApps = Array.from(oauthMap.values()).sort((a, b) => (a.isOrgWide === b.isOrgWide ? 0 : a.isOrgWide ? -1 : 1));

  // Keyed by the same identity the merge above used, so the standalone Defender
  // inventory and the merged estate agree on what a device is called.
  const mdeDeviceInventory: DeviceEstateEntry[] = mdeMachinesRaw
    .map((m): DeviceEstateEntry | null => {
      const id = mdeMachineIdentity(m);
      if (!id) return null;
      return {
        id,
        displayName: m.computerDnsName ?? m.deviceName ?? m.id ?? "Unknown",
        operatingSystem: m.osPlatform ?? m.osProcessor ?? "Unknown",
        operatingSystemVersion: m.osVersion ?? null, trustType: null,
        isManaged: true, isCompliant: null, managementType: "MicrosoftSense",
        approximateLastSignInDateTime: m.lastSeen ?? null,
      };
    })
    .filter((entry): entry is DeviceEstateEntry => entry !== null);

  const mdeStatus = { ok: !mdeResult.error, status: mdeResult.status, count: mdeMachinesRaw.length, scope: mdeResult.scope, error: mdeResult.error };

  const defenderOfficeAlerts = defenderOfficeAlertsResult.alerts;
  const defenderOfficeAlertsBySeverity = {
    high: defenderOfficeAlerts.filter((a) => a.severity.toLowerCase() === "high").length,
    medium: defenderOfficeAlerts.filter((a) => a.severity.toLowerCase() === "medium").length,
    low: defenderOfficeAlerts.filter((a) => a.severity.toLowerCase() === "low").length,
    informational: defenderOfficeAlerts.filter((a) => a.severity.toLowerCase() === "informational").length,
  };
  const defenderOfficeStatus = { ok: !defenderOfficeAlertsResult.error, error: defenderOfficeAlertsResult.error, totalAlerts: defenderOfficeAlerts.length, ...defenderOfficeAlertsBySeverity };

  const defenderEndpointAlerts = defenderEndpointAlertsResult.alerts;
  const defenderEndpointAlertsBySeverity = {
    high: defenderEndpointAlerts.filter((a) => a.severity.toLowerCase() === "high").length,
    medium: defenderEndpointAlerts.filter((a) => a.severity.toLowerCase() === "medium").length,
    low: defenderEndpointAlerts.filter((a) => a.severity.toLowerCase() === "low").length,
    informational: defenderEndpointAlerts.filter((a) => a.severity.toLowerCase() === "informational").length,
  };
  const defenderEndpointStatus = { ok: !defenderEndpointAlertsResult.error, error: defenderEndpointAlertsResult.error, totalAlerts: defenderEndpointAlerts.length, ...defenderEndpointAlertsBySeverity };

  const resolvedIncidents = incidentsResult.items.filter((i) => resolvedLikeStatuses.has((i.status ?? "").toLowerCase())).length;
  const resolvedAlerts = alertsResult.items.filter((a) => resolvedLikeStatuses.has((a.status ?? "").toLowerCase())).length;
  const incidentAlert30dSummary = {
    unresolvedIncidents: incidentsResult.items.length - resolvedIncidents, resolvedIncidents,
    unresolvedAlerts: alertsResult.items.length - resolvedAlerts, resolvedAlerts,
  };
  const firstError = incidentsResult.issues[0]?.message ?? alertsResult.issues[0]?.message ?? null;

  const collectionIssues: CollectionIssue[] = [
    ...devicesRawResult.issues,
    ...managedDevicesRawResult.issues,
    ...servicePrincipalsRawResult.issues,
    ...oauthGrantsRawResult.issues,
    ...mdeResult.issues,
    ...incidentsResult.issues,
    ...alertsResult.issues,
  ];

  // A device with no identifier and no name has nothing that survives to the
  // next collection, so it is left out of the drift-keyed inventory rather than
  // given an invented key that would report it as churn every run.
  if (unidentifiableManagedDevices > 0) {
    collectionIssues.push(createCollectionIssue(
      "securityEstateManagedDevices",
      null,
      `${unidentifiableManagedDevices} Intune managed device(s) carried no Entra device id, Intune id or device name, ` +
        "so no stable identity could be derived. They are excluded from the device inventory.",
    ));
  }
  if (unidentifiableMdeMachines > 0) {
    collectionIssues.push(createCollectionIssue(
      "securityEstateDefenderMachines",
      null,
      `${unidentifiableMdeMachines} Defender machine(s) carried no Entra device id, machine id or name, ` +
        "so no stable identity could be derived. They are excluded from the device inventory.",
    ));
  }

  return {
    deviceSummary, deviceList, mdeDeviceInventory, mdeStatus, saasApps, oauthApps,
    defenderOfficeAlerts, defenderOfficeStatus, defenderEndpointAlerts, defenderEndpointStatus,
    incidentAlert30dSummary,
    incidentAlert30dStatus: { ok: !firstError, error: firstError },
    collectionIssues,
  };
}
