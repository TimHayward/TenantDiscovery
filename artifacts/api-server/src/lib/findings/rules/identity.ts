import { entityOutcomesOrPass, daysSince, type RuleDefinition, type RuleOutcome } from "./helpers.js";
import { cis, ce } from "../frameworks/catalogue.js";

const STALE_DAYS = 90;

/** Minimal shape of the m365-users snapshot consumed by these rules. */
interface UsersSlice {
  users?: Array<{
    id?: string;
    displayName?: string;
    userPrincipalName?: string;
    accountEnabled?: boolean;
    userType?: string;
    lastSignIn?: string | null;
    assignedLicenses?: number;
  }>;
  ghostUsers?: Array<{
    id?: string;
    displayName?: string;
    userPrincipalName?: string;
    daysInactive?: number | null;
    assignedLicenseCount?: number;
    estimatedMonthlyCost?: number;
  }>;
}

/** Minimal shape of the m365-users-admin-exposure snapshot consumed by these rules. */
interface AdminSlice {
  permanentGlobalAdminsCount?: number;
  permanentAdminsWithProductivityCount?: number;
  permanentAdminsWithProductivity?: Array<{ displayName?: string; userPrincipalName?: string }>;
}

/** Composite snapshot assembled by the engine for the identity domain. */
export interface IdentityData {
  users: UsersSlice | null;
  admin: AdminSlice | null;
}

function labelFor(u: { userPrincipalName?: string; displayName?: string; id?: string }): string {
  return u.userPrincipalName || u.displayName || u.id || "unknown";
}

export const identityRules: RuleDefinition<IdentityData>[] = [
  {
    ruleId: "identity.ghostLicensedAccounts",
    category: "identity",
    title: "Licensed account is inactive",
    description: "An enabled, licensed account has been inactive beyond the threshold",
    severity: "medium",
    metricId: "identity.finding.ghostLicensedAccounts",
    remediation: "Review inactive licensed accounts; reclaim or reassign the licence or disable the account.",
    frameworks: [cis("1.1.4"), ce("UAC")],
    evaluate: (d) => {
      if (!d?.users) return null;
      const offenders: RuleOutcome[] = (d.users.ghostUsers ?? []).map((g) => ({
        target: g.id ?? labelFor(g),
        targetLabel: labelFor(g),
        checkStatus: "warning",
        detail: `${g.daysInactive ?? "90+"} days inactive, ${g.assignedLicenseCount ?? 0} licence(s)${g.estimatedMonthlyCost ? `, ~£${g.estimatedMonthlyCost}/mo` : ""}`,
        evidence: g,
      }));
      return entityOutcomesOrPass(offenders, "No inactive licensed accounts");
    },
  },
  {
    ruleId: "identity.disabledLicensedUsers",
    category: "identity",
    title: "Disabled account still holds a licence",
    description: "A disabled account retains assigned licences",
    severity: "medium",
    metricId: "identity.finding.disabledLicensedUsers",
    remediation: "Remove licences from disabled accounts (mind retention/litigation holds) to reclaim spend.",
    frameworks: [cis("1.1.4"), ce("UAC")],
    evaluate: (d) => {
      if (!d?.users?.users) return null;
      const offenders: RuleOutcome[] = d.users.users
        .filter((u) => u.accountEnabled === false && (u.assignedLicenses ?? 0) > 0)
        .map((u) => ({
          target: u.id ?? labelFor(u),
          targetLabel: labelFor(u),
          checkStatus: "fail",
          detail: `disabled, ${u.assignedLicenses} licence(s)`,
          evidence: { id: u.id, assignedLicenses: u.assignedLicenses },
        }));
      return entityOutcomesOrPass(offenders, "No disabled accounts hold licences");
    },
  },
  {
    ruleId: "identity.staleMemberAccounts",
    category: "identity",
    title: "Member account is stale",
    description: `An enabled member account has not signed in for ${STALE_DAYS}+ days`,
    severity: "low",
    metricId: "identity.finding.staleMemberAccounts",
    remediation: "Review long-inactive member accounts for disablement or deprovisioning.",
    frameworks: [cis("1.1.4"), ce("UAC")],
    evaluate: (d) => {
      if (!d?.users?.users) return null;
      // Flag enabled member accounts with a stale last sign-in. Never-signed-in
      // accounts are excluded here (newly created accounts are too noisy).
      const offenders: RuleOutcome[] = d.users.users
        .filter((u) => u.accountEnabled !== false && (u.userType ?? "Member") !== "Guest")
        .map((u) => ({ u, days: daysSince(u.lastSignIn) }))
        .filter(({ days }) => days !== null && days >= STALE_DAYS)
        .map(({ u, days }) => ({
          target: u.id ?? labelFor(u),
          targetLabel: labelFor(u),
          checkStatus: "warning" as const,
          detail: `${days} days since last sign-in`,
          evidence: { id: u.id, lastSignIn: u.lastSignIn },
        }));
      return entityOutcomesOrPass(offenders, "No stale member accounts");
    },
  },
  {
    ruleId: "identity.inactiveGuestAccounts",
    category: "identity",
    title: "Guest account is stale",
    description: "An external guest account is inactive or has never signed in",
    severity: "medium",
    metricId: "identity.finding.inactiveGuestAccounts",
    remediation: "Run an access review and remove guests that are no longer required.",
    frameworks: [cis("1.3.3"), ce("UAC")],
    evaluate: (d) => {
      if (!d?.users?.users) return null;
      const offenders: RuleOutcome[] = d.users.users
        .filter((u) => (u.userType ?? "") === "Guest")
        .map((u) => ({ u, days: daysSince(u.lastSignIn) }))
        .filter(({ days }) => days === null || days >= STALE_DAYS)
        .map(({ u, days }) => ({
          target: u.id ?? labelFor(u),
          targetLabel: labelFor(u),
          checkStatus: "warning" as const,
          detail: days === null ? "never signed in" : `${days} days inactive`,
          evidence: { id: u.id, lastSignIn: u.lastSignIn },
        }));
      return entityOutcomesOrPass(offenders, "No stale guest accounts");
    },
  },
  {
    ruleId: "identity.globalAdminCount",
    category: "identity",
    title: "Global Administrator count is within recommended range",
    description: "Standing Global Administrator assignments should number between two and four",
    severity: "high",
    metricId: "identity.finding.globalAdminCount",
    remediation: "Keep two to four named Global Administrators; move the rest to least-privilege or PIM-eligible roles.",
    frameworks: [cis("1.1.3"), ce("UAC")],
    evaluate: (d) => {
      if (!d?.admin || d.admin.permanentGlobalAdminsCount === undefined) return null;
      const n = d.admin.permanentGlobalAdminsCount;
      const status = n >= 2 && n <= 4 ? "pass" : n > 4 ? "fail" : "warning";
      return [{ checkStatus: status, detail: `${n} standing Global Administrator(s)` }];
    },
  },
  {
    ruleId: "identity.adminAccountsLicensed",
    category: "identity",
    title: "Administrative accounts are separate from licensed users",
    description: "Privileged accounts should not carry productivity licences (use dedicated admin accounts)",
    severity: "medium",
    metricId: "identity.finding.adminAccountsLicensed",
    remediation: "Move day-to-day work off admin accounts; keep privileged accounts cloud-only and unlicensed.",
    frameworks: [cis("1.1.1"), ce("UAC")],
    evaluate: (d) => {
      if (!d?.admin || d.admin.permanentAdminsWithProductivityCount === undefined) return null;
      const n = d.admin.permanentAdminsWithProductivityCount;
      return [{
        checkStatus: n === 0 ? "pass" : "warning",
        detail: n === 0 ? "No licensed admin accounts" : `${n} admin account(s) with productivity licences`,
        evidence: d.admin.permanentAdminsWithProductivity,
      }];
    },
  },
];
