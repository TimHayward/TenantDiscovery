import { Router } from "express";
import { getCached } from "../lib/graphClient.js";
import {
  fetchAllGraphPages,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

async function getUsersData() {
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

    return {
      id: u.id,
      displayName: u.displayName ?? "",
      userPrincipalName: u.userPrincipalName ?? "",
      accountEnabled: u.accountEnabled ?? false,
      userType: u.userType ?? "Member",
      mfaEnabled: isMfa,
      lastSignIn,
      assignedLicenses: u.assignedLicenses?.length ?? 0,
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
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}

router.get("/m365/users", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-users", getUsersData);

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 users");
    res.status(500).json({ error: "Failed to fetch M365 users" });
  }
});

router.get("/m365/users/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-users", getUsersData);

    const fieldMetadata = {
      totalUsers: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "User.Read.All",
        notes: ["Total count from Microsoft Graph users collection"],
      },
      activeUsers: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "User.Read.All",
        notes: ["Computed from accountEnabled users"],
      },
      disabledUsers: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "User.Read.All",
        notes: ["Computed from accountEnabled=false users"],
      },
      guestUsers: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "User.Read.All",
        notes: ["Computed from userType=Guest users"],
      },
      memberUsers: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "User.Read.All",
        notes: ["Computed from non-Guest users"],
      },
      mfaEnabled: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
        notes: ["Count from authentication methods user registration report"],
      },
      mfaDisabled: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Reports.Read.All",
        notes: ["Computed from users without MFA registration"],
      },
      neverSignedIn: {
        evidenceStatus: "partial" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "AuditLog.Read.All",
        notes: ["Depends on signInActivity availability and retention"],
      },
      usersByDepartment: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "User.Read.All",
        notes: ["Derived from department attribute which may be unassigned"],
      },
      users: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "User.Read.All",
        notes: ["Detailed user list from Graph users endpoint"],
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
    req.log.error({ err }, "Failed to fetch M365 users with metadata");
    res.status(500).json({ error: "Failed to fetch M365 users" });
  }
});

export default router;
