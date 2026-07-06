import { describe, expect, it } from "vitest";
import { runRule } from "../findings/rules/helpers";
import { identityRules, type IdentityData } from "../findings/rules/identity";
import { appsRules, type AppsData } from "../findings/rules/apps";
import { devicesRules, type DevicesData } from "../findings/rules/devices";
import { emailRules, type EmailData } from "../findings/rules/email";
import { collaborationRules, type CollaborationData } from "../findings/rules/collaboration";

function rule<T>(rules: { ruleId: string }[], id: string) {
  const r = rules.find((x) => x.ruleId === id);
  if (!r) throw new Error(`rule ${id} not found`);
  return r as unknown as Parameters<typeof runRule<T>>[0];
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
});

describe("devices rules", () => {
  it("maps compliance percentage to pass/warning/fail and manual when unavailable", () => {
    const evalPct = (d: DevicesData) => runRule(rule<DevicesData>(devicesRules, "devices.compliance"), d)[0].checkStatus;
    expect(evalPct({ totalDevices: 10, overallCompliancePercent: 95 })).toBe("pass");
    expect(evalPct({ totalDevices: 10, overallCompliancePercent: 75 })).toBe("warning");
    expect(evalPct({ totalDevices: 10, overallCompliancePercent: 40 })).toBe("fail");
    expect(evalPct({ totalDevices: 0 })).toBe("manual");
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
});

describe("collaboration rules", () => {
  it("warns when external sharing permits anonymous links", () => {
    const warn = runRule(rule<CollaborationData>(collaborationRules, "collaboration.externalSharing"), { policies: { sharingCapability: "ExternalUserAndGuestSharing" }, sharing: null, teams: null });
    expect(warn[0].checkStatus).toBe("warning");
    const ok = runRule(rule<CollaborationData>(collaborationRules, "collaboration.externalSharing"), { policies: { sharingCapability: "ExistingExternalUserSharingOnly" }, sharing: null, teams: null });
    expect(ok[0].checkStatus).toBe("pass");
  });
});
