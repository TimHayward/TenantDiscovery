/**
 * Builds the committed fixture profiles under `fixtures/`.
 *
 * Run with `node fixtures/build.mjs`. It is committed alongside its output so a
 * reviewer can see exactly how every value in the fixture tree was produced and
 * satisfy themselves that none of it came from a tenant. It has no
 * dependencies and is not part of any build; the JSON it writes is the artefact
 * the server reads.
 *
 * Rules the generator holds itself to:
 *   - every domain is under the RFC 2606 reserved `.example` TLD, so no address
 *     in this tree can resolve or receive mail;
 *   - every identifier is a readable `demo-...` string, never a GUID, so none of
 *     them can be mistaken for a real object id;
 *   - every display name carries a "(demo)" suffix, so a screenshot of any tab,
 *     and every row of a PDF or spreadsheet export, says so on its face;
 *   - the pseudo-random generator is seeded per profile, so re-running this
 *     produces a byte-identical tree and a re-run shows up as no diff.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 1;

/** Anchors every relative date in the fixtures so output stays deterministic. */
const NOW = Date.UTC(2026, 6, 1, 9, 0, 0);

/** Mulberry32. Deterministic, tiny, and good enough for shaping test data. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();
const round1 = (n) => Math.round(n * 10) / 10;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const FORENAMES = [
  "Alex", "Bela", "Cai", "Dara", "Emre", "Fern", "Gia", "Hal", "Idris", "Jo",
  "Kit", "Lior", "Mira", "Nils", "Oona", "Pax", "Quinn", "Ravi", "Sana", "Tam",
  "Umi", "Vito", "Wren", "Xan", "Yara", "Zev",
];

/**
 * Surnames are invented words rather than a name list, so no row in this tree
 * matches a person.
 */
const SURNAMES = [
  "Ashvale", "Brambleton", "Corrindale", "Dunmarch", "Ellwither", "Fenmoor",
  "Glasswick", "Harrowfen", "Inglemere", "Juniperry", "Kestrelby", "Larkmond",
  "Marlowend", "Netherby", "Oxhollow", "Pinebarrow", "Quillfen", "Ravenscot",
  "Sablewood", "Thornmere", "Underhay", "Vellacourt", "Wilderness", "Yewbank",
];

const DEPARTMENTS = [
  "Operations", "Finance", "Sales", "Engineering", "Customer Support",
  "People", "Marketing", "Facilities",
];

const JOB_TITLES = [
  "Coordinator", "Analyst", "Manager", "Technician", "Adviser",
  "Specialist", "Lead", "Administrator",
];

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

/**
 * Build the people for a profile.
 *
 * `mfaShare` is the fraction of enabled members registered for MFA, and
 * `staleShare` the fraction whose last sign-in is beyond the ninety-day
 * threshold the findings rules use. Both are what separate the two profiles.
 */
function buildPeople(profile) {
  const r = rng(profile.seed);
  const people = [];
  const used = new Set();

  for (let i = 0; i < profile.userCount; i++) {
    let forename;
    let surname;
    let upnLocal;
    do {
      forename = pick(r, FORENAMES);
      surname = pick(r, SURNAMES);
      upnLocal = `${slug(forename)}.${slug(surname)}`;
    } while (used.has(upnLocal));
    used.add(upnLocal);

    const isGuest = i >= profile.userCount - profile.guestCount;
    const enabled = isGuest || i < profile.userCount - profile.guestCount - profile.disabledCount;
    const staleDays = between(r, 91, 400);
    const freshDays = between(r, 0, 25);
    const stale = r() < profile.staleShare;
    const neverSignedIn = !isGuest && r() < profile.neverSignedInShare;

    people.push({
      id: `demo-user-${String(i + 1).padStart(4, "0")}`,
      displayName: `${forename} ${surname} (demo)`,
      userPrincipalName: isGuest
        ? `${upnLocal}_partner.example#EXT#@${profile.domain}`
        : `${upnLocal}@${profile.domain}`,
      accountEnabled: enabled,
      userType: isGuest ? "Guest" : "Member",
      mfaEnabled: enabled ? r() < profile.mfaShare : false,
      lastSignIn: neverSignedIn ? null : daysAgo(stale ? staleDays : freshDays),
      lastSignInSource: neverSignedIn ? "none" : "graph",
      assignedLicenses: isGuest ? 0 : enabled ? (r() < 0.92 ? 1 : 2) : r() < profile.disabledLicensedShare ? 1 : 0,
      department: isGuest ? null : pick(r, DEPARTMENTS),
      jobTitle: isGuest ? null : `${pick(r, DEPARTMENTS)} ${pick(r, JOB_TITLES)} (demo)`,
    });
  }
  return people;
}

function usersSnapshot(profile, people) {
  const r = rng(profile.seed + 11);
  const members = people.filter((u) => u.userType !== "Guest");
  const enabled = people.filter((u) => u.accountEnabled);
  const disabled = people.filter((u) => !u.accountEnabled);
  const guests = people.filter((u) => u.userType === "Guest");
  const mfaEnabled = people.filter((u) => u.mfaEnabled).length;

  const ghosts = people
    .filter((u) => u.accountEnabled && u.userType === "Member" && u.assignedLicenses > 0)
    .map((u) => ({ u, days: u.lastSignIn ? Math.floor((NOW - Date.parse(u.lastSignIn)) / 86_400_000) : null }))
    .filter(({ days }) => days === null || days >= 90)
    .map(({ u, days }) => ({
      id: u.id,
      displayName: u.displayName,
      userPrincipalName: u.userPrincipalName,
      lastSignIn: u.lastSignIn,
      daysInactive: days,
      assignedLicenseCount: u.assignedLicenses,
      estimatedMonthlyCost: round1(u.assignedLicenses * profile.seatCost),
    }));

  const byDepartment = new Map();
  for (const u of members) {
    if (!u.department) continue;
    byDepartment.set(u.department, (byDepartment.get(u.department) ?? 0) + 1);
  }

  return {
    totalUsers: people.length,
    activeUsers: enabled.filter((u) => u.userType !== "Guest").length,
    disabledUsers: disabled.length,
    guestUsers: guests.length,
    memberUsers: members.length,
    mfaEnabled,
    mfaDisabled: people.length - mfaEnabled,
    neverSignedIn: people.filter((u) => u.lastSignIn === null).length,
    usersByDepartment: [...byDepartment.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([department, count]) => ({ department, count })),
    users: people,
    ghostUsers: ghosts,
    ghostLicensedCount: ghosts.length,
    estimatedMonthlyWaste: round1(ghosts.reduce((sum, g) => sum + g.estimatedMonthlyCost, 0)),
    signInDataSource: "graphAuditLog",
    signInFallbackCount: between(r, 0, 3),
    mfaDataSource: "graph",
    mfaEnforcementSignal: profile.mfaEnforcementSignal,
  };
}

function overviewSnapshot(profile, users, licenses) {
  return {
    tenantName: profile.tenantName,
    tenantId: profile.tenantId,
    totalUsers: users.totalUsers,
    activeUsers: users.activeUsers,
    totalLicenses: licenses.totalLicenses,
    assignedLicenses: licenses.assignedLicenses,
    mfaEnabledPercent: pct(users.mfaEnabled, users.totalUsers),
    secureScore: profile.secureScore,
    secureScoreMax: profile.secureScoreMax,
    guestUsers: users.guestUsers,
    disabledUsers: users.disabledUsers,
    activeServices: profile.serviceCount - profile.servicesWithIssues,
    totalServices: profile.serviceCount,
    // The live collector carries these alongside the KPIs; the fixture does
    // too, so a route that reads them behaves the same either way.
    partialData: false,
    permissionError: false,
    collectionIssues: [],
  };
}

function licensesSnapshot(profile) {
  const licenses = profile.skus.map((sku) => ({
    skuId: `demo-sku-${slug(sku.part)}`,
    skuPartNumber: sku.part,
    displayName: `${sku.name} (demo)`,
    total: sku.total,
    assigned: sku.assigned,
    available: sku.total - sku.assigned,
    suspended: 0,
    warning: 0,
  }));
  const totalLicenses = licenses.reduce((n, l) => n + l.total, 0);
  const assignedLicenses = licenses.reduce((n, l) => n + l.assigned, 0);
  return {
    totalLicenses,
    assignedLicenses,
    availableLicenses: totalLicenses - assignedLicenses,
    utilizationPercent: pct(assignedLicenses, totalLicenses),
    licenses,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
  };
}

function securitySnapshot(profile, people) {
  const r = rng(profile.seed + 23);
  const mfaEnabled = people.filter((u) => u.mfaEnabled).length;
  const mfaPercent = pct(mfaEnabled, people.length);

  const mfaUsersList = people.slice(0, 40).map((u) => ({
    id: u.id,
    displayName: u.displayName,
    userPrincipalName: u.userPrincipalName,
    isMfaRegistered: u.mfaEnabled,
    isPasswordlessCapable: u.mfaEnabled && r() < profile.passwordlessShare,
    isSsprRegistered: u.mfaEnabled && r() < 0.8,
    methodsRegistered: u.mfaEnabled
      ? [pick(r, ["microsoftAuthenticatorPush", "softwareOneTimePasscode", "mobilePhone"])]
      : [],
    accountEnabled: u.accountEnabled,
    userType: u.userType,
  }));

  const phishingResistant = mfaUsersList.filter((u) => u.isPasswordlessCapable).length;
  const methodTotals = [
    { method: "fido2", displayName: "FIDO2 security key (demo)", strength: "Phishing-resistant", strengthLevel: 3, count: phishingResistant },
    { method: "microsoftAuthenticatorPush", displayName: "Authenticator push (demo)", strength: "Strong", strengthLevel: 2, count: Math.round(mfaEnabled * 0.6) },
    { method: "mobilePhone", displayName: "SMS (demo)", strength: "Weak", strengthLevel: 1, count: Math.round(mfaEnabled * 0.4) },
  ].map((m) => ({ ...m, percentOfUsers: pct(m.count, people.length) }));

  const riskyUsersDetail = people.slice(0, profile.riskyUserCount).map((u, i) => ({
    id: u.id,
    displayName: u.displayName,
    userPrincipalName: u.userPrincipalName,
    riskLevel: i === 0 ? "high" : i === 1 ? "medium" : "low",
    riskState: "atRisk",
    riskLastUpdatedDateTime: daysAgo(between(r, 1, 20)),
  }));

  const secureScoreControls = profile.secureScoreControls.map((c) => ({
    controlName: `demo-control-${slug(c.title)}`,
    title: `${c.title} (demo)`,
    controlCategory: c.category,
    description: `Synthetic Secure Score control for the ${profile.key} demonstration profile.`,
    score: c.status === "notConfigured" ? 0 : c.max,
    scoreInPercentage: c.status === "notConfigured" ? 0 : 100,
    implementationStatus: c.status === "notConfigured" ? "Not configured" : "Configured",
    lastSynced: daysAgo(1),
    status: c.status,
  }));

  return {
    secureScore: profile.secureScore,
    secureScoreMax: profile.secureScoreMax,
    secureScorePercent: pct(profile.secureScore, profile.secureScoreMax),
    mfaEnabledUsers: mfaEnabled,
    mfaDisabledUsers: people.length - mfaEnabled,
    mfaEnabledPercent: mfaPercent,
    conditionalAccessPolicies: profile.caPolicies.length,
    enabledCAPs: profile.caPolicies.filter((p) => p.state === "enabled").length,
    disabledCAPs: profile.caPolicies.filter((p) => p.state === "disabled").length,
    reportOnlyCAPs: profile.caPolicies.filter((p) => p.state === "enabledForReportingButNotEnforced").length,
    secureScoreHistory: Array.from({ length: 8 }, (_, i) => ({
      date: daysAgo((7 - i) * 7).slice(0, 10),
      score: Math.max(0, profile.secureScore - (7 - i) * profile.scoreTrendPerWeek),
      maxScore: profile.secureScoreMax,
    })),
    controlCategories: [
      { category: "Identity", score: Math.round(profile.secureScore * 0.45), maxScore: Math.round(profile.secureScoreMax * 0.4) },
      { category: "Data", score: Math.round(profile.secureScore * 0.2), maxScore: Math.round(profile.secureScoreMax * 0.25) },
      { category: "Device", score: Math.round(profile.secureScore * 0.2), maxScore: Math.round(profile.secureScoreMax * 0.2) },
      { category: "Apps", score: Math.round(profile.secureScore * 0.15), maxScore: Math.round(profile.secureScoreMax * 0.15) },
    ],
    caPolicies: profile.caPolicies.map((p, i) => ({
      id: `demo-ca-policy-${String(i + 1).padStart(2, "0")}`,
      displayName: `${p.name} (demo)`,
      state: p.state,
      targetUsers: p.targetUsers,
      targetApps: "All cloud apps",
      authStrength: p.authStrength,
      modifiedDateTime: daysAgo(between(r, 30, 400)),
    })),
    riskyUsers: riskyUsersDetail.length,
    adminsWithoutMfa: profile.adminsWithoutMfa,
    mfaUsersList,
    mfaMethodsBreakdown: methodTotals,
    riskDetectionTimeline: Array.from({ length: 14 }, (_, i) => {
      const high = i % 5 === 0 ? profile.riskTimelineHigh : 0;
      const medium = i % 3 === 0 ? 1 : 0;
      const low = i % 2 === 0 ? 2 : 1;
      return { date: daysAgo(13 - i).slice(0, 10), high, medium, low, total: high + medium + low };
    }),
    riskyUsersDetail,
    secureScoreControls,
    legacyAuthSignInCount: profile.legacyAuthSignInCount,
    legacyAuthBlockedByCA: profile.legacyAuthBlockedByCA,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
  };
}

function adminExposureSnapshot(profile, people) {
  const admins = people.slice(0, profile.adminRoster.length).map((u, i) => ({
    id: u.id,
    displayName: u.displayName,
    userPrincipalName: u.userPrincipalName,
    accountEnabled: true,
    roles: profile.adminRoster[i].roles,
    hasProductivityLicense: profile.adminRoster[i].licensed,
  }));

  const globals = admins.filter((a) => a.roles.includes("Global Administrator"));
  const licensedAdmins = admins.filter((a) => a.hasProductivityLicense);
  const licensedGlobals = globals.filter((a) => a.hasProductivityLicense);

  return {
    permanentGlobalAdminsCount: globals.length,
    permanentGlobalAdminsWithProductivityCount: licensedGlobals.length,
    permanentAdminsCount: admins.length,
    permanentAdminsWithProductivityCount: licensedAdmins.length,
    eligibleGlobalAdminsCount: profile.eligibleGlobalAdmins,
    eligibleGlobalAdminsWithProductivityCount: 0,
    eligibleAdminsCount: profile.eligibleAdmins,
    eligibleAdminsWithProductivityCount: 0,
    permanentGlobalAdmins: globals,
    permanentGlobalAdminsWithProductivity: licensedGlobals,
    permanentAdmins: admins,
    permanentAdminsWithProductivity: licensedAdmins,
    eligibleGlobalAdmins: [],
    eligibleGlobalAdminsWithProductivity: [],
    eligibleAdmins: [],
    eligibleAdminsWithProductivity: [],
    eligibleAssignmentCount: profile.eligibleAdmins,
    dormantEligibleCount: 0,
    roleDataSource: profile.roleDataSource,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
  };
}

function exchangeSnapshot(profile, people) {
  const r = rng(profile.seed + 31);
  const members = people.filter((u) => u.userType !== "Guest").length;
  const used = round1(members * profile.mailboxGbPerUser);
  const allocated = members * 50;

  return {
    totalMailboxes: members + profile.sharedMailboxes + profile.roomMailboxes,
    activeMailboxes: Math.round(members * 0.86),
    sharedMailboxes: profile.sharedMailboxes,
    roomMailboxes: profile.roomMailboxes,
    totalStorageUsedGB: used,
    totalStorageAllocatedGB: allocated,
    storageUtilizationPercent: pct(used, allocated),
    mailboxSizeDistribution: [
      { range: "0-1 GB", count: Math.round(members * 0.24) },
      { range: "1-5 GB", count: Math.round(members * 0.38) },
      { range: "5-25 GB", count: Math.round(members * 0.3) },
      { range: "25 GB+", count: Math.round(members * 0.08) },
    ],
    emailActivityLast30Days: {
      sent: members * between(r, 90, 140),
      received: members * between(r, 280, 420),
      read: members * between(r, 220, 350),
    },
    quarantinedMessages: between(r, 40, 900),
    malwareDetected: profile.malwareDetected,
    spamFiltered: between(r, 500, 9000),
    domainAuthRecords: profile.domains,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
    collectionNotes: [
      "Synthetic fixture: DNS was not queried. Every record below was invented.",
    ],
  };
}

function teamsSnapshot(profile) {
  const r = rng(profile.seed + 41);
  const teams = profile.teamNames.map((name, i) => ({
    teamId: `demo-team-${String(i + 1).padStart(3, "0")}`,
    teamName: `${name} (demo)`,
    lastActivityDate: daysAgo(between(r, 0, profile.teamStaleDays)),
    activeUsers: between(r, 2, Math.max(3, Math.round(profile.userCount / 12))),
    activeChannels: between(r, 1, 6),
    messages: between(r, 0, 900),
    urgentMessages: between(r, 0, 4),
    reactions: between(r, 0, 400),
    meetingsOrganized: between(r, 0, 40),
    guests: between(r, 0, 3),
  }));

  const total = teams.length;
  return {
    totalTeams: total,
    activeTeams: teams.filter((t) => t.messages > 0).length,
    privateTeams: Math.round(total * 0.6),
    publicTeams: total - Math.round(total * 0.6),
    archivedTeams: profile.archivedTeams,
    totalChannels: teams.reduce((n, t) => n + t.activeChannels, 0) + total,
    activeUsersLast30Days: Math.round(profile.userCount * profile.teamsAdoption),
    meetingsOrganizedLast30Days: teams.reduce((n, t) => n + t.meetingsOrganized, 0),
    callsLast30Days: between(r, 40, 900),
    messagesLast30Days: teams.reduce((n, t) => n + t.messages, 0),
    guestAccessEnabled: profile.guestAccessEnabled,
    externalAccessEnabled: profile.externalAccessEnabled,
    teamsBySize: [
      { range: "1-10", count: Math.round(total * 0.5), totalTeamSize: Math.round(total * 0.5) * 6, owners: Math.round(total * 0.5), members: Math.round(total * 0.5) * 5, guests: 0 },
      { range: "11-50", count: total - Math.round(total * 0.5), totalTeamSize: (total - Math.round(total * 0.5)) * 20, owners: total - Math.round(total * 0.5), members: (total - Math.round(total * 0.5)) * 18, guests: 1 },
    ],
    topTeams: teams,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
  };
}

function sharePointSnapshot(profile) {
  const r = rng(profile.seed + 53);
  const sites = profile.siteNames.map((name, i) => {
    const usedGB = round1(between(r, 1, 90) + r());
    return {
      name: `${name} (demo)`,
      url: `https://${profile.spHost}/sites/${slug(name)}`,
      storageUsedGB: usedGB,
      storageAllocatedGB: 100,
      lastActivityDate: daysAgo(between(r, 0, profile.siteStaleDays)),
      isActive: i % 4 !== 3,
      pageViews: between(r, 0, 4000),
      filesCount: between(r, 20, 9000),
      assignedTeamName: i % 3 === 0 ? `${profile.teamNames[i % profile.teamNames.length]} (demo)` : null,
    };
  });

  const usedGB = round1(sites.reduce((n, s) => n + s.storageUsedGB, 0));
  const allocatedGB = sites.length * 100;
  return {
    totalSites: sites.length,
    activeSites: sites.filter((s) => s.isActive).length,
    totalStorageUsedGB: usedGB,
    totalStorageAllocatedGB: allocatedGB,
    storageUtilizationPercent: pct(usedGB, allocatedGB),
    totalFiles: sites.reduce((n, s) => n + s.filesCount, 0),
    totalPageViews: sites.reduce((n, s) => n + s.pageViews, 0),
    oneDriveTotalStorageGB: profile.userCount * 100,
    oneDriveUsedStorageGB: round1(profile.userCount * profile.oneDriveGbPerUser),
    sites,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
  };
}

function sharePointSharingSnapshot(profile) {
  return {
    sampledSites: Math.min(10, profile.siteNames.length),
    totalSharingLinks: profile.sharingLinks.total,
    orgWideLinks: profile.sharingLinks.orgWide,
    anonymousLinks: profile.sharingLinks.anonymous,
    specificPeopleLinks:
      profile.sharingLinks.total - profile.sharingLinks.orgWide - profile.sharingLinks.anonymous,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
  };
}

function sharePointPoliciesSnapshot(profile) {
  return {
    sharingCapability: profile.sharingCapability,
    oneDriveSharingCapability: profile.sharingCapability,
    sharingDomainRestrictionMode: profile.sharingDomainRestrictionMode,
    sharingAllowedDomainCount: profile.sharingDomainRestrictionMode === "AllowList" ? 3 : 0,
    sharingBlockedDomainCount: 0,
    defaultSharingLinkType: profile.defaultSharingLinkType,
    defaultLinkPermission: "View",
    anyoneLinkExpirationInDays: profile.anyoneLinkExpirationInDays,
    policyPermissionError: false,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
  };
}

function complianceSnapshot(profile) {
  return {
    dlpPolicies: profile.dlpPolicies,
    activeDlpPolicies: profile.activeDlpPolicies,
    retentionPolicies: profile.retentionLabelCount,
    retentionLabelCount: profile.retentionLabelCount,
    retentionEvidence: "apiBacked",
    sensitivityLabels: profile.sensitivityLabels.length,
    dlpPolicyMatches: profile.dlpPolicyMatches,
    complianceScore: profile.complianceScore,
    complianceScoreMax: 100,
    auditLogEnabled: profile.auditLogEnabled,
    unifiedAuditLogEnabled: profile.auditLogEnabled,
    eDiscoveryCases: profile.eDiscoveryCases,
    sensitivityLabelsList: profile.sensitivityLabels.map((label, i) => ({
      id: `demo-label-${String(i + 1).padStart(2, "0")}`,
      name: `${label} (demo)`,
      description: `Synthetic sensitivity label for the ${profile.key} demonstration profile.`,
      tooltip: `${label} content (demo)`,
      color: ["#0f766e", "#b45309", "#b91c1c", "#1d4ed8"][i % 4],
      sensitivity: i,
      isActive: true,
      isAppliable: true,
      hasProtection: i > 0,
      contentFormats: ["file", "email"],
      parent: null,
    })),
    sensitivityLabelsPermissionRequired: false,
    collectionNotes: [
      "Synthetic fixture: eDiscovery and DLP counts were invented, not collected.",
    ],
  };
}

const SERVICES = [
  "Exchange Online", "Microsoft Teams", "SharePoint Online", "OneDrive for Business",
  "Microsoft Entra", "Microsoft Intune", "Microsoft Defender for Office 365",
  "Microsoft Purview", "Power BI", "Microsoft 365 apps",
];

function serviceHealthSnapshot(profile) {
  const services = SERVICES.slice(0, profile.serviceCount).map((service, i) => {
    const degraded = i < profile.servicesWithIssues;
    return {
      service: `${service} (demo)`,
      status: degraded ? "serviceDegradation" : "serviceOperational",
      classification: degraded ? "incident" : "advisory",
      hasActiveIssues: degraded,
      activeIncidents: degraded ? 1 : 0,
    };
  });
  return {
    overallStatus: profile.servicesWithIssues > 0 ? "serviceDegradation" : "serviceOperational",
    servicesHealthy: services.length - profile.servicesWithIssues,
    servicesWithIssues: profile.servicesWithIssues,
    totalServices: services.length,
    activeIncidents: profile.servicesWithIssues,
    activeAdvisories: profile.activeAdvisories,
    services,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
  };
}

function intuneSnapshot(profile, people) {
  const r = rng(profile.seed + 67);
  const owners = people.filter((u) => u.userType !== "Guest" && u.accountEnabled);
  const devices = Array.from({ length: profile.deviceCount }, (_, i) => {
    const owner = owners[i % owners.length];
    const os = pick(r, profile.deviceOs);
    const compliant = r() < profile.deviceComplianceShare;
    return {
      id: `demo-device-${String(i + 1).padStart(4, "0")}`,
      deviceName: `DEMO-${os.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(4, "0")}`,
      operatingSystem: os,
      osVersion: os === "Windows" ? pick(r, ["10.0.19045.4291", "10.0.22631.3593"]) : pick(r, ["17.4.1", "14.0.0"]),
      complianceState: compliant ? "compliant" : pick(r, ["noncompliant", "ingraceperiod"]),
      enrolledDateTime: daysAgo(between(r, 30, 900)),
      lastSyncDateTime: daysAgo(between(r, 0, profile.deviceStaleDays)),
      userDisplayName: owner.displayName,
      userPrincipalName: owner.userPrincipalName,
      manufacturer: `Demo Devices Ltd`,
      model: `Fixture ${pick(r, ["A1", "B2", "C3"])} (demo)`,
      deviceType: os === "Windows" ? "desktop" : "phone",
      managementAgent: "mdm",
      managementState: "managed",
      isEncrypted: r() < profile.deviceEncryptionShare,
      isSupervised: os !== "Windows",
      jailBroken: i < profile.jailbrokenCount ? "True" : "False",
    };
  });

  const compliant = devices.filter((d) => d.complianceState === "compliant").length;
  const encrypted = devices.filter((d) => d.isEncrypted).length;
  const tamperEnabled = Math.round(devices.length * profile.tamperProtectionShare);
  const tamperDisabled = devices.filter((d) => d.operatingSystem === "Windows").length - tamperEnabled;

  const byOs = new Map();
  for (const d of devices) byOs.set(d.operatingSystem, (byOs.get(d.operatingSystem) ?? 0) + 1);

  const policy = (kind, i, platform) => ({
    id: `demo-${kind}-${String(i + 1).padStart(2, "0")}`,
    displayName: `${platform} ${kind} baseline ${i + 1} (demo)`,
    description: `Synthetic ${kind} policy for the ${profile.key} demonstration profile.`,
    platform,
    assignedGroups: between(r, 0, 3),
    createdDateTime: daysAgo(between(r, 100, 800)),
    lastModifiedDateTime: daysAgo(between(r, 1, 99)),
  });

  const compliancePolicies = Array.from({ length: profile.compliancePolicies }, (_, i) =>
    policy("compliance", i, profile.deviceOs[i % profile.deviceOs.length]),
  );
  const configProfiles = Array.from({ length: profile.configProfiles }, (_, i) =>
    policy("configuration", i, profile.deviceOs[i % profile.deviceOs.length]),
  );
  const appProtection = Array.from({ length: profile.appProtectionPolicies }, (_, i) =>
    policy("app-protection", i, profile.deviceOs[i % profile.deviceOs.length]),
  );

  return {
    totalDevices: devices.length,
    overallCompliancePercent: pct(compliant, devices.length),
    compliantDevices: compliant,
    nonCompliantDevices: devices.length - compliant,
    totalCompliancePolicies: compliancePolicies.length,
    totalConfigProfiles: configProfiles.length,
    totalAppProtectionPolicies: appProtection.length,
    encryptedDevices: encrypted,
    encryptionPercent: pct(encrypted, devices.length),
    jailbrokenCount: profile.jailbrokenCount,
    permissionRequired: false,
    deviceListAvailable: true,
    enrolledByOS: [...byOs.entries()].map(([os, count]) => ({ os, count })),
    osVersionBreakdown: [...byOs.keys()].map((os) => ({
      os,
      versions: [...new Set(devices.filter((d) => d.operatingSystem === os).map((d) => d.osVersion))].map(
        (version) => ({
          version,
          count: devices.filter((d) => d.operatingSystem === os && d.osVersion === version).length,
        }),
      ),
    })),
    complianceByState: [...new Set(devices.map((d) => d.complianceState))].map((state) => ({
      state,
      count: devices.filter((d) => d.complianceState === state).length,
    })),
    complianceByOS: [...byOs.keys()].map((os) => {
      const forOs = devices.filter((d) => d.operatingSystem === os);
      const ok = forOs.filter((d) => d.complianceState === "compliant").length;
      return { os, compliant: ok, nonCompliant: forOs.length - ok, total: forOs.length, compliancePercent: pct(ok, forOs.length) };
    }),
    deviceList: devices,
    compliancePoliciesList: compliancePolicies,
    configProfilesList: configProfiles,
    enrollmentConfigsList: [
      {
        id: "demo-enrollment-01",
        displayName: "Default enrollment restrictions (demo)",
        type: "singlePlatformRestriction",
        priority: 0,
        createdDateTime: daysAgo(700),
        lastModifiedDateTime: daysAgo(40),
      },
    ],
    appProtectionList: appProtection,
    overallCompliance: {
      compliantDeviceCount: compliant,
      noncompliantDeviceCount: devices.length - compliant,
      remediatedDeviceCount: 0,
      notApplicableDeviceCount: 0,
      notAssignedDeviceCount: 0,
      gracePeriodCount: devices.filter((d) => d.complianceState === "ingraceperiod").length,
      configManagerCount: 0,
    },
    policySummaryByOS: [...byOs.keys()].map((os) => ({
      os,
      totalPolicies: compliancePolicies.filter((p) => p.platform === os).length,
      policyNames: compliancePolicies.filter((p) => p.platform === os).map((p) => p.displayName),
    })),
    assessmentItems: profile.intuneAssessment,
    tamperProtectionEnabledDevices: Math.max(0, tamperEnabled),
    tamperProtectionDisabledDevices: Math.max(0, tamperDisabled),
    tamperProtectionUnknownDevices: devices.length - Math.max(0, tamperEnabled) - Math.max(0, tamperDisabled),
    tamperProtectionPercent: pct(Math.max(0, tamperEnabled), Math.max(1, tamperEnabled + Math.max(0, tamperDisabled))),
  };
}

function intuneAppsSnapshot(profile) {
  const r = rng(profile.seed + 71);
  const apps = profile.managedApps.map((name, i) => {
    const platform = profile.deviceOs[i % profile.deviceOs.length];
    const installed = between(r, 5, profile.deviceCount);
    const failed = between(r, 0, profile.appInstallFailureCeiling);
    return {
      id: `demo-mobile-app-${String(i + 1).padStart(2, "0")}`,
      displayName: `${name} (demo)`,
      publisher: "Demo Software Ltd",
      platform,
      installed,
      failed,
      pending: between(r, 0, 4),
      notApplicable: between(r, 0, 6),
      notInstalled: Math.max(0, profile.deviceCount - installed - failed),
    };
  });

  const sum = (field) => apps.reduce((n, a) => n + a[field], 0);
  const platforms = [...new Set(apps.map((a) => a.platform))];

  const discovered = profile.discoveredApps.map((name, i) => ({
    id: `demo-discovered-app-${String(i + 1).padStart(2, "0")}`,
    displayName: `${name} (demo)`,
    version: `${between(r, 1, 9)}.${between(r, 0, 9)}.0`,
    deviceCount: between(r, 1, profile.deviceCount),
    platform: profile.deviceOs[i % profile.deviceOs.length],
    managed: i % 3 !== 0,
  }));

  return {
    installPermissionRequired: false,
    discoveryPermissionRequired: false,
    totalAssignedApps: apps.length,
    totalInstalled: sum("installed"),
    totalFailed: sum("failed"),
    totalPending: sum("pending"),
    totalNotApplicable: sum("notApplicable"),
    totalNotInstalled: sum("notInstalled"),
    installByPlatform: platforms.map((platform) => ({
      platform,
      installed: apps.filter((a) => a.platform === platform).reduce((n, a) => n + a.installed, 0),
      failed: apps.filter((a) => a.platform === platform).reduce((n, a) => n + a.failed, 0),
      pending: apps.filter((a) => a.platform === platform).reduce((n, a) => n + a.pending, 0),
      notApplicable: apps.filter((a) => a.platform === platform).reduce((n, a) => n + a.notApplicable, 0),
      notInstalled: apps.filter((a) => a.platform === platform).reduce((n, a) => n + a.notInstalled, 0),
    })),
    appInstallList: apps,
    totalDiscoveredApps: discovered.length,
    managedDiscoveredApps: discovered.filter((a) => a.managed).length,
    unmanagedDiscoveredApps: discovered.filter((a) => !a.managed).length,
    discoveredByPlatform: platforms.map((platform) => ({
      platform,
      managed: discovered.filter((a) => a.platform === platform && a.managed).length,
      unmanaged: discovered.filter((a) => a.platform === platform && !a.managed).length,
    })),
    discoveredAppList: discovered,
  };
}

const HIGH_RISK_SCOPES = ["Directory.ReadWrite.All", "Mail.ReadWrite", "Files.ReadWrite.All"];

function appsSnapshot(profile, people) {
  const r = rng(profile.seed + 83);
  const apps = profile.appRegistrations.map((spec, i) => {
    const credentials = spec.credentials.map((c, j) => ({
      keyId: `demo-key-${String(i + 1).padStart(2, "0")}-${j + 1}`,
      displayName: `${spec.name} ${c.type} (demo)`,
      startDateTime: daysAgo(c.startedDaysAgo),
      endDateTime: daysAgo(c.endsDaysAgo),
      type: c.type,
      hint: c.type === "secret" ? "dem" : null,
    }));
    const permissions = spec.highRisk
      ? [{ resourceAppId: "demo-resource-graph", resourceName: "Microsoft Graph (demo)", scopes: HIGH_RISK_SCOPES, type: "Role", isHighRisk: true }]
      : [{ resourceAppId: "demo-resource-graph", resourceName: "Microsoft Graph (demo)", scopes: ["User.Read"], type: "Scope", isHighRisk: false }];

    const owners = spec.ownerless
      ? []
      : [{ id: people[i % people.length].id, displayName: people[i % people.length].displayName, accountEnabled: true }];

    const riskFactors = [
      ...(spec.highRisk ? ["High-risk application permissions"] : []),
      ...(spec.ownerless ? ["No owner assigned"] : []),
      ...(credentials.some((c) => Date.parse(c.endDateTime) < NOW) ? ["Expired credential"] : []),
      ...(spec.longLivedSecret ? ["Secret lifetime longer than 12 months"] : []),
    ];
    const riskScore = Math.min(100, riskFactors.length * 30);

    return {
      id: `demo-app-${String(i + 1).padStart(3, "0")}`,
      appId: `demo-appid-${String(i + 1).padStart(3, "0")}`,
      displayName: `${spec.name} (demo)`,
      createdDateTime: daysAgo(between(r, 200, 1600)),
      signInAudience: spec.multiTenant ? "AzureADMultipleOrgs" : "AzureADMyOrg",
      owners,
      credentials,
      hasExpiredCredentials: credentials.some((c) => Date.parse(c.endDateTime) < NOW),
      hasLongLivedSecrets: Boolean(spec.longLivedSecret),
      permissions,
      hasHighRiskPermissions: Boolean(spec.highRisk),
      highRiskScopes: spec.highRisk ? HIGH_RISK_SCOPES : [],
      redirectUris: spec.wildcardRedirect
        ? [`https://*.${profile.domain}/auth`]
        : [`https://app.${profile.domain}/auth`],
      hasWildcardRedirectUris: Boolean(spec.wildcardRedirect),
      hasTenantWideAdminConsent: Boolean(spec.highRisk),
      grantedScopes: spec.highRisk ? HIGH_RISK_SCOPES : ["User.Read"],
      riskScore,
      riskLevel: riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low",
      riskFactors,
    };
  });

  return {
    totalApps: apps.length,
    appsWithNoOwner: apps.filter((a) => a.owners.length === 0).length,
    appsWithHighRisk: apps.filter((a) => a.hasHighRiskPermissions).length,
    appsWithExpiredCredentials: apps.filter((a) => a.hasExpiredCredentials).length,
    appsWithLongLivedSecrets: apps.filter((a) => a.hasLongLivedSecrets).length,
    multiTenantApps: apps.filter((a) => a.signInAudience === "AzureADMultipleOrgs").length,
    usersCanRegisterApps: profile.usersCanRegisterApps,
    permissionError: false,
    apps,
    partialData: false,
    collectionIssues: [],
  };
}

function servicePrincipalsSnapshot(profile) {
  const r = rng(profile.seed + 89);
  const sps = profile.servicePrincipals.map((spec, i) => {
    const grants = spec.highRisk
      ? [{ consentType: "AllPrincipals", principalId: null, resourceId: "demo-resource-graph", resourceName: "Microsoft Graph (demo)", scopes: HIGH_RISK_SCOPES, isHighRisk: true }]
      : [{ consentType: "Principal", principalId: `demo-user-${String(i + 1).padStart(4, "0")}`, resourceId: "demo-resource-graph", resourceName: "Microsoft Graph (demo)", scopes: ["User.Read"], isHighRisk: false }];
    const riskFactors = spec.highRisk ? ["Tenant-wide consent to high-risk scopes"] : [];
    return {
      id: `demo-sp-${String(i + 1).padStart(3, "0")}`,
      appId: `demo-spappid-${String(i + 1).padStart(3, "0")}`,
      displayName: `${spec.name} (demo)`,
      publisherName: spec.firstParty ? "Microsoft Services (demo)" : "Demo Software Ltd",
      servicePrincipalType: spec.managedIdentity ? "ManagedIdentity" : "Application",
      accountEnabled: spec.enabled !== false,
      tags: spec.firstParty ? ["WindowsAzureActiveDirectoryIntegratedApp"] : ["demo-fixture"],
      homepage: `https://app.${profile.domain}/${slug(spec.name)}`,
      lastSignInDateTime: daysAgo(between(r, 0, 500)),
      consentGrants: grants,
      hasHighRiskGrants: Boolean(spec.highRisk),
      assignedUserCount: between(r, 0, 40),
      assignedGroupCount: between(r, 0, 4),
      isAdminConsented: Boolean(spec.highRisk),
      isFirstParty: Boolean(spec.firstParty),
      riskLevel: spec.highRisk ? "high" : "low",
      riskScore: spec.highRisk ? 80 : 10,
      riskFactors,
    };
  });

  return {
    total: sps.length,
    applicationCount: sps.filter((s) => s.servicePrincipalType === "Application").length,
    managedIdentityCount: sps.filter((s) => s.servicePrincipalType === "ManagedIdentity").length,
    microsoftOwnedCount: sps.filter((s) => s.isFirstParty).length,
    thirdPartyCount: sps.filter((s) => !s.isFirstParty).length,
    disabledCount: sps.filter((s) => !s.accountEnabled).length,
    withHighRiskGrants: sps.filter((s) => s.hasHighRiskGrants).length,
    permissionError: false,
    servicePrincipals: sps,
    partialData: false,
    collectionIssues: [],
  };
}

function securityEstateSnapshot(profile, people, intune) {
  const r = rng(profile.seed + 97);
  const deviceList = intune.deviceList.slice(0, 40).map((d) => ({
    id: d.id,
    displayName: d.deviceName,
    operatingSystem: d.operatingSystem,
    operatingSystemVersion: d.osVersion,
    trustType: d.operatingSystem === "Windows" ? "AzureAd" : "Workplace",
    isManaged: true,
    isCompliant: d.complianceState === "compliant",
    managementType: "MDM",
    approximateLastSignInDateTime: d.lastSyncDateTime,
  }));

  const unmanaged = profile.unmanagedDevices;
  const byOs = {};
  for (const d of deviceList) byOs[d.operatingSystem] = (byOs[d.operatingSystem] ?? 0) + 1;

  return {
    deviceSummary: {
      total: intune.totalDevices + unmanaged,
      managed: intune.totalDevices,
      unmanaged,
      mde: Math.round(intune.totalDevices * profile.mdeShare),
      azureAdJoined: Math.round(intune.totalDevices * 0.7),
      hybridJoined: Math.round(intune.totalDevices * 0.1),
      registered: Math.round(intune.totalDevices * 0.2),
      unknown: unmanaged,
      byOs,
    },
    deviceList,
    saasApps: profile.servicePrincipals.slice(0, 6).map((spec, i) => ({
      id: `demo-sp-${String(i + 1).padStart(3, "0")}`,
      displayName: `${spec.name} (demo)`,
      publisherName: spec.firstParty ? "Microsoft Services (demo)" : "Demo Software Ltd",
      appOwnerOrganizationId: spec.firstParty ? "demo-tenant-microsoft" : profile.tenantId,
      isFirstParty: Boolean(spec.firstParty),
      createdDateTime: daysAgo(between(r, 100, 1400)),
      tags: ["demo-fixture"],
    })),
    oauthApps: profile.servicePrincipals
      .filter((spec) => spec.highRisk)
      .map((spec, i) => ({
        clientId: `demo-spappid-${String(i + 1).padStart(3, "0")}`,
        displayName: `${spec.name} (demo)`,
        consentType: "AllPrincipals",
        scopes: HIGH_RISK_SCOPES,
        isOrgWide: true,
      })),
    defenderOfficeAlerts: profile.defenderAlerts.map((alert, i) => ({
      id: `demo-alert-${String(i + 1).padStart(3, "0")}`,
      title: `${alert.title} (demo)`,
      severity: alert.severity,
      status: alert.status,
      serviceSource: "microsoftDefenderForOffice365",
      category: alert.category,
      createdDateTime: daysAgo(between(r, 0, 30)),
    })),
    defenderOfficeStatus: {
      ok: true,
      error: null,
      totalAlerts: profile.defenderAlerts.length,
      high: profile.defenderAlerts.filter((a) => a.severity === "high").length,
      medium: profile.defenderAlerts.filter((a) => a.severity === "medium").length,
      low: profile.defenderAlerts.filter((a) => a.severity === "low").length,
      informational: profile.defenderAlerts.filter((a) => a.severity === "informational").length,
    },
  };
}

const WORKLOADS = [
  { workload: "exchange", displayName: "Exchange" },
  { workload: "teams", displayName: "Microsoft Teams" },
  { workload: "sharePoint", displayName: "SharePoint" },
  { workload: "oneDrive", displayName: "OneDrive" },
  { workload: "yammer", displayName: "Viva Engage" },
];

function adoptionSnapshot(profile) {
  const r = rng(profile.seed + 101);
  const licensed = Math.round(profile.userCount * 0.95);

  const workloads = WORKLOADS.map((w, i) => {
    const share = profile.adoptionShares[i] ?? 0.3;
    const activeUsers = Math.round(licensed * share);
    return {
      workload: w.workload,
      displayName: `${w.displayName} (demo)`,
      activeUsers,
      inactiveUsers: licensed - activeUsers,
      licensedUsers: licensed,
      adoptionPercent: pct(activeUsers, licensed),
      isValueGap: share < 0.4,
      trend: Array.from({ length: 6 }, (_, t) => {
        const monthActive = Math.round(activeUsers * (0.85 + t * 0.03));
        return {
          period: daysAgo((5 - t) * 30).slice(0, 7),
          activeUsers: monthActive,
          licensedUsers: licensed,
          adoptionPercent: pct(monthActive, licensed),
        };
      }),
      depth: {
        teamChatMessages: between(r, 0, 9000),
        privateChatMessages: between(r, 0, 12000),
        calls: between(r, 0, 900),
        meetings: between(r, 0, 700),
        odViewedOrEdited: between(r, 0, 4000),
        odSynced: between(r, 0, 900),
        odSharedInternally: between(r, 0, 600),
        odSharedExternally: between(r, 0, 60),
        spVisitedPages: between(r, 0, 6000),
        spViewedOrEdited: between(r, 0, 3000),
        spSynced: between(r, 0, 500),
        spSharedInternally: between(r, 0, 400),
        spSharedExternally: between(r, 0, 40),
        emailSent: between(r, 0, 20000),
        emailReceived: between(r, 0, 60000),
        emailRead: between(r, 0, 40000),
      },
    };
  });

  const totalActive = Math.max(...workloads.map((w) => w.activeUsers));
  return {
    workloads,
    totalActiveUsers: totalActive,
    totalLicensedUsers: licensed,
    overallAdoptionPercent: pct(totalActive, licensed),
    valueGapCount: workloads.filter((w) => w.isValueGap).length,
    appsActivation: [
      { app: "windows", displayName: "Microsoft 365 apps for Windows (demo)", activeUsers: Math.round(licensed * 0.8) },
      { app: "mac", displayName: "Microsoft 365 apps for Mac (demo)", activeUsers: Math.round(licensed * 0.08) },
      { app: "mobile", displayName: "Microsoft 365 mobile apps (demo)", activeUsers: Math.round(licensed * 0.45) },
    ],
    copilotAdoption: profile.copilotSeats > 0
      ? {
          enabledUsers: profile.copilotSeats,
          activeUsers: Math.round(profile.copilotSeats * 0.6),
          adoptionPercent: 60,
          appBreakdown: [
            { app: "teams", displayName: "Copilot in Teams (demo)", enabledUsers: profile.copilotSeats, activeUsers: Math.round(profile.copilotSeats * 0.5) },
            { app: "word", displayName: "Copilot in Word (demo)", enabledUsers: profile.copilotSeats, activeUsers: Math.round(profile.copilotSeats * 0.3) },
          ],
        }
      : null,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
    collectionNotes: [
      "Synthetic fixture: usage reports were invented, not collected from Graph.",
    ],
  };
}

function powerBISnapshot(profile) {
  const r = rng(profile.seed + 103);
  if (!profile.powerBiAvailable) {
    return {
      available: false,
      totalWorkspaces: 0,
      activeWorkspaces: 0,
      orphanedWorkspaces: 0,
      personalWorkspaces: 0,
      dedicatedCapacityWorkspaces: 0,
      totalDatasets: 0,
      refreshableDatasets: 0,
      totalReports: 0,
      capacities: [],
      workspaces: [],
      partialData: true,
      permissionError: false,
      collectionIssues: [
        {
          source: "powerBIWorkspaces",
          status: 403,
          category: "permission",
          message:
            "Synthetic fixture: this profile models a tenant that has not enabled Power BI service-principal access.",
          retryable: false,
          permissionRequired: true,
          requiredPermissions: [{ name: "Tenant.Read.All", accessKind: "external-scope" }],
        },
      ],
    };
  }

  const workspaces = profile.powerBiWorkspaces.map((name, i) => ({
    id: `demo-workspace-${String(i + 1).padStart(2, "0")}`,
    name: `${name} (demo)`,
    type: i === 0 ? "PersonalGroup" : "Workspace",
    state: "Active",
    isOrphaned: i % 5 === 4,
    adminCount: i % 5 === 4 ? 0 : between(r, 1, 3),
    datasetCount: between(r, 0, 8),
    reportCount: between(r, 0, 12),
    isOnDedicatedCapacity: i < 2,
    capacityId: i < 2 ? "demo-capacity-01" : null,
  }));

  return {
    available: true,
    totalWorkspaces: workspaces.length,
    activeWorkspaces: workspaces.filter((w) => w.state === "Active").length,
    orphanedWorkspaces: workspaces.filter((w) => w.isOrphaned).length,
    personalWorkspaces: workspaces.filter((w) => w.type === "PersonalGroup").length,
    dedicatedCapacityWorkspaces: workspaces.filter((w) => w.isOnDedicatedCapacity).length,
    totalDatasets: workspaces.reduce((n, w) => n + w.datasetCount, 0),
    refreshableDatasets: Math.round(workspaces.reduce((n, w) => n + w.datasetCount, 0) * 0.6),
    totalReports: workspaces.reduce((n, w) => n + w.reportCount, 0),
    capacities: [
      { id: "demo-capacity-01", displayName: "Demo shared capacity", sku: "A1", state: "Active", adminCount: 2 },
    ],
    workspaces,
    partialData: false,
    permissionError: false,
    collectionIssues: [],
  };
}

/* ---------------------------------------------------------------------------
 * The two profiles.
 * ------------------------------------------------------------------------- */

const HEALTHY = {
  key: "healthy-mid-market",
  seed: 20260701,
  name: "Healthy mid-market",
  description:
    "Roughly 250 users, MFA broadly enforced, a decent Secure Score and a short tail of low-severity findings. Entirely invented.",
  tenantName: "Northwind Traders (demonstration fixture)",
  tenantId: "demo-tenant-northwind-traders",
  domain: "northwind-traders.example",
  spHost: "northwind-traders-demo.example",
  userCount: 250,
  guestCount: 12,
  disabledCount: 9,
  disabledLicensedShare: 0.2,
  mfaShare: 0.96,
  staleShare: 0.03,
  neverSignedInShare: 0.01,
  seatCost: 12.5,
  mfaEnforcementSignal: "conditionalAccess",
  passwordlessShare: 0.35,
  secureScore: 462,
  secureScoreMax: 600,
  scoreTrendPerWeek: 4,
  riskyUserCount: 1,
  riskTimelineHigh: 0,
  adminsWithoutMfa: 0,
  legacyAuthSignInCount: 0,
  legacyAuthBlockedByCA: true,
  caPolicies: [
    { name: "Require MFA for all users", state: "enabled", targetUsers: "All users", authStrength: "Multifactor authentication" },
    { name: "Block legacy authentication", state: "enabled", targetUsers: "All users", authStrength: "Not applicable" },
    { name: "Require compliant device for admins", state: "enabled", targetUsers: "Directory roles", authStrength: "Multifactor authentication" },
    { name: "Risk-based sign-in", state: "enabled", targetUsers: "All users", authStrength: "Multifactor authentication" },
    { name: "Pilot: phishing-resistant MFA for admins", state: "enabledForReportingButNotEnforced", targetUsers: "Directory roles", authStrength: "Phishing-resistant MFA" },
  ],
  secureScoreControls: [
    { title: "Require MFA for administrative roles", category: "Identity", max: 30, status: "configured" },
    { title: "Block legacy authentication", category: "Identity", max: 20, status: "configured" },
    { title: "Enable self-service password reset", category: "Identity", max: 10, status: "configured" },
    { title: "Turn on customer lockbox", category: "Data", max: 5, status: "notConfigured" },
    { title: "Enable Safe Attachments for SharePoint", category: "Apps", max: 8, status: "notConfigured" },
  ],
  adminRoster: [
    { roles: ["Global Administrator"], licensed: false },
    { roles: ["Global Administrator"], licensed: false },
    { roles: ["Exchange Administrator"], licensed: true },
    { roles: ["Intune Administrator"], licensed: false },
    { roles: ["Security Reader"], licensed: false },
  ],
  eligibleGlobalAdmins: 3,
  eligibleAdmins: 7,
  roleDataSource: "unifiedRbac",
  skus: [
    { part: "SPE_E3", name: "Microsoft 365 E3", total: 250, assigned: 238 },
    { part: "EMS", name: "Enterprise Mobility + Security E3", total: 60, assigned: 55 },
    { part: "POWER_BI_PRO", name: "Power BI Pro", total: 40, assigned: 31 },
    { part: "EXCHANGESTANDARD", name: "Exchange Online (Plan 1)", total: 20, assigned: 11 },
  ],
  sharedMailboxes: 14,
  roomMailboxes: 8,
  mailboxGbPerUser: 6.2,
  malwareDetected: 3,
  domains: [
    { domain: "northwind-traders.example", hasSpf: true, hasDkim: true, hasDmarc: true, mxConfigured: true, spfRecord: "v=spf1 include:spf.demo-mail.example -all", dmarcPolicy: "p=reject; rua=mailto:dmarc@northwind-traders.example", dkimSource: "exchange", expectedSpf: true, expectedMx: true },
    { domain: "mail.northwind-traders.example", hasSpf: true, hasDkim: true, hasDmarc: true, mxConfigured: true, spfRecord: "v=spf1 include:spf.demo-mail.example -all", dmarcPolicy: "p=quarantine", dkimSource: "exchange", expectedSpf: true, expectedMx: true },
  ],
  teamNames: ["Finance", "Sales EMEA", "Engineering", "Customer Support", "People Team", "Facilities", "Leadership", "Marketing", "Procurement", "Projects"],
  teamStaleDays: 20,
  archivedTeams: 3,
  teamsAdoption: 0.72,
  guestAccessEnabled: true,
  externalAccessEnabled: false,
  siteNames: ["Finance", "Sales", "Engineering", "Support", "People", "Intranet", "Projects", "Procurement"],
  siteStaleDays: 30,
  oneDriveGbPerUser: 9.4,
  sharingLinks: { total: 340, orgWide: 22, anonymous: 0 },
  sharingCapability: "ExternalUserSharingOnly",
  sharingDomainRestrictionMode: "AllowList",
  defaultSharingLinkType: "Internal",
  anyoneLinkExpirationInDays: 30,
  dlpPolicies: 6,
  activeDlpPolicies: 5,
  dlpPolicyMatches: 74,
  retentionLabelCount: 9,
  complianceScore: 78,
  auditLogEnabled: true,
  eDiscoveryCases: 2,
  sensitivityLabels: ["Public", "Internal", "Confidential", "Highly confidential"],
  serviceCount: 10,
  servicesWithIssues: 0,
  activeAdvisories: 1,
  deviceCount: 230,
  deviceOs: ["Windows", "iOS", "macOS"],
  deviceComplianceShare: 0.95,
  deviceEncryptionShare: 0.97,
  deviceStaleDays: 5,
  tamperProtectionShare: 0.94,
  jailbrokenCount: 0,
  compliancePolicies: 6,
  configProfiles: 14,
  appProtectionPolicies: 4,
  unmanagedDevices: 6,
  mdeShare: 0.9,
  intuneAssessment: [
    { area: "Compliance", item: "Compliance policies assigned", value: "6", status: "pass", notes: "Synthetic fixture value." },
    { area: "Encryption", item: "BitLocker coverage", value: "97%", status: "pass", notes: "Synthetic fixture value." },
    { area: "Enrolment", item: "Enrolment restrictions", value: "Configured", status: "pass", notes: "Synthetic fixture value." },
  ],
  managedApps: ["Line of business portal", "Expenses", "Field service", "Password manager"],
  discoveredApps: ["Note taker", "Screen recorder", "PDF reader", "Chat client", "File sync"],
  appInstallFailureCeiling: 2,
  usersCanRegisterApps: false,
  appRegistrations: [
    { name: "Intranet single sign-on", credentials: [{ type: "certificate", startedDaysAgo: 200, endsDaysAgo: -400 }] },
    { name: "Expenses integration", credentials: [{ type: "secret", startedDaysAgo: 120, endsDaysAgo: -230 }] },
    { name: "Reporting exporter", credentials: [{ type: "secret", startedDaysAgo: 90, endsDaysAgo: -270 }], ownerless: true },
    { name: "Legacy timesheet importer", credentials: [{ type: "secret", startedDaysAgo: 800, endsDaysAgo: 40 }] },
  ],
  servicePrincipals: [
    { name: "Microsoft Teams services", firstParty: true },
    { name: "Microsoft Intune", firstParty: true },
    { name: "Expenses integration", firstParty: false },
    { name: "Reporting exporter", firstParty: false },
    { name: "Backup connector", firstParty: false },
    { name: "Deployment identity", firstParty: false, managedIdentity: true },
  ],
  defenderAlerts: [
    { title: "Suspicious inbox forwarding rule", severity: "medium", status: "resolved", category: "InitialAccess" },
    { title: "Unusual volume of external file sharing", severity: "low", status: "inProgress", category: "Exfiltration" },
  ],
  adoptionShares: [0.94, 0.72, 0.61, 0.68, 0.18],
  copilotSeats: 25,
  powerBiAvailable: true,
  powerBiWorkspaces: ["My workspace", "Finance reporting", "Sales analytics", "Operations", "Sandbox", "Retired pilots"],
};

const NEGLECTED = {
  key: "neglected-smb",
  seed: 20260702,
  name: "Neglected SMB",
  description:
    "Roughly 60 users, sparse MFA, legacy authentication still permitted, stale app registrations with expiring credentials, and several high-severity findings. Entirely invented.",
  tenantName: "Fabrikam Joinery (demonstration fixture)",
  tenantId: "demo-tenant-fabrikam-joinery",
  domain: "fabrikam-joinery.example",
  spHost: "fabrikam-joinery-demo.example",
  userCount: 60,
  guestCount: 7,
  disabledCount: 6,
  disabledLicensedShare: 0.85,
  mfaShare: 0.34,
  staleShare: 0.22,
  neverSignedInShare: 0.06,
  seatCost: 10.5,
  mfaEnforcementSignal: "none",
  passwordlessShare: 0,
  secureScore: 168,
  secureScoreMax: 600,
  scoreTrendPerWeek: 1,
  riskyUserCount: 5,
  riskTimelineHigh: 2,
  adminsWithoutMfa: 3,
  legacyAuthSignInCount: 412,
  legacyAuthBlockedByCA: false,
  caPolicies: [
    { name: "MFA for finance team", state: "enabled", targetUsers: "Group: Finance", authStrength: "Multifactor authentication" },
    { name: "Block legacy authentication", state: "disabled", targetUsers: "All users", authStrength: "Not applicable" },
  ],
  secureScoreControls: [
    { title: "Require MFA for administrative roles", category: "Identity", max: 30, status: "notConfigured" },
    { title: "Block legacy authentication", category: "Identity", max: 20, status: "notConfigured" },
    { title: "Enable self-service password reset", category: "Identity", max: 10, status: "notConfigured" },
    { title: "Turn on customer lockbox", category: "Data", max: 5, status: "notConfigured" },
    { title: "Enable Safe Attachments for SharePoint", category: "Apps", max: 8, status: "notConfigured" },
    { title: "Enable audit log search", category: "Data", max: 12, status: "notConfigured" },
    { title: "Restrict application registration", category: "Apps", max: 10, status: "notConfigured" },
  ],
  adminRoster: [
    { roles: ["Global Administrator"], licensed: true },
    { roles: ["Global Administrator"], licensed: true },
    { roles: ["Global Administrator"], licensed: true },
    { roles: ["Global Administrator"], licensed: true },
    { roles: ["Global Administrator", "Exchange Administrator"], licensed: true },
    { roles: ["Global Administrator"], licensed: false },
    { roles: ["Exchange Administrator"], licensed: true },
  ],
  eligibleGlobalAdmins: 0,
  eligibleAdmins: 0,
  roleDataSource: "directoryRolesFallback",
  skus: [
    { part: "SPB", name: "Microsoft 365 Business Premium", total: 60, assigned: 44 },
    { part: "EXCHANGESTANDARD", name: "Exchange Online (Plan 1)", total: 25, assigned: 9 },
    { part: "POWER_BI_STANDARD", name: "Power BI (free)", total: 15, assigned: 2 },
  ],
  sharedMailboxes: 5,
  roomMailboxes: 1,
  mailboxGbPerUser: 11.8,
  malwareDetected: 27,
  domains: [
    { domain: "fabrikam-joinery.example", hasSpf: true, hasDkim: false, hasDmarc: true, mxConfigured: true, spfRecord: "v=spf1 include:spf.demo-mail.example ~all", dmarcPolicy: "p=none", dkimSource: "none", expectedSpf: true, expectedMx: true },
    { domain: "fabrikam-joinery-shop.example", hasSpf: false, hasDkim: false, hasDmarc: false, mxConfigured: true, spfRecord: null, dmarcPolicy: null, dkimSource: "none", expectedSpf: true, expectedMx: true },
  ],
  teamNames: ["Workshop", "Sales", "Office", "Site fitters", "Owners"],
  teamStaleDays: 180,
  archivedTeams: 0,
  teamsAdoption: 0.31,
  guestAccessEnabled: true,
  externalAccessEnabled: true,
  siteNames: ["Office", "Quotes", "Drawings", "Suppliers", "Old intranet"],
  siteStaleDays: 400,
  oneDriveGbPerUser: 21.6,
  sharingLinks: { total: 190, orgWide: 61, anonymous: 34 },
  sharingCapability: "ExternalUserAndGuestSharing",
  sharingDomainRestrictionMode: "None",
  defaultSharingLinkType: "AnonymousAccess",
  anyoneLinkExpirationInDays: null,
  dlpPolicies: 0,
  activeDlpPolicies: 0,
  dlpPolicyMatches: 0,
  retentionLabelCount: 0,
  complianceScore: 31,
  auditLogEnabled: false,
  eDiscoveryCases: 0,
  sensitivityLabels: [],
  serviceCount: 10,
  servicesWithIssues: 2,
  activeAdvisories: 3,
  deviceCount: 41,
  deviceOs: ["Windows", "Android"],
  deviceComplianceShare: 0.44,
  deviceEncryptionShare: 0.51,
  deviceStaleDays: 120,
  tamperProtectionShare: 0.4,
  jailbrokenCount: 2,
  compliancePolicies: 1,
  configProfiles: 2,
  appProtectionPolicies: 0,
  unmanagedDevices: 23,
  mdeShare: 0.3,
  intuneAssessment: [
    { area: "Compliance", item: "Compliance policies assigned", value: "1", status: "fail", notes: "Synthetic fixture value." },
    { area: "Encryption", item: "BitLocker coverage", value: "51%", status: "fail", notes: "Synthetic fixture value." },
    { area: "Enrolment", item: "Enrolment restrictions", value: "Not configured", status: "fail", notes: "Synthetic fixture value." },
  ],
  managedApps: ["Quotes app", "Stock lookup"],
  discoveredApps: ["Remote desktop tool", "Torrent client", "Screen recorder", "Unknown toolbar", "PDF reader", "File sync"],
  appInstallFailureCeiling: 9,
  usersCanRegisterApps: true,
  appRegistrations: [
    { name: "Website contact form", credentials: [{ type: "secret", startedDaysAgo: 1100, endsDaysAgo: 380 }], ownerless: true, longLivedSecret: true },
    { name: "Old stock sync", credentials: [{ type: "secret", startedDaysAgo: 1400, endsDaysAgo: 620 }], ownerless: true, longLivedSecret: true, highRisk: true },
    { name: "Accounts export", credentials: [{ type: "secret", startedDaysAgo: 900, endsDaysAgo: -20 }], highRisk: true, wildcardRedirect: true },
    { name: "Marketing automation", credentials: [{ type: "secret", startedDaysAgo: 700, endsDaysAgo: -60 }], multiTenant: true, longLivedSecret: true },
    { name: "Consultant access", credentials: [{ type: "secret", startedDaysAgo: 1200, endsDaysAgo: 210 }], ownerless: true, highRisk: true },
  ],
  servicePrincipals: [
    { name: "Microsoft Teams services", firstParty: true },
    { name: "Old stock sync", firstParty: false, highRisk: true },
    { name: "Accounts export", firstParty: false, highRisk: true },
    { name: "Consultant access", firstParty: false, highRisk: true },
    { name: "Marketing automation", firstParty: false },
    { name: "Retired backup tool", firstParty: false, enabled: false },
  ],
  defenderAlerts: [
    { title: "Malicious attachment delivered to inbox", severity: "high", status: "new", category: "InitialAccess" },
    { title: "Suspicious inbox forwarding rule", severity: "high", status: "new", category: "Exfiltration" },
    { title: "Password spray attempt against tenant", severity: "medium", status: "inProgress", category: "CredentialAccess" },
    { title: "Anonymous sharing link created for finance file", severity: "medium", status: "new", category: "Exfiltration" },
    { title: "Sign-in from unfamiliar location", severity: "low", status: "resolved", category: "InitialAccess" },
  ],
  adoptionShares: [0.88, 0.31, 0.22, 0.29, 0.02],
  copilotSeats: 0,
  powerBiAvailable: false,
  powerBiWorkspaces: [],
};

/* ------------------------------------------------------------------------- */

function buildProfile(profile) {
  const people = buildPeople(profile);
  const users = usersSnapshot(profile, people);
  const licenses = licensesSnapshot(profile);
  const intune = intuneSnapshot(profile, people);

  return {
    "m365-overview": overviewSnapshot(profile, users, licenses),
    "m365-users": users,
    "m365-users-admin-exposure": adminExposureSnapshot(profile, people),
    "m365-licenses": licenses,
    "m365-security": securitySnapshot(profile, people),
    "m365-security-estate": securityEstateSnapshot(profile, people, intune),
    "m365-exchange": exchangeSnapshot(profile, people),
    "m365-teams": teamsSnapshot(profile),
    "m365-sharepoint": sharePointSnapshot(profile),
    "m365-sharepoint-sharing": sharePointSharingSnapshot(profile),
    "m365-sharepoint-policies": sharePointPoliciesSnapshot(profile),
    "m365-compliance": complianceSnapshot(profile),
    "m365-service-health": serviceHealthSnapshot(profile),
    "m365-intune": intune,
    "m365-intune-apps": intuneAppsSnapshot(profile),
    "m365-apps": appsSnapshot(profile, people),
    "m365-service-principals": servicePrincipalsSnapshot(profile),
    "m365-adoption": adoptionSnapshot(profile),
    "m365-powerbi": powerBISnapshot(profile),
  };
}

async function writeProfile(profile) {
  const dir = path.join(FIXTURES_DIR, profile.key);
  await rm(path.join(dir, "snapshots"), { recursive: true, force: true });
  await mkdir(path.join(dir, "snapshots"), { recursive: true });

  const snapshots = buildProfile(profile);
  for (const [key, data] of Object.entries(snapshots)) {
    await writeFile(
      path.join(dir, "snapshots", `${key}.json`),
      `${JSON.stringify(data, null, 2)}\n`,
      "utf8",
    );
  }

  const manifest = {
    name: profile.name,
    description: profile.description,
    schemaVersion: SCHEMA_VERSION,
    recordedAt: new Date(NOW).toISOString(),
    synthetic: true,
    source:
      "Hand-authored by fixtures/build.mjs. No tenant was contacted and no real " +
      "identifier, domain, mailbox or person appears anywhere in this profile.",
  };
  await writeFile(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(`${profile.key}: ${Object.keys(snapshots).length} snapshots written to ${dir}`);
}

await writeProfile(HEALTHY);
await writeProfile(NEGLECTED);
