import { entityOutcomesOrPass, type RuleDefinition, type RuleOutcome } from "./helpers.js";
import { cis, ce } from "../frameworks/catalogue.js";

/** Minimal shape of the m365-apps snapshot consumed by these rules. */
interface AppsSlice {
  usersCanRegisterApps?: boolean;
  apps?: Array<{
    id?: string;
    displayName?: string;
    owners?: Array<unknown>;
    hasExpiredCredentials?: boolean;
    hasLongLivedSecrets?: boolean;
    hasHighRiskPermissions?: boolean;
    highRiskScopes?: string[];
    signInAudience?: string;
  }>;
}

/** Minimal shape of the m365-service-principals snapshot consumed by these rules. */
interface ServicePrincipalsSlice {
  servicePrincipals?: Array<{
    id?: string;
    displayName?: string;
    isFirstParty?: boolean;
    isAdminConsented?: boolean;
    hasHighRiskGrants?: boolean;
  }>;
}

/** Composite snapshot assembled by the engine for the applications domain. */
export interface AppsData {
  apps: AppsSlice | null;
  servicePrincipals: ServicePrincipalsSlice | null;
}

function appLabel(a: { displayName?: string; id?: string }): string {
  return a.displayName || a.id || "unknown app";
}

export const appsRules: RuleDefinition<AppsData>[] = [
  {
    ruleId: "apps.expiredCredentials",
    category: "apps",
    title: "App registration has expired credentials",
    description: "An application still has expired secrets or certificates present",
    severity: "medium",
    metricId: "apps.finding.expiredCredentials",
    remediation: "Remove expired secrets/certificates and rotate to current credentials.",
    frameworks: [cis("1.4.1"), ce("SC")],
    evaluate: (d) => {
      if (!d?.apps?.apps) return null;
      const offenders: RuleOutcome[] = d.apps.apps
        .filter((a) => a.hasExpiredCredentials)
        .map((a) => ({ target: a.id ?? appLabel(a), targetLabel: appLabel(a), checkStatus: "warning", detail: "expired credential present" }));
      return entityOutcomesOrPass(offenders, "No apps with expired credentials");
    },
  },
  {
    ruleId: "apps.longLivedSecrets",
    category: "apps",
    title: "App registration uses long-lived secrets",
    description: "An application has client secrets valid for more than 12 months",
    severity: "low",
    metricId: "apps.finding.longLivedSecrets",
    remediation: "Shorten secret lifetimes and prefer certificate or federated credentials.",
    frameworks: [cis("1.4.1"), ce("SC")],
    evaluate: (d) => {
      if (!d?.apps?.apps) return null;
      const offenders: RuleOutcome[] = d.apps.apps
        .filter((a) => a.hasLongLivedSecrets)
        .map((a) => ({ target: a.id ?? appLabel(a), targetLabel: appLabel(a), checkStatus: "warning", detail: "secret lifetime > 12 months" }));
      return entityOutcomesOrPass(offenders, "No apps with long-lived secrets");
    },
  },
  {
    ruleId: "apps.ownerlessApps",
    category: "apps",
    title: "App registration has no owner",
    description: "An application registration has no assigned owner",
    severity: "medium",
    metricId: "apps.finding.ownerlessApps",
    remediation: "Assign an accountable owner to every app registration or decommission unused apps.",
    frameworks: [cis("1.4.1"), ce("SC")],
    evaluate: (d) => {
      if (!d?.apps?.apps) return null;
      const offenders: RuleOutcome[] = d.apps.apps
        .filter((a) => (a.owners?.length ?? 0) === 0)
        .map((a) => ({ target: a.id ?? appLabel(a), targetLabel: appLabel(a), checkStatus: "warning", detail: "no owner assigned" }));
      return entityOutcomesOrPass(offenders, "All app registrations have owners");
    },
  },
  {
    ruleId: "apps.highRiskPermissions",
    category: "apps",
    title: "App registration requests high-risk permissions",
    description: "An application requests high-privilege Graph/API permissions",
    severity: "high",
    metricId: "apps.finding.highRiskPermissions",
    remediation: "Review high-privilege permission grants against least-privilege and remove if unjustified.",
    frameworks: [cis("5.1.5.1"), ce("SC")],
    evaluate: (d) => {
      if (!d?.apps?.apps) return null;
      const offenders: RuleOutcome[] = d.apps.apps
        .filter((a) => a.hasHighRiskPermissions)
        .map((a) => ({
          target: a.id ?? appLabel(a),
          targetLabel: appLabel(a),
          checkStatus: "fail",
          detail: (a.highRiskScopes ?? []).slice(0, 3).join(", ") || "high-risk permissions",
          evidence: a.highRiskScopes,
        }));
      return entityOutcomesOrPass(offenders, "No apps request high-risk permissions");
    },
  },
  {
    ruleId: "apps.userAppRegistration",
    category: "apps",
    title: "User app registration is restricted",
    description: "Standard users should not be able to register applications",
    severity: "medium",
    metricId: "apps.finding.userAppRegistration",
    remediation: "Set the user-role default to disallow app registration in the authorization policy.",
    frameworks: [cis("5.1.5.1"), ce("SC")],
    evaluate: (d) => {
      if (!d?.apps || d.apps.usersCanRegisterApps === undefined) return null;
      const allowed = d.apps.usersCanRegisterApps;
      return [{ checkStatus: allowed ? "fail" : "pass", detail: allowed ? "Any user can register apps" : "Restricted to administrators" }];
    },
  },
  {
    ruleId: "apps.thirdPartyHighRiskConsent",
    category: "apps",
    title: "Third-party app has high-risk tenant consent",
    description: "A third-party enterprise application holds high-risk, admin-consented permissions",
    severity: "high",
    metricId: "apps.finding.thirdPartyHighRiskConsent",
    remediation: "Review tenant-wide consent for third-party apps; revoke high-risk grants that are not required.",
    frameworks: [cis("5.1.5.1"), ce("SC")],
    evaluate: (d) => {
      if (!d?.servicePrincipals?.servicePrincipals) return null;
      const offenders: RuleOutcome[] = d.servicePrincipals.servicePrincipals
        .filter((sp) => sp.isFirstParty === false && sp.hasHighRiskGrants)
        .map((sp) => ({
          target: sp.id ?? sp.displayName ?? "unknown",
          targetLabel: sp.displayName ?? sp.id ?? "unknown",
          checkStatus: "fail",
          detail: sp.isAdminConsented ? "admin-consented, high-risk grants" : "high-risk grants",
        }));
      return entityOutcomesOrPass(offenders, "No third-party apps with high-risk consent");
    },
  },
];
