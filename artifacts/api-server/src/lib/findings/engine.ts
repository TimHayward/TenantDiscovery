import { getLatest } from "../metricStore.js";
import { runRule } from "./rules/helpers.js";
import { securityRules, type SecurityData } from "./rules/security.js";
import { complianceRules, type ComplianceData } from "./rules/compliance.js";
import { identityRules, type IdentityData } from "./rules/identity.js";
import { appsRules, type AppsData } from "./rules/apps.js";
import { devicesRules, type DevicesData } from "./rules/devices.js";
import { emailRules, type EmailData } from "./rules/email.js";
import { collaborationRules, type CollaborationData } from "./rules/collaboration.js";
import { licensingRules, type LicensingData } from "./rules/licensing.js";
import type { Finding } from "./types.js";

/**
 * Every rule registered with the engine, flattened across domains. Exists so
 * tests can enumerate registered rule ids and fail when a rule module is added
 * but not wired into `evaluateFindings`.
 */
export const registeredRules: ReadonlyArray<{ ruleId: string; category: string }> = [
  ...securityRules,
  ...complianceRules,
  ...identityRules,
  ...appsRules,
  ...devicesRules,
  ...emailRules,
  ...collaborationRules,
  ...licensingRules,
].map((r) => ({ ruleId: r.ruleId, category: r.category }));

/**
 * Evaluate all registered rules against the latest collected metric snapshots and
 * return the consolidated findings. Each domain pulls its own snapshot(s); composite
 * domains (identity, apps, collaboration, licensing) assemble several snapshots into
 * a single data object passed to their rules.
 */
export async function evaluateFindings(): Promise<Finding[]> {
  const [
    securityData,
    complianceData,
    usersData,
    adminData,
    appsData,
    servicePrincipalsData,
    intuneData,
    exchangeData,
    sharePointPoliciesData,
    sharePointSharingData,
    teamsData,
    licensesData,
  ] = await Promise.all([
    getLatest<SecurityData>("m365-security"),
    getLatest<ComplianceData>("m365-compliance"),
    // The users snapshot feeds both identity and licensing rules, each of which
    // declares its own minimal slice — fetch as the intersection of the two.
    getLatest<NonNullable<IdentityData["users"]> & NonNullable<LicensingData["users"]>>("m365-users"),
    getLatest<IdentityData["admin"]>("m365-users-admin-exposure"),
    getLatest<AppsData["apps"]>("m365-apps"),
    getLatest<AppsData["servicePrincipals"]>("m365-service-principals"),
    getLatest<DevicesData>("m365-intune"),
    getLatest<EmailData>("m365-exchange"),
    getLatest<CollaborationData["policies"]>("m365-sharepoint-policies"),
    getLatest<CollaborationData["sharing"]>("m365-sharepoint-sharing"),
    getLatest<CollaborationData["teams"]>("m365-teams"),
    getLatest<LicensingData["licenses"]>("m365-licenses"),
  ]);

  const identity: IdentityData = {
    users: usersData ?? null,
    admin: adminData ?? null,
  };
  const apps: AppsData = {
    apps: appsData ?? null,
    servicePrincipals: servicePrincipalsData ?? null,
  };
  const collaboration: CollaborationData = {
    policies: sharePointPoliciesData ?? null,
    sharing: sharePointSharingData ?? null,
    teams: teamsData ?? null,
  };
  const licensing: LicensingData = {
    licenses: licensesData ?? null,
    users: usersData ?? null,
  };

  const findings: Finding[] = [];

  for (const rule of securityRules) findings.push(...runRule(rule, securityData));
  for (const rule of complianceRules) findings.push(...runRule(rule, complianceData));
  for (const rule of identityRules) findings.push(...runRule(rule, identity));
  for (const rule of appsRules) findings.push(...runRule(rule, apps));
  for (const rule of devicesRules) findings.push(...runRule(rule, intuneData));
  for (const rule of emailRules) findings.push(...runRule(rule, exchangeData));
  for (const rule of collaborationRules) findings.push(...runRule(rule, collaboration));
  for (const rule of licensingRules) findings.push(...runRule(rule, licensing));

  return findings;
}
