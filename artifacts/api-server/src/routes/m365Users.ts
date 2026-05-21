import { Router } from "express";
import { getCached } from "../lib/graphClient.js";
import {
  fetchAllGraphPages,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

// Approximate monthly per-seat USD list prices for common SKUs
const SKU_COST_MAP: Record<string, number> = {
  "06ebc4ee-1bb5-47dd-8120-11324bc54e06": 57,   // Microsoft 365 E5
  "05e9a617-0261-4cee-bb44-138d3ef5d965": 36,   // Microsoft 365 E3
  "cbdc14ab-d96c-4c30-b9f4-6ada7cdc1d46": 22,   // Microsoft 365 Business Premium
  "f245ecc8-75af-4f8e-b61f-27d8114de5f3": 12.5, // Microsoft 365 Business Standard
  "3b555118-da6a-4418-894f-7df1e2096870": 6,    // Microsoft 365 Business Basic
  "18181a46-0d4e-45cd-891e-60aabd171b4e": 10,   // Office 365 E1
  "6fd2c87f-b296-42f0-b197-1e91e994b900": 23,   // Office 365 E3
  "c7df2760-2c81-4ef7-b578-5b5392b571df": 38,   // Office 365 E5
  "50f60901-3181-4b75-8a2c-4c8e4c1d5a72": 2.25, // Microsoft 365 F1
  "66b55226-6b4f-492c-910c-a3b7a3c9d993": 10,   // Microsoft 365 F3
  "639dec6b-bb19-468b-871c-c5c441c4b0cb": 30,   // Microsoft 365 Copilot
  "4c08402e-b2cc-4c9e-bee4-e1984e0e1986": 20,   // Power BI Premium Per User
  "078d2b04-f1bd-4111-bbd4-b4b1b354cef4": 6,    // Azure AD Premium P1
  "84a661c4-e949-4bd2-a560-ed7766fcaf2b": 9,    // Azure AD Premium P2
  "efccb6f7-5641-4e0e-bd10-b4976e1bf68e": 8,    // Exchange Online Plan 2
  "19ec0d23-8335-4cbd-94ac-6050e30712fa": 4,    // Exchange Online Plan 1
};

const GHOST_THRESHOLD_DAYS = 90;

export interface GhostUserItem {
  id: string;
  displayName: string;
  userPrincipalName: string;
  lastSignIn: string | null;
  daysInactive: number | null;
  assignedLicenseCount: number;
  estimatedMonthlyCost: number;
}

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

  const nowMs = Date.now();
  const ghostThresholdMs = GHOST_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const ghostUsers: GhostUserItem[] = [];
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

    // Ghost: enabled, licensed, inactive for 90+ days (or never signed in)
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
