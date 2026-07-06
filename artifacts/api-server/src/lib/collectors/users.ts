import {
  fetchAllGraphPages,
  fetchGraphText,
  fetchGraphJson,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";
import { parseCsv } from "../csv.js";

const SKU_COST_MAP: Record<string, number> = {
  "06ebc4ee-1bb5-47dd-8120-11324bc54e06": 57,
  "05e9a617-0261-4cee-bb44-138d3ef5d965": 36,
  "cbdc14ab-d96c-4c30-b9f4-6ada7cdc1d46": 22,
  "f245ecc8-75af-4f8e-b61f-27d8114de5f3": 12.5,
  "3b555118-da6a-4418-894f-7df1e2096870": 6,
  "18181a46-0d4e-45cd-891e-60aabd171b4e": 10,
  "6fd2c87f-b296-42f0-b197-1e91e994b900": 23,
  "c7df2760-2c81-4ef7-b578-5b5392b571df": 38,
  "50f60901-3181-4b75-8a2c-4c8e4c1d5a72": 2.25,
  "66b55226-6b4f-492c-910c-a3b7a3c9d993": 10,
  "639dec6b-bb19-468b-871c-c5c441c4b0cb": 30,
  "4c08402e-b2cc-4c9e-bee4-e1984e0e1986": 20,
  "078d2b04-f1bd-4111-bbd4-b4b1b354cef4": 6,
  "84a661c4-e949-4bd2-a560-ed7766fcaf2b": 9,
  "efccb6f7-5641-4e0e-bd10-b4976e1bf68e": 8,
  "19ec0d23-8335-4cbd-94ac-6050e30712fa": 4,
};

const GHOST_THRESHOLD_DAYS = 90;

export type SignInDataSource = "graphAuditLog" | "usageReportFallback" | "unavailable";
export type MfaDataSource = "graph" | "unavailable";
export type MfaEnforcementSignal =
  | "securityDefaults"
  | "conditionalAccess"
  | "none"
  | "unknown";

/**
 * Resolve a user's last-activity timestamp, preferring authoritative Graph
 * sign-in activity and only falling back to the usage-report last-activity map
 * when Graph gives us nothing for this user.
 */
export function resolveLastSignIn(
  signInActivity:
    | { lastSignInDateTime?: string | null; lastNonInteractiveSignInDateTime?: string | null }
    | null
    | undefined,
  userPrincipalName: string | null | undefined,
  activityByUpn: Map<string, string>,
): { lastSignIn: string | null; source: "graph" | "usageReportFallback" | "none" } {
  const graphLastSignIn =
    signInActivity?.lastSignInDateTime ??
    signInActivity?.lastNonInteractiveSignInDateTime ??
    null;
  if (graphLastSignIn) return { lastSignIn: graphLastSignIn, source: "graph" };

  const upn = (userPrincipalName ?? "").toLowerCase();
  const fallback = upn ? activityByUpn.get(upn) ?? null : null;
  if (fallback) return { lastSignIn: fallback, source: "usageReportFallback" };

  return { lastSignIn: null, source: "none" };
}

/**
 * Pure derivation of the coarse tenant-wide MFA-enforcement signal from
 * already-fetched policy data. Kept separate from the fetching wrapper so it can
 * be unit-tested without the Graph credential layer.
 */
export function deriveMfaEnforcementSignalFromPolicies(input: {
  securityDefaultsEnabled: boolean;
  securityDefaultsFailed: boolean;
  caPolicies: any[];
  caFailed: boolean;
}): MfaEnforcementSignal {
  if (input.securityDefaultsEnabled) return "securityDefaults";

  const caMfaEnforced = input.caPolicies.some((p: any) => {
    if (p.state !== "enabled") return false;
    const builtIn: string[] = p.grantControls?.builtInControls ?? [];
    if (!builtIn.includes("mfa")) return false;
    const includeUsers: string[] = p.conditions?.users?.includeUsers ?? [];
    const includeApps: string[] = p.conditions?.applications?.includeApplications ?? [];
    return includeUsers.includes("All") && includeApps.includes("All");
  });
  if (caMfaEnforced) return "conditionalAccess";

  // If both source calls themselves failed we genuinely cannot tell.
  if (input.securityDefaultsFailed && input.caFailed) return "unknown";

  return "none";
}

/**
 * Derive a coarse, tenant-wide "MFA appears to be enforced" signal from
 * Conditional Access + Security Defaults. Used only as a fallback when the
 * per-user MFA registration report is unavailable (missing Reports.Read.All /
 * UserAuthenticationMethod.Read.All). Both source calls need only
 * Policy.Read.All, which is already required tier. This is deliberately
 * qualitative — it is NOT a substitute for the numeric MFA-registered percent.
 */
async function deriveMfaEnforcementSignal(): Promise<MfaEnforcementSignal> {
  const [secDefaultsResult, caPoliciesResult] = await Promise.all([
    fetchGraphJson<any>(
      "https://graph.microsoft.com/v1.0/policies/identitySecurityDefaultsEnforcementPolicy",
      "identitySecurityDefaults",
    ),
    fetchAllGraphPages<any>(
      "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?$top=999",
      "conditionalAccessPolicies",
    ),
  ]);

  return deriveMfaEnforcementSignalFromPolicies({
    securityDefaultsEnabled: secDefaultsResult.data?.isEnabled === true,
    securityDefaultsFailed: !!secDefaultsResult.issue,
    caPolicies: caPoliciesResult.items,
    caFailed: caPoliciesResult.issues.length > 0,
  });
}

export async function collectUsers() {
  const [rawUsersResult, mfaUsersResult, activityCsvResult] = await Promise.all([
    fetchAllGraphPages<any>(
      "https://graph.microsoft.com/v1.0/users" +
        "?$select=id,displayName,userPrincipalName,accountEnabled,userType,signInActivity,assignedLicenses,department,jobTitle" +
        "&$top=999",
      "users",
    ),
    fetchAllGraphPages<any>(
      "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails" +
        "?$select=id,isMfaRegistered&$top=999",
      "userRegistrationDetails",
    ),
    // Fallback source for last-activity when signInActivity is unavailable
    // (missing AuditLog.Read.All silently nulls signInActivity with no 403).
    // getOffice365ActiveUserDetail needs only Reports.Read.All (required tier).
    fetchGraphText(
      "https://graph.microsoft.com/v1.0/reports/getOffice365ActiveUserDetail(period='D90')",
      "office365ActiveUserDetailReport",
    ),
  ]);

  const collectionIssues: CollectionIssue[] = [
    ...rawUsersResult.issues,
    ...mfaUsersResult.issues,
  ];
  // Note: the usage-report fallback is best-effort; its failure is communicated
  // via signInDataSource rather than escalated as a collection issue.

  const rawUsers = rawUsersResult.items;
  const mfaUsers = mfaUsersResult.items;

  // When the MFA registration report genuinely failed on a permission error we
  // must NOT default every user to "not registered" (the old silent bug) — that
  // fabricates a 0% MFA figure. Instead we mark MFA as unavailable/unknown.
  const mfaUnavailable = mfaUsersResult.issues.some(isPermissionIssue);

  const mfaMap = new Map<string, boolean>();
  for (const m of mfaUsers) {
    mfaMap.set(m.id, m.isMfaRegistered ?? false);
  }

  // Build the last-activity fallback lookup keyed by lowercased UPN. Tenants
  // with concealed usernames in reports will simply not match, leaving those
  // users on the "none" source.
  const activityRows = parseCsv(activityCsvResult.text ?? "");
  const activityByUpn = new Map<string, string>();
  for (const row of activityRows) {
    const upn = (row["User Principal Name"] ?? "").toLowerCase();
    const lastActivity = row["Last Activity Date"] ?? "";
    if (upn && lastActivity) activityByUpn.set(upn, lastActivity);
  }

  const totalUsers = rawUsers.length;
  let activeUsers = 0;
  let disabledUsers = 0;
  let guestUsers = 0;
  let memberUsers = 0;
  let mfaEnabled = 0;
  let mfaDisabled = 0;
  let neverSignedIn = 0;
  let anyGraphSignIn = false;
  let signInFallbackCount = 0;

  const deptMap = new Map<string, number>();

  const nowMs = Date.now();
  const ghostThresholdMs = GHOST_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const ghostUsers: any[] = [];
  let estimatedMonthlyWaste = 0;

  const users = rawUsers.map((u: any) => {
    const isMfa = mfaUnavailable ? null : (mfaMap.get(u.id) ?? false);
    if (u.accountEnabled) activeUsers++;
    else disabledUsers++;
    if (u.userType === "Guest") guestUsers++;
    else memberUsers++;
    if (isMfa === true) mfaEnabled++;
    else if (isMfa === false) mfaDisabled++;

    // Prefer authoritative Graph sign-in activity; fall back to usage-report
    // last-activity only when Graph gives us nothing for this user.
    const { lastSignIn, source: lastSignInSource } = resolveLastSignIn(
      u.signInActivity,
      u.userPrincipalName,
      activityByUpn,
    );
    if (lastSignInSource === "graph") anyGraphSignIn = true;
    else if (lastSignInSource === "usageReportFallback") signInFallbackCount++;
    if (!lastSignIn) neverSignedIn++;

    const dept = u.department ?? "Unassigned";
    deptMap.set(dept, (deptMap.get(dept) ?? 0) + 1);

    const licenseCount = u.assignedLicenses?.length ?? 0;

    if (u.accountEnabled && licenseCount > 0) {
      const isGhost = !lastSignIn || (nowMs - new Date(lastSignIn).getTime() > ghostThresholdMs);
      if (isGhost) {
        const daysInactive = lastSignIn
          ? Math.floor((nowMs - new Date(lastSignIn).getTime()) / 86_400_000)
          : null;
        let monthlyCost = 0;
        for (const lic of u.assignedLicenses ?? []) {
          monthlyCost += SKU_COST_MAP[lic.skuId] ?? 0;
        }
        estimatedMonthlyWaste += monthlyCost;
        ghostUsers.push({
          id: u.id,
          displayName: u.displayName ?? "",
          userPrincipalName: u.userPrincipalName ?? "",
          lastSignIn,
          daysInactive,
          assignedLicenseCount: licenseCount,
          estimatedMonthlyCost: monthlyCost,
        });
      }
    }

    return {
      id: u.id,
      displayName: u.displayName ?? "",
      userPrincipalName: u.userPrincipalName ?? "",
      accountEnabled: u.accountEnabled ?? false,
      userType: u.userType ?? "Member",
      mfaEnabled: isMfa,
      lastSignIn,
      lastSignInSource,
      assignedLicenses: licenseCount,
      department: u.department ?? null,
      jobTitle: u.jobTitle ?? null,
    };
  });

  const usersByDepartment = Array.from(deptMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([department, count]) => ({ department, count }));

  // Aggregate provenance for the sign-in-derived metrics (stale buckets,
  // neverSignedIn, ghost-license waste).
  const signInDataSource: SignInDataSource = anyGraphSignIn
    ? "graphAuditLog"
    : signInFallbackCount > 0
      ? "usageReportFallback"
      : "unavailable";

  const mfaDataSource: MfaDataSource = mfaUnavailable ? "unavailable" : "graph";
  const mfaEnforcementSignal: MfaEnforcementSignal = mfaUnavailable
    ? await deriveMfaEnforcementSignal()
    : "unknown";

  return {
    totalUsers,
    activeUsers,
    disabledUsers,
    guestUsers,
    memberUsers,
    mfaEnabled: mfaUnavailable ? null : mfaEnabled,
    mfaDisabled: mfaUnavailable ? null : mfaDisabled,
    neverSignedIn,
    usersByDepartment,
    users,
    ghostUsers,
    ghostLicensedCount: ghostUsers.length,
    estimatedMonthlyWaste: Math.round(estimatedMonthlyWaste * 100) / 100,
    // Fallback provenance
    signInDataSource,
    signInFallbackCount,
    mfaDataSource,
    mfaEnforcementSignal,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}
