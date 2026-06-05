import {
  fetchAllGraphPages,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";

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

export async function collectUsers() {
  const [rawUsersResult, mfaUsersResult] = await Promise.all([
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
  ]);

  const collectionIssues: CollectionIssue[] = [
    ...rawUsersResult.issues,
    ...mfaUsersResult.issues,
  ];

  const rawUsers = rawUsersResult.items;
  const mfaUsers = mfaUsersResult.items;

  const mfaMap = new Map<string, boolean>();
  for (const m of mfaUsers) {
    mfaMap.set(m.id, m.isMfaRegistered ?? false);
  }

  const totalUsers = rawUsers.length;
  let activeUsers = 0;
  let disabledUsers = 0;
  let guestUsers = 0;
  let memberUsers = 0;
  let mfaEnabled = 0;
  let mfaDisabled = 0;
  let neverSignedIn = 0;

  const deptMap = new Map<string, number>();

  const nowMs = Date.now();
  const ghostThresholdMs = GHOST_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const ghostUsers: any[] = [];
  let estimatedMonthlyWaste = 0;

  const users = rawUsers.map((u: any) => {
    const isMfa = mfaMap.get(u.id) ?? false;
    if (u.accountEnabled) activeUsers++;
    else disabledUsers++;
    if (u.userType === "Guest") guestUsers++;
    else memberUsers++;
    if (isMfa) mfaEnabled++;
    else mfaDisabled++;

    const lastSignIn =
      u.signInActivity?.lastSignInDateTime ??
      u.signInActivity?.lastNonInteractiveSignInDateTime ??
      null;
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
      assignedLicenses: licenseCount,
      department: u.department ?? null,
      jobTitle: u.jobTitle ?? null,
    };
  });

  const usersByDepartment = Array.from(deptMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([department, count]) => ({ department, count }));

  return {
    totalUsers,
    activeUsers,
    disabledUsers,
    guestUsers,
    memberUsers,
    mfaEnabled,
    mfaDisabled,
    neverSignedIn,
    usersByDepartment,
    users,
    ghostUsers,
    ghostLicensedCount: ghostUsers.length,
    estimatedMonthlyWaste: Math.round(estimatedMonthlyWaste * 100) / 100,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}
