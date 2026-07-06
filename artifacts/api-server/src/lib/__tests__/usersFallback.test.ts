import { describe, expect, it } from "vitest";
import {
  resolveLastSignIn,
  deriveMfaEnforcementSignalFromPolicies,
} from "../collectors/users";
import { isAdminDirectoryRole } from "../collectors/adminExposure";
import { aggregateAdminExposure, type RoleAssignmentItem } from "../adminExposureAggregation";

const GLOBAL_ADMIN_TEMPLATE = "62e90394-69f5-4237-9190-012177145e10";

describe("resolveLastSignIn", () => {
  const activity = new Map<string, string>([["ghost@x.com", "2026-01-01"]]);

  it("prefers authoritative Graph signInActivity when present", () => {
    const r = resolveLastSignIn(
      { lastSignInDateTime: "2026-06-01" },
      "ghost@x.com",
      activity,
    );
    expect(r).toEqual({ lastSignIn: "2026-06-01", source: "graph" });
  });

  it("falls back to non-interactive Graph sign-in before the usage report", () => {
    const r = resolveLastSignIn(
      { lastSignInDateTime: null, lastNonInteractiveSignInDateTime: "2026-05-01" },
      "ghost@x.com",
      activity,
    );
    expect(r).toEqual({ lastSignIn: "2026-05-01", source: "graph" });
  });

  it("uses the usage-report fallback (case-insensitive UPN) when Graph gives nothing", () => {
    const r = resolveLastSignIn(null, "Ghost@X.com", activity);
    expect(r).toEqual({ lastSignIn: "2026-01-01", source: "usageReportFallback" });
  });

  it("returns none when neither Graph nor the usage report has the user", () => {
    expect(resolveLastSignIn(null, "nobody@x.com", activity)).toEqual({
      lastSignIn: null,
      source: "none",
    });
    expect(resolveLastSignIn(undefined, undefined, activity)).toEqual({
      lastSignIn: null,
      source: "none",
    });
  });
});

describe("deriveMfaEnforcementSignalFromPolicies", () => {
  const base = { securityDefaultsFailed: false, caFailed: false };

  it("reports securityDefaults when enabled (takes precedence over CA)", () => {
    expect(
      deriveMfaEnforcementSignalFromPolicies({
        ...base,
        securityDefaultsEnabled: true,
        caPolicies: [],
      }),
    ).toBe("securityDefaults");
  });

  it("reports conditionalAccess for an enabled all-users/all-apps MFA policy", () => {
    const caPolicies = [
      {
        state: "enabled",
        grantControls: { builtInControls: ["mfa"] },
        conditions: {
          users: { includeUsers: ["All"] },
          applications: { includeApplications: ["All"] },
        },
      },
    ];
    expect(
      deriveMfaEnforcementSignalFromPolicies({
        ...base,
        securityDefaultsEnabled: false,
        caPolicies,
      }),
    ).toBe("conditionalAccess");
  });

  it("does not count report-only or narrowly-scoped policies as enforcement", () => {
    const caPolicies = [
      { state: "enabledForReportingButNotEnforced", grantControls: { builtInControls: ["mfa"] }, conditions: { users: { includeUsers: ["All"] }, applications: { includeApplications: ["All"] } } },
      { state: "enabled", grantControls: { builtInControls: ["mfa"] }, conditions: { users: { includeUsers: ["group-1"] }, applications: { includeApplications: ["All"] } } },
    ];
    expect(
      deriveMfaEnforcementSignalFromPolicies({ ...base, securityDefaultsEnabled: false, caPolicies }),
    ).toBe("none");
  });

  it("reports unknown only when both source calls failed", () => {
    expect(
      deriveMfaEnforcementSignalFromPolicies({
        securityDefaultsEnabled: false,
        securityDefaultsFailed: true,
        caPolicies: [],
        caFailed: true,
      }),
    ).toBe("unknown");
  });
});

describe("isAdminDirectoryRole", () => {
  it("matches curated template ids", () => {
    expect(isAdminDirectoryRole({ roleTemplateId: GLOBAL_ADMIN_TEMPLATE, displayName: "GA" })).toBe(true);
  });
  it("matches admin-sounding display names", () => {
    expect(isAdminDirectoryRole({ displayName: "Exchange Administrator" })).toBe(true);
  });
  it("ignores non-admin roles", () => {
    expect(isAdminDirectoryRole({ roleTemplateId: "not-a-template", displayName: "Guest Inviter" })).toBe(false);
  });
});

describe("directory-roles fallback aggregation", () => {
  it("produces the same permanent-admin counts from directoryRole-shaped assignments", () => {
    // Fallback builds {principalId: memberId, roleDefinitionId: directoryRoleId}
    // and a roleDefinitionById keyed by directoryRole id carrying the GA template.
    const roleDefinitionById = new Map([
      ["dirrole-ga", { templateId: GLOBAL_ADMIN_TEMPLATE, displayName: "Global Administrator" }],
      ["dirrole-exch", { templateId: "29232cdf-9323-42fd-ade2-1d097af3e4de", displayName: "Exchange Administrator" }],
    ]);
    const userById = new Map([
      ["u1", { id: "u1", displayName: "Admin One", userPrincipalName: "a1@x.com", accountEnabled: true, hasProductivityLicense: true }],
      ["u2", { id: "u2", displayName: "Admin Two", userPrincipalName: "a2@x.com", accountEnabled: true, hasProductivityLicense: false }],
    ]);
    const permanent: RoleAssignmentItem[] = [
      { principalId: "u1", roleDefinitionId: "dirrole-ga" },
      { principalId: "u2", roleDefinitionId: "dirrole-exch" },
    ];

    const agg = aggregateAdminExposure(permanent, [], roleDefinitionById, userById, new Map());

    expect(agg.permanentGlobalAdminsCount).toBe(1);
    expect(agg.permanentGlobalAdminsWithProductivityCount).toBe(1);
    expect(agg.permanentAdminsCount).toBe(2);
    // The eligible slice is empty in fallback mode (no PIM equivalent).
    expect(agg.eligibleAdminsCount).toBe(0);
  });
});
