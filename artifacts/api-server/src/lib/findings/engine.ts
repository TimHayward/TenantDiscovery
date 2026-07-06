import { getLatest } from "../metricStore.js";
import { runRule } from "./rules/helpers.js";
import { securityRules } from "./rules/security.js";
import { complianceRules } from "./rules/compliance.js";
import { identityRules, type IdentityData } from "./rules/identity.js";
import { appsRules, type AppsData } from "./rules/apps.js";
import { devicesRules, type DevicesData } from "./rules/devices.js";
import { emailRules, type EmailData } from "./rules/email.js";
import { collaborationRules, type CollaborationData } from "./rules/collaboration.js";
import { licensingRules, type LicensingData } from "./rules/licensing.js";
import type { Finding } from "./types.js";

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
    getLatest<unknown>("m365-security"),
    getLatest<unknown>("m365-compliance"),
    getLatest<unknown>("m365-users"),
    getLatest<unknown>("m365-users-admin-exposure"),
    getLatest<unknown>("m365-apps"),
    getLatest<unknown>("m365-service-principals"),
    getLatest<unknown>("m365-intune"),
    getLatest<unknown>("m365-exchange"),
    getLatest<unknown>("m365-sharepoint-policies"),
    getLatest<unknown>("m365-sharepoint-sharing"),
    getLatest<unknown>("m365-teams"),
    getLatest<unknown>("m365-licenses"),
  ]);

  const identity: IdentityData = {
    users: (usersData as IdentityData["users"]) ?? null,
    admin: (adminData as IdentityData["admin"]) ?? null,
  };
  const apps: AppsData = {
    apps: (appsData as AppsData["apps"]) ?? null,
    servicePrincipals: (servicePrincipalsData as AppsData["servicePrincipals"]) ?? null,
  };
  const collaboration: CollaborationData = {
    policies: (sharePointPoliciesData as CollaborationData["policies"]) ?? null,
    sharing: (sharePointSharingData as CollaborationData["sharing"]) ?? null,
    teams: (teamsData as CollaborationData["teams"]) ?? null,
  };
  const licensing: LicensingData = {
    licenses: (licensesData as LicensingData["licenses"]) ?? null,
    users: (usersData as LicensingData["users"]) ?? null,
  };

  const findings: Finding[] = [];

  for (const rule of securityRules) findings.push(...runRule(rule, securityData as never));
  for (const rule of complianceRules) findings.push(...runRule(rule, complianceData as never));
  for (const rule of identityRules) findings.push(...runRule(rule, identity));
  for (const rule of appsRules) findings.push(...runRule(rule, apps));
  for (const rule of devicesRules) findings.push(...runRule(rule, intuneData as DevicesData | null));
  for (const rule of emailRules) findings.push(...runRule(rule, exchangeData as EmailData | null));
  for (const rule of collaborationRules) findings.push(...runRule(rule, collaboration));
  for (const rule of licensingRules) findings.push(...runRule(rule, licensing));

  return findings;
}
