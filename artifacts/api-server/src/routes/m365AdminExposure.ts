import { Router } from "express";
import { getCached } from "../lib/graphClient.js";
import { logger } from "../lib/logger.js";
import {
  fetchAllGraphPages,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import {
  aggregateAdminExposure,
  type AdminExposureUserItem,
  type RoleAssignmentItem,
} from "../lib/adminExposureAggregation.js";

const router = Router();

const GLOBAL_ADMIN_ROLE_TEMPLATE_ID = "62e90394-69f5-4237-9190-012177145e10";

const CURATED_ADMIN_ROLE_TEMPLATE_IDS: Record<string, string> = {
  "62e90394-69f5-4237-9190-012177145e10": "Global Administrator",
  "194ae4cb-b126-40b2-bd5b-6091b380977d": "Security Administrator",
  "29232cdf-9323-42fd-ade2-1d097af3e4de": "Exchange Administrator",
  "f2ef992c-3afb-46b9-b7cf-a126ee74c451": "Global Reader",
  "69091246-20e8-4a56-aa4d-066075b2a7a8": "Teams Administrator",
  "729827e3-9c14-49f7-bb1b-9608f156bbb8": "Helpdesk Administrator",
  "b0f54661-2d74-4c50-afa3-1ec803f12efe": "Billing Administrator",
  "b1be1c3e-b65d-4f19-8427-f6fa0d97feb9": "Conditional Access Administrator",
  "fe930be7-5e62-47db-91af-98c3a49a38b1": "User Administrator",
  "9f06204d-73c1-4d4c-880a-6edb90606fd8": "Application Administrator",
  "3a2c62db-5318-420d-8d74-23affee5d9d5": "Intune Administrator",
  "7698a772-787b-4ac8-901f-60d6b08affd2": "Cloud App Administrator",
  "e8611ab8-c189-46e8-94e1-60213ab1f814": "Privileged Role Administrator",
  "158c047a-c907-4556-b7ef-446551a6b5f7": "Cloud Device Administrator",
  "45d7815d-2f0c-4d3a-bf7f-a3fb5b97b6fd": "Identity Governance Administrator",
  "11451d60-acb2-45eb-a7d6-43d0f0784e13": "Directory Synchronization Administrator",
  "fec66b51-eb08-4d72-8be5-77a1f845b1d9": "Search Administrator",
  "4ba39ca4-527c-499a-b93d-79787649e1da": "SharePoint Administrator",
  "e3973bdf-4987-49ae-837a-ba8e231c7286": "Password Administrator",
};

const PRODUCTIVITY_SERVICE_PLAN_IDS = new Set([
  // Exchange Online (any mailbox plan)
  "9aaf7827-d63c-4b61-89c3-182f06f82e5c", // Exchange Online Plan 1
  "efb87545-963c-4e0d-99df-69c6916d9eb0", // Exchange Online Plan 2
  "4a82b400-a79f-41a4-b4e2-e94f5787b113", // Exchange Online Kiosk
  "7bba6b08-c33f-4b18-bc0e-5bddce03d844", // Exchange Online Essentials
  // Microsoft Teams
  "57ff2da0-773e-42df-b2af-ffb7a2317929", // Microsoft Teams
  // SharePoint
  "fcfe4581-5f61-4a3b-b20b-74c58d1c680d", // SharePoint Online Plan 1
  "e95bec33-7c88-4a70-8e19-b8f99b0b57a7", // SharePoint Online Plan 2
  // OneDrive for Business
  "e03c7bff-e33d-4810-b0e7-46b98aaf8849", // OneDrive for Business Plan 1
  "ed9f2c14-9e8e-46d1-a0c2-3dce9248efe0", // OneDrive for Business Plan 2
  // Microsoft 365 Apps for Enterprise/Business
  "43de0ff5-c92c-492b-9116-175376d08c38", // Microsoft 365 Apps for Enterprise (OFFICESUBSCRIPTION)
]);

interface RoleDefinitionItem {
  id?: string;
  templateId?: string;
  roleTemplateId?: string;
  displayName?: string;
}

interface UserItem {
  id?: string;
  displayName?: string;
  userPrincipalName?: string;
  accountEnabled?: boolean;
  assignedPlans?: Array<{ service?: string; capabilityStatus?: string; servicePlanId?: string }>;
}

async function getAdminExposureData() {
  const [
    roleAssignmentsResult,
    roleEligibilityResult,
    roleDefinitionsResult,
    usersResult,
  ] = await Promise.all([
    fetchAllGraphPages<RoleAssignmentItem>(
      "https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments" +
        "?$select=principalId,roleDefinitionId",
      "roleAssignments",
    ),
    fetchAllGraphPages<RoleAssignmentItem>(
      "https://graph.microsoft.com/v1.0/roleManagement/directory/roleEligibilityScheduleInstances" +
        "?$select=principalId,roleDefinitionId",
      "roleEligibilityScheduleInstances",
    ),
    fetchAllGraphPages<RoleDefinitionItem>(
      "https://graph.microsoft.com/v1.0/roleManagement/directory/roleDefinitions",
      "roleDefinitions",
    ),
    fetchAllGraphPages<UserItem>(
      "https://graph.microsoft.com/v1.0/users" +
        "?$select=id,displayName,userPrincipalName,accountEnabled,assignedPlans" +
        "&$top=999",
      "users",
    ),
  ]);

  logger.debug(
    {
      roleAssignmentCount: roleAssignmentsResult.items.length,
      roleEligibilityCount: roleEligibilityResult.items.length,
      roleDefinitionCount: roleDefinitionsResult.items.length,
      userCount: usersResult.items.length,
    },
    "Initial data fetched from Graph API",
  );

  const collectionIssues: CollectionIssue[] = [
    ...roleAssignmentsResult.issues,
    ...roleEligibilityResult.issues,
    ...roleDefinitionsResult.issues,
    ...usersResult.issues,
  ];

  if (collectionIssues.length > 0) {
    logger.warn({ collectionIssues }, "Collection issues encountered");
  }

  const userById = new Map<string, Omit<AdminExposureUserItem, "roles">>();
  for (const user of usersResult.items) {
    if (!user.id) continue;

    const hasProductivityLicense = (user.assignedPlans ?? []).some(
      (plan) =>
        plan.capabilityStatus === "Enabled" &&
        PRODUCTIVITY_SERVICE_PLAN_IDS.has(plan.servicePlanId ?? ""),
    );

    userById.set(user.id, {
      id: user.id,
      displayName: user.displayName ?? "",
      userPrincipalName: user.userPrincipalName ?? "",
      accountEnabled: user.accountEnabled ?? false,
      hasProductivityLicense,
    });
  }

  logger.debug({ userCount: userById.size }, "User map populated");

  const referencedPrincipalIds = new Set<string>();
  for (const item of roleAssignmentsResult.items) {
    if (item.principalId) referencedPrincipalIds.add(item.principalId);
  }
  for (const item of roleEligibilityResult.items) {
    if (item.principalId) referencedPrincipalIds.add(item.principalId);
  }

  const unknownPrincipalIds = Array.from(referencedPrincipalIds).filter((id) => !userById.has(id));
  const groupMemberUserIdsByGroupId = new Map<string, Set<string>>();

  if (unknownPrincipalIds.length > 0) {
    const groupFetchResults = await Promise.all(
      unknownPrincipalIds.map(async (principalId) => {
        const groupUsersResult = await fetchAllGraphPages<UserItem>(
          `https://graph.microsoft.com/v1.0/groups/${principalId}/transitiveMembers/microsoft.graph.user` +
            "?$select=id,displayName,userPrincipalName,accountEnabled,assignedPlans&$top=999",
          `groupMembers:${principalId}`,
        );

        const filteredIssues = groupUsersResult.issues.filter((issue) => issue.category !== "notFound");
        if (filteredIssues.length > 0) {
          collectionIssues.push(...filteredIssues);
        }

        return { principalId, users: groupUsersResult.items };
      }),
    );

    for (const result of groupFetchResults) {
      if (result.users.length === 0) continue;

      const memberIds = new Set<string>();
      for (const user of result.users) {
        if (!user.id) continue;
        memberIds.add(user.id);

        if (!userById.has(user.id)) {
          const hasProductivityLicense = (user.assignedPlans ?? []).some(
            (plan) =>
              plan.capabilityStatus === "Enabled" &&
              PRODUCTIVITY_SERVICE_PLAN_IDS.has(plan.servicePlanId ?? ""),
          );

          userById.set(user.id, {
            id: user.id,
            displayName: user.displayName ?? "",
            userPrincipalName: user.userPrincipalName ?? "",
            accountEnabled: user.accountEnabled ?? false,
            hasProductivityLicense,
          });
        }
      }

      if (memberIds.size > 0) {
        groupMemberUserIdsByGroupId.set(result.principalId, memberIds);
      }
    }
  }

  logger.debug(
    {
      referencedPrincipalCount: referencedPrincipalIds.size,
      unknownPrincipalCount: unknownPrincipalIds.length,
      expandedGroupCount: groupMemberUserIdsByGroupId.size,
      resolvedUserCountAfterExpansion: userById.size,
    },
    "Principal expansion diagnostics",
  );

  // Build reverse lookup: display name -> template ID for fallback matching
  const displayNameToTemplateId = new Map<string, string>();
  Object.entries(CURATED_ADMIN_ROLE_TEMPLATE_IDS).forEach(([templateId, displayName]) => {
    displayNameToTemplateId.set(displayName.toLowerCase(), templateId);
  });

  // Track which role definition IDs are referenced in assignments/eligibility
  const referencedRoleDefinitionIds = new Set<string>();
  for (const item of roleAssignmentsResult.items) {
    if (item.roleDefinitionId) referencedRoleDefinitionIds.add(item.roleDefinitionId);
  }
  for (const item of roleEligibilityResult.items) {
    if (item.roleDefinitionId) referencedRoleDefinitionIds.add(item.roleDefinitionId);
  }

  logger.debug(
    { referencedRoleDefinitionIds: referencedRoleDefinitionIds.size },
    "Role definition IDs referenced in assignments",
  );

  const roleDefinitionById = new Map<string, { templateId: string; displayName: string }>();
  for (const roleDef of roleDefinitionsResult.items) {
    if (!roleDef.id || !referencedRoleDefinitionIds.has(roleDef.id)) continue;

    let templateId = roleDef.templateId ?? roleDef.roleTemplateId;
    let displayName = roleDef.displayName ?? "";

    // If templateId is missing, try to match by displayName
    if (!templateId && displayName) {
      templateId = displayNameToTemplateId.get(displayName.toLowerCase());
    }

    // Include this role if it's in our curated list OR if it appears to be an admin role
    const isInCuratedList = templateId && templateId in CURATED_ADMIN_ROLE_TEMPLATE_IDS;
    const appearsAdminRelated =
      displayName.toLowerCase().includes("admin") || displayName.toLowerCase().includes("administrator");

    if (isInCuratedList || appearsAdminRelated) {
      roleDefinitionById.set(roleDef.id, {
        templateId: templateId || roleDef.id,
        displayName: CURATED_ADMIN_ROLE_TEMPLATE_IDS[templateId as string] ?? displayName,
      });
    }
  }

  logger.debug(
    {
      totalRoleDefinitions: roleDefinitionsResult.items.length,
      referencedRoleDefinitions: referencedRoleDefinitionIds.size,
      includedAdminRoleDefinitions: roleDefinitionById.size,
    },
    "Role definitions processed with inclusive matching",
  );

  const aggregated = aggregateAdminExposure(
    roleAssignmentsResult.items,
    roleEligibilityResult.items,
    roleDefinitionById,
    userById,
    groupMemberUserIdsByGroupId,
  );

  logger.debug(aggregated, "Admin exposure data aggregated");

  // PIM depth metrics — derived from already-fetched role assignment data
  const activePrincipalIds = new Set(
    roleAssignmentsResult.items.map((r: RoleAssignmentItem) => r.principalId).filter(Boolean),
  );
  const eligiblePrincipalIds = new Set(
    roleEligibilityResult.items.map((r: RoleAssignmentItem) => r.principalId).filter(Boolean),
  );
  // Dormant = has eligible assignment but has never activated (no permanent/active assignment)
  const dormantEligibleCount = Array.from(eligiblePrincipalIds).filter(
    (id) => !activePrincipalIds.has(id),
  ).length;

  return {
    ...aggregated,

    eligibleAssignmentCount: roleEligibilityResult.items.length,
    dormantEligibleCount,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}

router.get("/m365/users/admin-exposure", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-users-admin-exposure", getAdminExposureData);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 administrator exposure");
    res.status(500).json({ error: "Failed to fetch M365 administrator exposure" });
  }
});

export default router;
