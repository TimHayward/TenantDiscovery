import { describe, expect, it } from "vitest";
import { aggregateAdminExposure } from "../adminExposureAggregation";

describe("aggregateAdminExposure", () => {
  it("expands group-assigned Global Administrator role to member users", () => {
    const globalAdminTemplateId = "62e90394-69f5-4237-9190-012177145e10";

    const permanentRoleItems = [
      {
        principalId: "group-1",
        roleDefinitionId: "role-def-global-admin",
      },
    ];

    const eligibleRoleItems: Array<{ principalId?: string; roleDefinitionId?: string }> = [];

    const roleDefinitionById = new Map([
      [
        "role-def-global-admin",
        {
          templateId: globalAdminTemplateId,
          displayName: "Global Administrator",
        },
      ],
    ]);

    const userById = new Map([
      [
        "user-1",
        {
          id: "user-1",
          displayName: "Ada Admin",
          userPrincipalName: "ada@example.com",
          accountEnabled: true,
          hasProductivityLicense: true,
        },
      ],
    ]);

    const groupMemberUserIdsByGroupId = new Map([
      ["group-1", new Set(["user-1"])],
    ]);

    const result = aggregateAdminExposure(
      permanentRoleItems,
      eligibleRoleItems,
      roleDefinitionById,
      userById,
      groupMemberUserIdsByGroupId,
    );

    expect(result.permanentAdminsCount).toBe(1);
    expect(result.permanentGlobalAdminsCount).toBe(1);
    expect(result.permanentGlobalAdminsWithProductivityCount).toBe(1);

    expect(result.permanentAdmins[0]?.id).toBe("user-1");
    expect(result.permanentAdmins[0]?.roles).toEqual(["Global Administrator"]);
  });
});
