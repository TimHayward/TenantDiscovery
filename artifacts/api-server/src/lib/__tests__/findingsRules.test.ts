import { describe, expect, it } from "vitest";
import { runRule } from "../findings/rules/helpers";
import { registeredRules } from "../findings/engine";
import { identityRules, type IdentityData } from "../findings/rules/identity";
import { appsRules, type AppsData } from "../findings/rules/apps";
import { devicesRules, type DevicesData } from "../findings/rules/devices";
import { emailRules, type EmailData } from "../findings/rules/email";
import { collaborationRules, type CollaborationData } from "../findings/rules/collaboration";
import { securityRules, type SecurityData } from "../findings/rules/security";
import { complianceRules, type ComplianceData } from "../findings/rules/compliance";
import { licensingRules, type LicensingData } from "../findings/rules/licensing";

/**
 * Every rule id this file has actually exercised. Recorded by `rule` and checked
 * against the engine's registry by the last test in the file, so a rule cannot be
 * added to a domain without a test coming with it.
 */
const testedRuleIds = new Set<string>();

function rule<T>(rules: { ruleId: string }[], id: string) {
  const r = rules.find((x) => x.ruleId === id);
  if (!r) throw new Error(`rule ${id} not found`);
  testedRuleIds.add(id);
  return r as unknown as Parameters<typeof runRule<T>>[0];
}

/** An ISO timestamp the given number of days in the past. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe("identity rules", () => {
  it("emits a per-entity finding for each ghost (inactive licensed) account and a pass when clean", () => {
    const data: IdentityData = {
      users: { ghostUsers: [{ id: "u1", userPrincipalName: "a@x.com", daysInactive: 120, assignedLicenseCount: 1 }] },
      admin: null,
    };
    const findings = runRule(rule<IdentityData>(identityRules, "identity.ghostLicensedAccounts"), data);
    expect(findings).toHaveLength(1);
    expect(findings[0].checkStatus).toBe("warning");
    expect(findings[0].fingerprint).toBe("identity.ghostLicensedAccounts:u1");

    const clean = runRule(rule<IdentityData>(identityRules, "identity.ghostLicensedAccounts"), { users: { ghostUsers: [] }, admin: null });
    expect(clean).toHaveLength(1);
    expect(clean[0].checkStatus).toBe("pass");
  });

  it("flags disabled accounts that still hold licences", () => {
    const data: IdentityData = {
      users: { users: [
        { id: "u1", accountEnabled: false, assignedLicenses: 2 },
        { id: "u2", accountEnabled: true, assignedLicenses: 1 },
        { id: "u3", accountEnabled: false, assignedLicenses: 0 },
      ] },
      admin: null,
    };
    const findings = runRule(rule<IdentityData>(identityRules, "identity.disabledLicensedUsers"), data);
    expect(findings).toHaveLength(1);
    expect(findings[0].fingerprint).toBe("identity.disabledLicensedUsers:u1");
    expect(findings[0].checkStatus).toBe("fail");
  });

  it("passes the global admin count rule only for 2-4 admins", () => {
    const evalCount = (n: number) =>
      runRule(rule<IdentityData>(identityRules, "identity.globalAdminCount"), { users: null, admin: { permanentGlobalAdminsCount: n } })[0].checkStatus;
    expect(evalCount(3)).toBe("pass");
    expect(evalCount(1)).toBe("warning");
    expect(evalCount(6)).toBe("fail");
  });

  it("returns no findings when the relevant snapshot is missing", () => {
    expect(runRule(rule<IdentityData>(identityRules, "identity.globalAdminCount"), { users: null, admin: null })).toHaveLength(0);
  });

  it("carries framework refs through to the finding", () => {
    const findings = runRule(rule<IdentityData>(identityRules, "identity.globalAdminCount"), { users: null, admin: { permanentGlobalAdminsCount: 3 } });
    expect(findings[0].frameworks).toEqual([
      { framework: "CIS-M365", controlId: "1.1.3" },
      { framework: "NCSC-CE", controlId: "UAC" },
    ]);
  });

  it("flags stale member accounts but not guests or never-signed-in members", () => {
    const data: IdentityData = {
      users: { users: [
        { id: "u1", accountEnabled: true, lastSignIn: daysAgo(200) },
        { id: "u2", accountEnabled: true, lastSignIn: daysAgo(10) },
        // Never signed in: excluded, because new accounts would dominate the list.
        { id: "u3", accountEnabled: true, lastSignIn: null },
        // Guests belong to the guest rule, not this one.
        { id: "u4", accountEnabled: true, userType: "Guest", lastSignIn: daysAgo(200) },
        { id: "u5", accountEnabled: false, lastSignIn: daysAgo(200) },
      ] },
      admin: null,
    };
    const findings = runRule(rule<IdentityData>(identityRules, "identity.staleMemberAccounts"), data);
    expect(findings.map((f) => f.fingerprint)).toEqual(["identity.staleMemberAccounts:u1"]);
    expect(findings[0].checkStatus).toBe("warning");
  });

  it("flags stale and never-signed-in guests, and passes when there are none", () => {
    const data: IdentityData = {
      users: { users: [
        { id: "g1", userType: "Guest", lastSignIn: daysAgo(200) },
        { id: "g2", userType: "Guest", lastSignIn: null },
        { id: "g3", userType: "Guest", lastSignIn: daysAgo(5) },
      ] },
      admin: null,
    };
    const findings = runRule(rule<IdentityData>(identityRules, "identity.inactiveGuestAccounts"), data);
    expect(findings.map((f) => f.fingerprint).sort()).toEqual([
      "identity.inactiveGuestAccounts:g1",
      "identity.inactiveGuestAccounts:g2",
    ]);
    // A guest that has never signed in reads differently from a lapsed one.
    expect(findings.find((f) => f.fingerprint.endsWith("g2"))!.description).toContain("never signed in");

    const clean = runRule(rule<IdentityData>(identityRules, "identity.inactiveGuestAccounts"), {
      users: { users: [{ id: "g3", userType: "Guest", lastSignIn: daysAgo(5) }] },
      admin: null,
    });
    expect(clean).toHaveLength(1);
    expect(clean[0].checkStatus).toBe("pass");
  });

  it("warns when privileged accounts carry productivity licences", () => {
    const admins = [{ userPrincipalName: "admin@x.com" }];
    const warn = runRule(rule<IdentityData>(identityRules, "identity.adminAccountsLicensed"), {
      users: null,
      admin: { permanentAdminsWithProductivityCount: 2, permanentAdminsWithProductivity: admins },
    });
    expect(warn[0].checkStatus).toBe("warning");
    expect(warn[0].evidence).toEqual(admins);

    const ok = runRule(rule<IdentityData>(identityRules, "identity.adminAccountsLicensed"), {
      users: null,
      admin: { permanentAdminsWithProductivityCount: 0 },
    });
    expect(ok[0].checkStatus).toBe("pass");
  });
});

describe("apps rules", () => {
  it("flags apps with expired credentials per entity", () => {
    const data: AppsData = {
      apps: { apps: [{ id: "a1", displayName: "App 1", hasExpiredCredentials: true }, { id: "a2", hasExpiredCredentials: false }] },
      servicePrincipals: null,
    };
    const findings = runRule(rule<AppsData>(appsRules, "apps.expiredCredentials"), data);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("App 1");
  });

  it("fails when any user can register apps", () => {
    const allowed = runRule(rule<AppsData>(appsRules, "apps.userAppRegistration"), { apps: { usersCanRegisterApps: true }, servicePrincipals: null });
    expect(allowed[0].checkStatus).toBe("fail");
    const restricted = runRule(rule<AppsData>(appsRules, "apps.userAppRegistration"), { apps: { usersCanRegisterApps: false }, servicePrincipals: null });
    expect(restricted[0].checkStatus).toBe("pass");
  });

  it("flags apps with secrets valid beyond twelve months", () => {
    const data: AppsData = {
      apps: { apps: [{ id: "a1", displayName: "App 1", hasLongLivedSecrets: true }, { id: "a2", hasLongLivedSecrets: false }] },
      servicePrincipals: null,
    };
    const findings = runRule(rule<AppsData>(appsRules, "apps.longLivedSecrets"), data);
    expect(findings.map((f) => f.fingerprint)).toEqual(["apps.longLivedSecrets:a1"]);
    expect(findings[0].checkStatus).toBe("warning");
  });

  it("treats an app with an empty owners list the same as one with no owners property", () => {
    const data: AppsData = {
      apps: { apps: [
        { id: "a1", displayName: "Ownerless" },
        { id: "a2", owners: [] },
        { id: "a3", owners: [{ id: "u1" }] },
      ] },
      servicePrincipals: null,
    };
    const findings = runRule(rule<AppsData>(appsRules, "apps.ownerlessApps"), data);
    expect(findings.map((f) => f.fingerprint).sort()).toEqual([
      "apps.ownerlessApps:a1",
      "apps.ownerlessApps:a2",
    ]);
  });

  it("lists the first three high-risk scopes and carries them all as evidence", () => {
    const scopes = ["Directory.ReadWrite.All", "Mail.ReadWrite", "Files.ReadWrite.All", "User.ReadWrite.All"];
    const data: AppsData = {
      apps: { apps: [{ id: "a1", displayName: "Risky", hasHighRiskPermissions: true, highRiskScopes: scopes }] },
      servicePrincipals: null,
    };
    const findings = runRule(rule<AppsData>(appsRules, "apps.highRiskPermissions"), data);
    expect(findings[0].checkStatus).toBe("fail");
    expect(findings[0].description).toContain("Directory.ReadWrite.All, Mail.ReadWrite, Files.ReadWrite.All");
    expect(findings[0].description).not.toContain("User.ReadWrite.All");
    expect(findings[0].evidence).toEqual(scopes);
  });

  it("flags only third-party service principals with high-risk grants", () => {
    const data: AppsData = {
      apps: null,
      servicePrincipals: { servicePrincipals: [
        { id: "sp1", displayName: "Third party", isFirstParty: false, isAdminConsented: true, hasHighRiskGrants: true },
        // Microsoft's own first-party apps are expected to hold broad grants.
        { id: "sp2", displayName: "Microsoft", isFirstParty: true, hasHighRiskGrants: true },
        { id: "sp3", displayName: "Benign", isFirstParty: false, hasHighRiskGrants: false },
      ] },
    };
    const findings = runRule(rule<AppsData>(appsRules, "apps.thirdPartyHighRiskConsent"), data);
    expect(findings.map((f) => f.fingerprint)).toEqual(["apps.thirdPartyHighRiskConsent:sp1"]);
    expect(findings[0].description).toContain("admin-consented");
  });
});

describe("devices rules", () => {
  it("maps compliance percentage to pass/warning/fail and manual when unavailable", () => {
    const evalPct = (d: DevicesData) => runRule(rule<DevicesData>(devicesRules, "devices.compliance"), d)[0].checkStatus;
    expect(evalPct({ totalDevices: 10, overallCompliancePercent: 95 })).toBe("pass");
    expect(evalPct({ totalDevices: 10, overallCompliancePercent: 75 })).toBe("warning");
    expect(evalPct({ totalDevices: 10, overallCompliancePercent: 40 })).toBe("fail");
    expect(evalPct({ totalDevices: 0 })).toBe("manual");
    // A permissions gap must not read as a compliance failure.
    expect(evalPct({ totalDevices: 10, overallCompliancePercent: 40, permissionRequired: true })).toBe("manual");
  });

  it("reports encryption only when the device list was actually collected", () => {
    const evalPct = (d: DevicesData) => runRule(rule<DevicesData>(devicesRules, "devices.encryption"), d)[0].checkStatus;
    expect(evalPct({ deviceListAvailable: true, encryptionPercent: 95 })).toBe("pass");
    expect(evalPct({ deviceListAvailable: true, encryptionPercent: 80 })).toBe("warning");
    expect(evalPct({ deviceListAvailable: true, encryptionPercent: 10 })).toBe("fail");
    expect(evalPct({ deviceListAvailable: false, encryptionPercent: 10 })).toBe("manual");
  });

  it("reports tamper protection against reporting devices only", () => {
    const evalTamper = (d: DevicesData) =>
      runRule(rule<DevicesData>(devicesRules, "devices.tamperProtection"), d)[0].checkStatus;
    expect(evalTamper({ tamperProtectionEnabledDevices: 95, tamperProtectionDisabledDevices: 5, tamperProtectionPercent: 95 })).toBe("pass");
    expect(evalTamper({ tamperProtectionEnabledDevices: 8, tamperProtectionDisabledDevices: 2, tamperProtectionPercent: 80 })).toBe("warning");
    expect(evalTamper({ tamperProtectionEnabledDevices: 1, tamperProtectionDisabledDevices: 9, tamperProtectionPercent: 10 })).toBe("fail");
    // Nothing reported: manual, rather than 0% and a false failure.
    expect(evalTamper({ tamperProtectionPercent: 0 })).toBe("manual");
  });

  it("fails on jailbroken devices and stays silent without a device list", () => {
    const flagged = runRule(rule<DevicesData>(devicesRules, "devices.jailbroken"), { deviceListAvailable: true, jailbrokenCount: 2 });
    expect(flagged[0].checkStatus).toBe("fail");
    expect(flagged[0].description).toContain("2 device(s) flagged");

    const clean = runRule(rule<DevicesData>(devicesRules, "devices.jailbroken"), { deviceListAvailable: true, jailbrokenCount: 0 });
    expect(clean[0].checkStatus).toBe("pass");

    expect(runRule(rule<DevicesData>(devicesRules, "devices.jailbroken"), { deviceListAvailable: false })).toHaveLength(0);
  });

  it("fails when no compliance policy is defined and is manual without the permission", () => {
    const evalPolicies = (d: DevicesData | null) =>
      runRule(rule<DevicesData>(devicesRules, "devices.compliancePolicies"), d)[0];
    expect(evalPolicies({ totalCompliancePolicies: 2 }).checkStatus).toBe("pass");
    expect(evalPolicies({ totalCompliancePolicies: 1 }).description).toContain("1 compliance policy");
    expect(evalPolicies({ totalCompliancePolicies: 0 }).checkStatus).toBe("fail");
    expect(evalPolicies({ permissionRequired: true }).checkStatus).toBe("manual");
    expect(evalPolicies(null).checkStatus).toBe("manual");
  });

  it("always reports the firewall control as a manual check", () => {
    // Nothing in the app-only Graph model evidences firewall configuration, so
    // the control is surfaced as manual rather than silently not assessed.
    const findings = runRule(rule<DevicesData>(devicesRules, "devices.firewall"), null);
    expect(findings).toHaveLength(1);
    expect(findings[0].checkStatus).toBe("manual");
    expect(findings[0].frameworks).toEqual([{ framework: "NCSC-CE", controlId: "FW" }]);
  });
});

describe("email rules", () => {
  it("emits one finding per domain for SPF", () => {
    const data: EmailData = {
      domainAuthRecords: [
        { domain: "a.com", hasSpf: true },
        { domain: "b.com", hasSpf: false },
      ],
    };
    const findings = runRule(rule<EmailData>(emailRules, "email.spf"), data);
    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.fingerprint.endsWith("b.com"))?.checkStatus).toBe("fail");
  });

  it("treats p=none DMARC as a warning and reject as pass", () => {
    const data: EmailData = {
      domainAuthRecords: [
        { domain: "a.com", hasDmarc: true, dmarcPolicy: "p=none" },
        { domain: "b.com", hasDmarc: true, dmarcPolicy: "p=reject" },
      ],
    };
    const findings = runRule(rule<EmailData>(emailRules, "email.dmarcEnforced"), data);
    expect(findings.find((f) => f.fingerprint.endsWith("a.com"))?.checkStatus).toBe("warning");
    expect(findings.find((f) => f.fingerprint.endsWith("b.com"))?.checkStatus).toBe("pass");
  });

  it("names the DKIM source when signing is configured", () => {
    const data: EmailData = {
      domainAuthRecords: [
        { domain: "a.com", hasDkim: true, dkimSource: "exchange" },
        { domain: "b.com", hasDkim: false },
      ],
    };
    const findings = runRule(rule<EmailData>(emailRules, "email.dkim"), data);
    expect(findings.find((f) => f.fingerprint.endsWith("a.com"))?.checkStatus).toBe("pass");
    expect(findings.find((f) => f.fingerprint.endsWith("a.com"))?.description).toContain("(exchange)");
    expect(findings.find((f) => f.fingerprint.endsWith("b.com"))?.checkStatus).toBe("fail");
  });

  it("reports DMARC presence separately from enforcement", () => {
    const data: EmailData = {
      domainAuthRecords: [
        { domain: "a.com", hasDmarc: true, dmarcPolicy: "p=none" },
        { domain: "b.com", hasDmarc: false },
      ],
    };
    const findings = runRule(rule<EmailData>(emailRules, "email.dmarc"), data);
    // Presence passes even at p=none; only the enforcement rule warns on it.
    expect(findings.find((f) => f.fingerprint.endsWith("a.com"))?.checkStatus).toBe("pass");
    expect(findings.find((f) => f.fingerprint.endsWith("b.com"))?.checkStatus).toBe("fail");
  });

  it("reports a manual check when the tenant has no verified email domains", () => {
    const findings = runRule(rule<EmailData>(emailRules, "email.spf"), { domainAuthRecords: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].checkStatus).toBe("manual");
    expect(findings[0].fingerprint).toBe("email.spf");
  });
});

describe("collaboration rules", () => {
  it("warns when external sharing permits anonymous links", () => {
    const warn = runRule(rule<CollaborationData>(collaborationRules, "collaboration.externalSharing"), { policies: { sharingCapability: "ExternalUserAndGuestSharing" }, sharing: null, teams: null });
    expect(warn[0].checkStatus).toBe("warning");
    const ok = runRule(rule<CollaborationData>(collaborationRules, "collaboration.externalSharing"), { policies: { sharingCapability: "ExistingExternalUserSharingOnly" }, sharing: null, teams: null });
    expect(ok[0].checkStatus).toBe("pass");
  });

  it("only asks for an anonymous link expiry when anonymous links are permitted", () => {
    const evalExpiry = (policies: CollaborationData["policies"]) =>
      runRule(rule<CollaborationData>(collaborationRules, "collaboration.anonymousLinkExpiry"), { policies, sharing: null, teams: null })[0];

    // Anonymous links not permitted, so there is nothing to expire.
    expect(evalExpiry({ sharingCapability: "ExistingExternalUserSharingOnly" }).checkStatus).toBe("pass");
    expect(evalExpiry({ sharingCapability: "ExternalUserAndGuestSharing", anyoneLinkExpirationInDays: 30 }).checkStatus).toBe("pass");
    expect(evalExpiry({ sharingCapability: "ExternalUserAndGuestSharing" }).checkStatus).toBe("warning");
    expect(evalExpiry({ sharingCapability: "ExternalUserAndGuestSharing", anyoneLinkExpirationInDays: 0 }).description).toContain("no expiry configured");
  });

  it("counts anonymous links found in the sampled sites", () => {
    const evalLinks = (sharing: CollaborationData["sharing"]) =>
      runRule(rule<CollaborationData>(collaborationRules, "collaboration.anonymousLinksPresent"), { policies: null, sharing, teams: null });

    expect(evalLinks({ sampledSites: 20, anonymousLinks: 0 })[0].checkStatus).toBe("pass");
    const warn = evalLinks({ sampledSites: 20, anonymousLinks: 4 });
    expect(warn[0].checkStatus).toBe("warning");
    expect(warn[0].description).toContain("4 anonymous link(s) in 20 sampled site(s)");
    // No sampling happened at all, so there is nothing to report either way.
    expect(evalLinks({ anonymousLinks: 4 })).toHaveLength(0);
  });

  it("keeps Teams guest governance as a manual check while the flags are unreliable", () => {
    const findings = runRule(rule<CollaborationData>(collaborationRules, "collaboration.teamsGuestGovernance"), {
      policies: null,
      sharing: null,
      teams: { totalTeams: 12, guestAccessEnabled: true },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].checkStatus).toBe("manual");
  });
});

describe("security rules", () => {
  it("bands the Secure Score at 70 and 50 per cent", () => {
    const evalScore = (d: SecurityData | null) =>
      runRule(rule<SecurityData>(securityRules, "security.checklist.6.1.secureScore"), d)[0].checkStatus;
    expect(evalScore({ secureScorePercent: 70 })).toBe("pass");
    expect(evalScore({ secureScorePercent: 69 })).toBe("warning");
    expect(evalScore({ secureScorePercent: 50 })).toBe("warning");
    expect(evalScore({ secureScorePercent: 49 })).toBe("fail");
    // An absent percentage reads as zero, not as "not assessed".
    expect(evalScore({})).toBe("fail");
    expect(runRule(rule<SecurityData>(securityRules, "security.checklist.6.1.secureScore"), null)).toHaveLength(0);
  });

  it("bands MFA coverage at 90 and 75 per cent and rates the gap critical", () => {
    const target = rule<SecurityData>(securityRules, "security.checklist.6.2.mfaCoverage");
    const evalMfa = (pct: number) => runRule(target, { mfaEnabledPercent: pct })[0];
    expect(evalMfa(90).checkStatus).toBe("pass");
    expect(evalMfa(89).checkStatus).toBe("warning");
    expect(evalMfa(75).checkStatus).toBe("warning");
    expect(evalMfa(74).checkStatus).toBe("fail");
    expect(evalMfa(74).severity).toBe("critical");
    expect(evalMfa(74).description).toContain("74% coverage");
    expect(evalMfa(90).frameworks).toEqual([
      { framework: "CIS-M365", controlId: "5.1.2" },
      { framework: "NCSC-CE", controlId: "UAC" },
    ]);
  });

  it("requires three enabled Conditional Access policies for a pass", () => {
    const evalCaps = (n: number) =>
      runRule(rule<SecurityData>(securityRules, "security.checklist.6.3.conditionalAccess"), { enabledCAPs: n })[0].checkStatus;
    expect(evalCaps(3)).toBe("pass");
    expect(evalCaps(1)).toBe("warning");
    expect(evalCaps(0)).toBe("fail");
  });

  it("emits one risky-user finding per user, with the severity taken from the risk level", () => {
    const data: SecurityData = {
      riskyUsersDetail: [
        { id: "u1", userPrincipalName: "high@x.com", riskLevel: "high", riskState: "atRisk" },
        { id: "u2", userPrincipalName: "medium@x.com", riskLevel: "medium" },
        { id: "u3", userPrincipalName: "low@x.com", riskLevel: "low" },
        { displayName: "No id", riskLevel: "high" },
      ],
    };
    const findings = runRule(rule<SecurityData>(securityRules, "security.checklist.6.4.riskyUsers"), data);
    expect(findings).toHaveLength(4);

    const high = findings.find((f) => f.fingerprint.endsWith(":u1"))!;
    expect(high.severity).toBe("high");
    expect(high.checkStatus).toBe("fail");
    expect(high.title).toContain("high@x.com");
    expect(high.description).toContain("risk high, atRisk");

    expect(findings.find((f) => f.fingerprint.endsWith(":u2"))!.severity).toBe("medium");
    // A low-risk user is a warning, not a failure.
    const low = findings.find((f) => f.fingerprint.endsWith(":u3"))!;
    expect(low.severity).toBe("low");
    expect(low.checkStatus).toBe("warning");
    // With no id, the label becomes the fingerprint target so it stays stable.
    expect(findings.some((f) => f.fingerprint === "security.checklist.6.4.riskyUsers:No id")).toBe(true);

    // No risky users at all means no findings, not a synthesised pass.
    expect(runRule(rule<SecurityData>(securityRules, "security.checklist.6.4.riskyUsers"), {})).toHaveLength(0);
  });

  it("reports risk-detection triage as a manual check", () => {
    const findings = runRule(rule<SecurityData>(securityRules, "security.checklist.6.5.riskDetectionResponse"), {});
    expect(findings).toHaveLength(1);
    expect(findings[0].checkStatus).toBe("manual");
  });

  it("never passes phishing-resistant MFA outright, since adoption is not evidenced", () => {
    const target = rule<SecurityData>(securityRules, "security.checklist.6.6.phishingResistantMfa");
    const registered = runRule(target, { mfaMethodsBreakdown: [{ strength: "Phishing-resistant", count: 12 }] });
    // Some registration is visible, but coverage of privileged users is not, so
    // the best outcome available is a warning.
    expect(registered[0].checkStatus).toBe("warning");
    expect(registered[0].description).toContain("12 users registered");

    expect(runRule(target, { mfaMethodsBreakdown: [{ strength: "Weak", count: 40 }] })[0].checkStatus).toBe("manual");
    // Unlike its neighbours, this rule still reports with no snapshot at all.
    expect(runRule(target, null)[0].checkStatus).toBe("manual");
  });

  it("reports legacy authentication blocking as a manual check", () => {
    const findings = runRule(rule<SecurityData>(securityRules, "security.checklist.6.7.legacyAuthBlocked"), {});
    expect(findings).toHaveLength(1);
    expect(findings[0].checkStatus).toBe("manual");
    expect(findings[0].frameworks).toEqual([
      { framework: "CIS-M365", controlId: "5.2.2" },
      { framework: "NCSC-CE", controlId: "UAC" },
    ]);
  });

  it("emits one backlog finding per not-configured Secure Score control", () => {
    const data: SecurityData = {
      secureScoreControls: [
        { status: "notConfigured", controlName: "ctl1", title: "Enable MFA", controlCategory: "Identity" },
        { status: "notConfigured", controlName: "ctl2" },
        { status: "completed", controlName: "ctl3", title: "Already done" },
      ],
    };
    const findings = runRule(rule<SecurityData>(securityRules, "security.checklist.6.8.controlBacklog"), data);
    expect(findings.map((f) => f.fingerprint).sort()).toEqual([
      "security.checklist.6.8.controlBacklog:ctl1",
      "security.checklist.6.8.controlBacklog:ctl2",
    ]);
    const first = findings.find((f) => f.fingerprint.endsWith(":ctl1"))!;
    expect(first.checkStatus).toBe("fail");
    expect(first.title).toContain("Enable MFA");
    expect(first.description).toContain("category Identity");
    expect(first.evidence).toEqual(data.secureScoreControls![0]);

    // Everything configured means no backlog, which is the absence of findings.
    expect(runRule(rule<SecurityData>(securityRules, "security.checklist.6.8.controlBacklog"), { secureScoreControls: [] })).toHaveLength(0);
  });

  it("reports incident-response runbook validation as a manual check", () => {
    const findings = runRule(rule<SecurityData>(securityRules, "security.checklist.6.9.incidentResponse"), {});
    expect(findings).toHaveLength(1);
    expect(findings[0].checkStatus).toBe("manual");
  });
});

describe("compliance rules", () => {
  it("reports backup and backup testing as manual checks", () => {
    for (const id of ["compliance.checklist.7.1.backup", "compliance.checklist.7.1.backupTest"]) {
      const findings = runRule(rule<ComplianceData>(complianceRules, id), {});
      expect(findings).toHaveLength(1);
      expect(findings[0].checkStatus).toBe("manual");
    }
  });

  it("passes audit logging only when both audit flags are set", () => {
    const evalAudit = (d: ComplianceData | null) =>
      runRule(rule<ComplianceData>(complianceRules, "compliance.checklist.7.2.auditLogging"), d);
    expect(evalAudit({ auditLogEnabled: true, unifiedAuditLogEnabled: true })[0].checkStatus).toBe("pass");
    // Either flag alone is not enough: the unified log is the one that matters.
    expect(evalAudit({ auditLogEnabled: true, unifiedAuditLogEnabled: false })[0].checkStatus).toBe("fail");
    expect(evalAudit({ auditLogEnabled: false, unifiedAuditLogEnabled: true })[0].checkStatus).toBe("fail");
    expect(evalAudit({})[0].checkStatus).toBe("fail");
    expect(evalAudit(null)).toHaveLength(0);
  });

  it("reports audit retention as a manual check", () => {
    const findings = runRule(rule<ComplianceData>(complianceRules, "compliance.checklist.7.2.auditRetention"), {});
    expect(findings[0].checkStatus).toBe("manual");
  });

  it("only judges retention labels when the count is actually API-backed", () => {
    const evalRetention = (d: ComplianceData) =>
      runRule(rule<ComplianceData>(complianceRules, "compliance.checklist.7.3.retentionPolicies"), d)[0];
    expect(evalRetention({ retentionEvidence: "apiBacked", retentionLabelCount: 4 }).checkStatus).toBe("pass");
    expect(evalRetention({ retentionEvidence: "apiBacked", retentionLabelCount: 0 }).checkStatus).toBe("fail");
    // The API was unavailable, so a zero count is unknown rather than a failure.
    expect(evalRetention({ retentionEvidence: "manual", retentionLabelCount: 0 }).checkStatus).toBe("manual");
    expect(evalRetention({ retentionEvidence: "apiBacked", retentionLabelCount: null }).checkStatus).toBe("manual");
    expect(evalRetention({}).checkStatus).toBe("manual");
  });

  it("fails when no sensitivity label is published", () => {
    const evalLabels = (d: ComplianceData) =>
      runRule(rule<ComplianceData>(complianceRules, "compliance.checklist.7.4.sensitivityLabels"), d)[0];
    expect(evalLabels({ sensitivityLabels: 3 }).checkStatus).toBe("pass");
    expect(evalLabels({ sensitivityLabels: 0 }).checkStatus).toBe("fail");
    expect(evalLabels({}).description).toContain("0 labels configured");
  });

  it("reports automatic labelling as a manual check", () => {
    const findings = runRule(rule<ComplianceData>(complianceRules, "compliance.checklist.7.4.autoLabeling"), {});
    expect(findings[0].checkStatus).toBe("manual");
    expect(findings[0].severity).toBe("low");
  });

  it("distinguishes no DLP policies from policies that exist but are inactive", () => {
    const evalDlp = (d: ComplianceData) =>
      runRule(rule<ComplianceData>(complianceRules, "compliance.checklist.7.5.dlpPolicies"), d)[0];
    expect(evalDlp({ dlpPolicies: 3, activeDlpPolicies: 2 }).checkStatus).toBe("pass");
    const inactive = evalDlp({ dlpPolicies: 3, activeDlpPolicies: 0 });
    expect(inactive.checkStatus).toBe("warning");
    expect(inactive.description).toContain("3 policies (none active)");
    const none = evalDlp({ dlpPolicies: 0 });
    expect(none.checkStatus).toBe("fail");
    expect(none.description).toContain("No DLP policies found");
  });

  it("reports DLP workload coverage as a manual check", () => {
    const findings = runRule(rule<ComplianceData>(complianceRules, "compliance.checklist.7.5.dlpCoverage"), {});
    expect(findings[0].checkStatus).toBe("manual");
  });
});

describe("licensing rules", () => {
  it("surfaces a SKU only when unused inventory is both large enough and a big enough share", () => {
    const data: LicensingData = {
      licenses: { licenses: [
        // 40 of 100 unassigned: over both thresholds.
        { skuId: "sku-waste", displayName: "Enterprise E5", total: 100, assigned: 60, available: 40 },
        // 30% unassigned but only 3 licences: below the minimum unit count, so
        // small SKUs do not generate noise.
        { skuId: "sku-small", skuPartNumber: "SMALL", total: 10, assigned: 7, available: 3 },
        // 10 unassigned but only 10% of the estate: below the ratio threshold.
        { skuId: "sku-large", displayName: "Big SKU", total: 100, assigned: 90, available: 10 },
        { skuId: "sku-full", displayName: "Fully used", total: 50, assigned: 50, available: 0 },
      ] },
      users: null,
    };
    const findings = runRule(rule<LicensingData>(licensingRules, "licensing.unusedInventory"), data);
    expect(findings.map((f) => f.fingerprint)).toEqual(["licensing.unusedInventory:sku-waste"]);
    expect(findings[0].checkStatus).toBe("warning");
    expect(findings[0].severity).toBe("low");
    expect(findings[0].title).toContain("Enterprise E5");
    expect(findings[0].description).toContain("40 of 100 unassigned");

    // Nothing worth reviewing still produces a pass, so the control is visible.
    const clean = runRule(rule<LicensingData>(licensingRules, "licensing.unusedInventory"), {
      licenses: { licenses: [{ skuId: "sku-full", total: 50, assigned: 50, available: 0 }] },
      users: null,
    });
    expect(clean).toHaveLength(1);
    expect(clean[0].checkStatus).toBe("pass");

    // No licences snapshot at all: silent rather than a spurious pass.
    expect(runRule(rule<LicensingData>(licensingRules, "licensing.unusedInventory"), { licenses: null, users: null })).toHaveLength(0);
  });

  it("reports inactive licence spend with the estimated monthly waste when known", () => {
    const target = rule<LicensingData>(licensingRules, "licensing.inactiveLicenceSpend");
    const waste = runRule(target, { licenses: null, users: { ghostLicensedCount: 12, estimatedMonthlyWaste: 348 } })[0];
    expect(waste.checkStatus).toBe("warning");
    expect(waste.description).toContain("12 inactive licensed account(s)");
    expect(waste.description).toContain("£348/mo");

    const clean = runRule(target, { licenses: null, users: { ghostLicensedCount: 0 } })[0];
    expect(clean.checkStatus).toBe("pass");
    expect(clean.description).toContain("No inactive licensed accounts");

    // A count of zero passes, but an absent count must stay silent rather than
    // reading as a clean bill of health.
    expect(runRule(target, { licenses: null, users: {} })).toHaveLength(0);
    expect(runRule(target, { licenses: null, users: null })).toHaveLength(0);
  });
});

/**
 * The point of this file. Everything above can drift out of date silently; this
 * cannot. It runs last, after every test above has recorded the ids it touched.
 */
describe("rule registration", () => {
  it("has a test for every rule registered with the engine", () => {
    const untested = registeredRules
      .map((r) => r.ruleId)
      .filter((id) => !testedRuleIds.has(id))
      .sort();
    expect(untested).toEqual([]);
  });

  it("tests no rule that the engine does not evaluate", () => {
    // Catches the opposite failure: a rule module written and tested, but never
    // wired into evaluateFindings, so it never reaches the register.
    const registered = new Set(registeredRules.map((r) => r.ruleId));
    const orphaned = [...testedRuleIds].filter((id) => !registered.has(id)).sort();
    expect(orphaned).toEqual([]);
  });

  it("registers every rule under a unique id", () => {
    const ids = registeredRules.map((r) => r.ruleId);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids.length).toBeGreaterThan(0);
  });
});
