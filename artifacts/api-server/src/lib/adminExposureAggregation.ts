const GLOBAL_ADMIN_ROLE_TEMPLATE_ID = "62e90394-69f5-4237-9190-012177145e10";

export interface AdminExposureUserItem {
  id: string;
  displayName: string;
  userPrincipalName: string;
  accountEnabled: boolean;
  roles: string[];
  hasProductivityLicense: boolean;
}

export interface RoleAssignmentItem {
  principalId?: string;
  roleDefinitionId?: string;
}

interface RoleAggregation {
  user: Omit<AdminExposureUserItem, "roles">;
  roles: Set<string>;
  hasGlobalAdmin: boolean;
}

function buildRoleMap(
  items: RoleAssignmentItem[],
  roleDefinitionById: Map<string, { templateId: string; displayName: string }>,
  userById: Map<string, Omit<AdminExposureUserItem, "roles">>,
  groupMemberUserIdsByGroupId: Map<string, Set<string>>,
): Map<string, RoleAggregation> {
  const map = new Map<string, RoleAggregation>();

  for (const item of items) {
    const principalId = item.principalId;
    const roleDefinitionId = item.roleDefinitionId;
    if (!principalId || !roleDefinitionId) continue;

    const roleDef = roleDefinitionById.get(roleDefinitionId);
    if (!roleDef) continue;

    const directUser = userById.get(principalId);
    const memberUserIds = groupMemberUserIdsByGroupId.get(principalId);
    const targetUserIds = directUser
      ? [principalId]
      : memberUserIds
        ? Array.from(memberUserIds)
        : [];

    for (const userId of targetUserIds) {
      const user = userById.get(userId);
      if (!user) continue;

      const existing = map.get(userId);
      if (!existing) {
        map.set(userId, {
          user,
          roles: new Set([roleDef.displayName]),
          hasGlobalAdmin: roleDef.templateId === GLOBAL_ADMIN_ROLE_TEMPLATE_ID,
        });
        continue;
      }

      existing.roles.add(roleDef.displayName);
      if (roleDef.templateId === GLOBAL_ADMIN_ROLE_TEMPLATE_ID) {
        existing.hasGlobalAdmin = true;
      }
    }
  }

  return map;
}

function serialiseUsers(
  map: Map<string, RoleAggregation>,
  options: { globalOnly?: boolean; productivityOnly?: boolean },
): AdminExposureUserItem[] {
  return Array.from(map.values())
    .filter((entry) => {
      if (options.globalOnly && !entry.hasGlobalAdmin) return false;
      if (options.productivityOnly && !entry.user.hasProductivityLicense) return false;
      return true;
    })
    .map((entry) => ({
      ...entry.user,
      roles: Array.from(entry.roles).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function aggregateAdminExposure(
  permanentRoleItems: RoleAssignmentItem[],
  eligibleRoleItems: RoleAssignmentItem[],
  roleDefinitionById: Map<string, { templateId: string; displayName: string }>,
  userById: Map<string, Omit<AdminExposureUserItem, "roles">>,
  groupMemberUserIdsByGroupId: Map<string, Set<string>>,
) {
  const permanentRoleMap = buildRoleMap(
    permanentRoleItems,
    roleDefinitionById,
    userById,
    groupMemberUserIdsByGroupId,
  );
  const eligibleRoleMap = buildRoleMap(
    eligibleRoleItems,
    roleDefinitionById,
    userById,
    groupMemberUserIdsByGroupId,
  );

  const permanentGlobalAdmins = serialiseUsers(permanentRoleMap, { globalOnly: true });
  const permanentGlobalAdminsWithProductivity = serialiseUsers(permanentRoleMap, {
    globalOnly: true,
    productivityOnly: true,
  });

  const permanentAdmins = serialiseUsers(permanentRoleMap, {});
  const permanentAdminsWithProductivity = serialiseUsers(permanentRoleMap, {
    productivityOnly: true,
  });

  const eligibleGlobalAdmins = serialiseUsers(eligibleRoleMap, { globalOnly: true });
  const eligibleGlobalAdminsWithProductivity = serialiseUsers(eligibleRoleMap, {
    globalOnly: true,
    productivityOnly: true,
  });

  const eligibleAdmins = serialiseUsers(eligibleRoleMap, {});
  const eligibleAdminsWithProductivity = serialiseUsers(eligibleRoleMap, {
    productivityOnly: true,
  });

  return {
    permanentGlobalAdminsCount: permanentGlobalAdmins.length,
    permanentGlobalAdminsWithProductivityCount: permanentGlobalAdminsWithProductivity.length,
    permanentAdminsCount: permanentAdmins.length,
    permanentAdminsWithProductivityCount: permanentAdminsWithProductivity.length,
    eligibleGlobalAdminsCount: eligibleGlobalAdmins.length,
    eligibleGlobalAdminsWithProductivityCount: eligibleGlobalAdminsWithProductivity.length,
    eligibleAdminsCount: eligibleAdmins.length,
    eligibleAdminsWithProductivityCount: eligibleAdminsWithProductivity.length,
    permanentGlobalAdmins,
    permanentGlobalAdminsWithProductivity,
    permanentAdmins,
    permanentAdminsWithProductivity,
    eligibleGlobalAdmins,
    eligibleGlobalAdminsWithProductivity,
    eligibleAdmins,
    eligibleAdminsWithProductivity,
  };
}
