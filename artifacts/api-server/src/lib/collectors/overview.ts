import {
  fetchAllGraphPages,
  fetchGraphJson,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";

export async function collectOverview() {
  const [orgData, usersData, subsData, secScoreData, mfaData, healthData] =
    await Promise.all([
      fetchGraphJson<any>(
        "https://graph.microsoft.com/v1.0/organization?$select=displayName,id",
        "organization",
      ),
      fetchAllGraphPages<any>(
        "https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,userType&$top=999",
        "users",
      ),
      fetchGraphJson<any>(
        "https://graph.microsoft.com/v1.0/subscribedSkus",
        "subscribedSkus",
      ),
      fetchGraphJson<any>(
        "https://graph.microsoft.com/v1.0/security/secureScores?$top=1",
        "secureScores",
      ),
      fetchAllGraphPages<any>(
        "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$select=id,isMfaRegistered&$top=999",
        "userRegistrationDetails",
      ),
      fetchGraphJson<any>(
        "https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews",
        "serviceHealthOverviews",
      ),
    ]);

  const collectionIssues: CollectionIssue[] = [];
  if (orgData.issue) collectionIssues.push(orgData.issue);
  collectionIssues.push(...usersData.issues);
  if (subsData.issue) collectionIssues.push(subsData.issue);
  if (secScoreData.issue) collectionIssues.push(secScoreData.issue);
  collectionIssues.push(...mfaData.issues);
  if (healthData.issue) collectionIssues.push(healthData.issue);

  const org = orgData.data?.value?.[0] ?? null;
  const rawUsers: any[] = usersData.items;
  const subs: any[] = subsData.data?.value ?? [];
  const secScore = secScoreData.data?.value?.[0] ?? null;
  const mfaUsers: any[] = mfaData.items;
  const services: any[] = healthData.data?.value ?? [];

  const totalUsers = rawUsers.length;
  let activeUsers = 0;
  let guestUsers = 0;
  let disabledUsers = 0;

  for (const u of rawUsers) {
    if (u.userType === "Guest") guestUsers++;
    if (!u.accountEnabled) disabledUsers++;
    else if (u.userType !== "Guest") activeUsers++;
  }

  let totalLicenses = 0;
  let assignedLicenses = 0;
  for (const sku of subs) {
    totalLicenses += sku.prepaidUnits?.enabled ?? 0;
    assignedLicenses += sku.consumedUnits ?? 0;
  }

  const secureScore = secScore?.currentScore ?? 0;
  const secureScoreMax = secScore?.maxScore ?? 100;

  const mfaEnabledCount = mfaUsers.filter((u: any) => u.isMfaRegistered).length;
  const mfaEnabledPercent =
    mfaUsers.length > 0 ? Math.round((mfaEnabledCount / mfaUsers.length) * 100) : 0;

  const totalServices = services.length;
  const activeServices = services.filter(
    (s: any) => s.status === "serviceOperational",
  ).length;

  return {
    tenantName: org?.displayName ?? "Unknown Tenant",
    tenantId: org?.id ?? "",
    totalUsers,
    activeUsers,
    totalLicenses,
    assignedLicenses,
    mfaEnabledPercent,
    secureScore,
    secureScoreMax,
    guestUsers,
    disabledUsers,
    activeServices,
    totalServices,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}
