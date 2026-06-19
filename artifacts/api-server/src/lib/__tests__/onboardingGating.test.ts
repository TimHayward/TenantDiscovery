import { describe, expect, it } from "vitest";
import { computeNeedsOnboarding } from "../../routes/onboarding";

const REQUIRED_COUNT = 14;

describe("computeNeedsOnboarding", () => {
  it("requires onboarding when no client is configured", () => {
    expect(
      computeNeedsOnboarding({
        hasClientId: false,
        setupComplete: false,
        permissionCheckSucceeded: false,
        missingPermissions: [],
        acknowledgedPermissions: [],
        requiredCount: REQUIRED_COUNT,
      }),
    ).toBe(true);
  });

  it("gates during initial setup when the check failed", () => {
    expect(
      computeNeedsOnboarding({
        hasClientId: true,
        setupComplete: false,
        permissionCheckSucceeded: false,
        missingPermissions: [],
        acknowledgedPermissions: [],
        requiredCount: REQUIRED_COUNT,
      }),
    ).toBe(true);
  });

  it("clears during initial setup when the check succeeded with no gaps", () => {
    expect(
      computeNeedsOnboarding({
        hasClientId: true,
        setupComplete: false,
        permissionCheckSucceeded: true,
        missingPermissions: [],
        acknowledgedPermissions: [],
        requiredCount: REQUIRED_COUNT,
      }),
    ).toBe(false);
  });

  it("does NOT bounce an established tenant when the check failed transiently", () => {
    expect(
      computeNeedsOnboarding({
        hasClientId: true,
        setupComplete: true,
        permissionCheckSucceeded: false,
        // polluted full-required list from the failed check
        missingPermissions: Array.from({ length: REQUIRED_COUNT }, (_, i) => `Perm.${i}`),
        acknowledgedPermissions: [],
        requiredCount: REQUIRED_COUNT,
      }),
    ).toBe(false);
  });

  it("gates an established tenant on a confirmed permission regression", () => {
    expect(
      computeNeedsOnboarding({
        hasClientId: true,
        setupComplete: true,
        permissionCheckSucceeded: true,
        missingPermissions: ["User.Read.All", "Group.Read.All"],
        acknowledgedPermissions: [],
        requiredCount: REQUIRED_COUNT,
      }),
    ).toBe(true);
  });

  it("clears for an established tenant when the check succeeded with no gaps", () => {
    expect(
      computeNeedsOnboarding({
        hasClientId: true,
        setupComplete: true,
        permissionCheckSucceeded: true,
        missingPermissions: [],
        acknowledgedPermissions: [],
        requiredCount: REQUIRED_COUNT,
      }),
    ).toBe(false);
  });

  it("suppresses onboarding once the missing permissions are acknowledged", () => {
    expect(
      computeNeedsOnboarding({
        hasClientId: true,
        setupComplete: true,
        permissionCheckSucceeded: true,
        missingPermissions: ["User.Read.All", "Group.Read.All"],
        acknowledgedPermissions: ["User.Read.All", "Group.Read.All"],
        requiredCount: REQUIRED_COUNT,
      }),
    ).toBe(false);
  });

  it("re-triggers onboarding when a newly-missing permission is not acknowledged", () => {
    expect(
      computeNeedsOnboarding({
        hasClientId: true,
        setupComplete: true,
        permissionCheckSucceeded: true,
        missingPermissions: ["User.Read.All", "Group.Read.All", "Reports.Read.All"],
        acknowledgedPermissions: ["User.Read.All", "Group.Read.All"],
        requiredCount: REQUIRED_COUNT,
      }),
    ).toBe(true);
  });

  it("always onboards when every required permission is missing, even if acknowledged", () => {
    const everyPermission = Array.from({ length: REQUIRED_COUNT }, (_, i) => `Perm.${i}`);
    expect(
      computeNeedsOnboarding({
        hasClientId: true,
        setupComplete: true,
        permissionCheckSucceeded: true,
        missingPermissions: everyPermission,
        acknowledgedPermissions: everyPermission,
        requiredCount: REQUIRED_COUNT,
      }),
    ).toBe(true);
  });
});
