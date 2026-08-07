/**
 * Record a running server's collection into a demonstration fixture profile.
 *
 *   pnpm --filter @workspace/scripts exec tsx src/exportFixture.ts \
 *     --profile acme-manufacturing --api http://127.0.0.1:5100
 *
 * The output goes to `fixtures/<profile>/recorded-<timestamp>/`, which
 * `.gitignore` excludes, because a raw recording is not a fixture. Read every
 * file before you promote one; see `fixtures/README.md` for why.
 *
 * Two other modes exist for working on the redactor itself:
 *
 *   --input <file.json>   redact one JSON document from disk and print the
 *                         result and the warnings, writing nothing
 *   --dry-run             record and redact, report, but write nothing
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/* -------------------------------------------------------------------------
 * What the recorder collects.
 * ---------------------------------------------------------------------- */

/**
 * Snapshot key to the endpoint that serves it. Mirrors the task list in
 * `artifacts/api-server/src/lib/backgroundRefresh.ts`; the two packages share no
 * code, so a key added there must be added here, and a key missing from a
 * recording shows up immediately as a fixture that cannot fill a tab.
 */
const SNAPSHOT_ENDPOINTS: Record<string, string> = {
  "m365-overview": "/api/m365/overview",
  "m365-users": "/api/m365/users",
  "m365-users-admin-exposure": "/api/m365/users/admin-exposure",
  "m365-licenses": "/api/m365/licenses",
  "m365-security": "/api/m365/security",
  "m365-security-estate": "/api/m365/security/estate",
  "m365-exchange": "/api/m365/exchange",
  "m365-teams": "/api/m365/teams",
  "m365-sharepoint": "/api/m365/sharepoint",
  "m365-sharepoint-sharing": "/api/m365/sharepoint/sharing-summary",
  "m365-sharepoint-policies": "/api/m365/sharepoint/policies",
  "m365-compliance": "/api/m365/compliance",
  "m365-service-health": "/api/m365/service-health",
  "m365-intune": "/api/m365/intune",
  "m365-intune-apps": "/api/m365/intune/apps",
  "m365-apps": "/api/m365/apps",
  "m365-service-principals": "/api/m365/service-principals",
  "m365-adoption": "/api/m365/adoption",
  "m365-powerbi": "/api/m365/powerbi",
};

/**
 * `/m365/sharepoint/sharing-summary` wraps its payload in `{ data }`, unlike
 * every other snapshot route. Unwrapped here so the recorded file matches what
 * the collector stores under the key.
 */
const UNWRAP_DATA = new Set(["m365-sharepoint-sharing"]);

/* -------------------------------------------------------------------------
 * The redactor.
 * ---------------------------------------------------------------------- */

type RedactorKind =
  | "tenantId"
  | "orgName"
  | "objectId"
  | "personOrThingName"
  | "deviceName"
  | "upn"
  | "domain"
  | "url"
  | "urlList"
  | "nameList"
  | "freeText";

/**
 * Fields replaced with a generated equivalent, and what kind of equivalent.
 *
 * Replacement is consistent: the same input always yields the same output
 * within one run, so a device that names its owner still names the same person
 * the users snapshot does, and a finding that targets an object id still points
 * at the object that carries it. That referential integrity is the whole reason
 * for generating replacements rather than blanking the fields.
 */
const REDACTORS: Record<string, RedactorKind> = {
  tenantId: "tenantId",
  targetTenantId: "tenantId",
  tenantName: "orgName",

  id: "objectId",
  deviceId: "objectId",
  policyId: "objectId",
  keyId: "objectId",
  resourceId: "objectId",
  resourceAppId: "objectId",
  principalId: "objectId",
  capacityId: "objectId",
  teamId: "objectId",
  appId: "objectId",
  clientId: "objectId",
  targetClientId: "objectId",
  skuId: "objectId",
  appOwnerOrganizationId: "objectId",
  fromScanId: "objectId",
  toScanId: "objectId",
  controlId: "objectId",
  controlName: "objectId",
  fingerprint: "objectId",

  displayName: "personOrThingName",
  userDisplayName: "personOrThingName",
  name: "personOrThingName",
  teamName: "personOrThingName",
  targetAppDisplayName: "personOrThingName",
  assignedTeamName: "personOrThingName",
  policyName: "personOrThingName",
  resourceName: "personOrThingName",
  settingName: "personOrThingName",
  metricName: "personOrThingName",
  title: "personOrThingName",
  publisher: "personOrThingName",
  publisherName: "personOrThingName",
  manufacturer: "personOrThingName",
  model: "personOrThingName",
  owner: "personOrThingName",
  deviceName: "deviceName",

  userPrincipalName: "upn",

  domain: "domain",
  defaultDomain: "domain",

  url: "url",
  homepage: "url",
  endpoint: "url",
  redirectUris: "urlList",

  policyNames: "nameList",
  tags: "nameList",

  // Free text can carry a tenant name, a supplier or a customer, and nothing
  // about the field name says whether it does. Replaced wholesale.
  spfRecord: "freeText",
  dmarcPolicy: "freeText",
  description: "freeText",
  notes: "freeText",
  tooltip: "freeText",
  message: "freeText",
  item: "freeText",
  area: "freeText",
  label: "freeText",
  hint: "freeText",
  stateNotes: "freeText",
  errorDescription: "freeText",
  error: "freeText",
  source: "freeText",
  sourceLabel: "freeText",
  remediation: "freeText",
  requirement: "freeText",
  color: "freeText",
  department: "freeText",
  jobTitle: "freeText",
};

/**
 * Fields dropped outright and never reported as a surprise, because they are
 * credentials and a fixture has no business carrying one.
 */
const ALWAYS_DROP = new Set([
  "clientSecret",
  "secret",
  "password",
  "apiToken",
  "issuedApiToken",
  "token",
  "accessToken",
  "refreshToken",
]);

/**
 * Fields copied through unchanged: counts, percentages, booleans, timestamps,
 * Microsoft-defined vocabularies (permission scopes, compliance states) and the
 * structural containers that hold them.
 *
 * Derived from every property name in `lib/api-spec/openapi.yaml` that is not in
 * `REDACTORS` or `ALWAYS_DROP`. Anything not on this list is dropped with a
 * warning — that is the fail-closed rule, and the reason the list is exhaustive
 * rather than a set of patterns.
 */
const PASSTHROUGH = new Set([
  "accessKind", "accountEnabled", "acknowledgedMissingPermissions", "activeAdvisories",
  "activeChannels", "activeDlpPolicies", "activeIncidents", "activeMailboxes",
  "activeServices", "activeSites", "activeTeams", "activeUsers", "activeUsersLast30Days",
  "activeWorkspaces", "added", "adminCount", "adminsWithoutMfa", "adoptionPercent",
  "anonymousLinks", "anyoneLinkExpirationInDays", "apiBacked", "app", "appBreakdown",
  "appInstallList", "appProtectionList", "applicationCount", "approximateLastSignInDateTime",
  "apps", "appsActivation", "appsWithExpiredCredentials", "appsWithHighRisk",
  "appsWithLongLivedSecrets", "appsWithNoOwner", "archivedTeams", "assessmentItems",
  "assigned", "assignedGroupCount", "assignedGroups", "assignedLicenseCount",
  "assignedLicenses", "assignedUserCount", "auditLogEnabled", "authStrength",
  "automationCandidate", "available", "availableLicenses", "azureAdJoined", "byConfidence",
  "byEvidenceStatus", "byOs", "bySeverity", "byStatus", "caPolicies", "calls",
  "callsLast30Days", "capacities", "category", "changed", "checkStatus", "checkedAt",
  "checks", "classification", "collectionIssues", "collectionNotes", "completedAt",
  "complianceByOS", "complianceByState", "compliancePercent", "compliancePoliciesList",
  "complianceScore", "complianceScoreMax", "complianceState", "compliant",
  "compliantDeviceCount", "compliantDevices", "conditionalAccessPolicies", "confidenceLabel",
  "configManagerCount", "configProfilesList", "configuredApplicationPermissions",
  "consentGrants", "consentType", "contentFormats", "controlCategories", "controlCategory",
  "controls", "copilotAdoption", "count", "coveragePercent", "createdAt", "createdDateTime",
  "credentials", "data", "dataSources", "datasetCount", "date", "daysInactive",
  "dedicatedCapacityWorkspaces", "defaultLinkPermission", "defaultSharingLinkType",
  "defenderOfficeAlerts", "defenderOfficeStatus", "depth", "deviceCount", "deviceList",
  "deviceListAvailable", "deviceNames", "deviceSummary", "deviceType", "disabledCAPs",
  "disabledCount", "disabledUsers", "discoveredAppList", "discoveredByPlatform",
  "discoveryPermissionRequired", "dkimSource", "dlpPolicies", "dlpPolicyMatches",
  "domainAuthRecords", "dormantEligibleCount", "dueDate", "eDiscoveryCases",
  "eligibleAdmins", "eligibleAdminsCount", "eligibleAdminsWithProductivity",
  "eligibleAdminsWithProductivityCount", "eligibleAssignmentCount", "eligibleGlobalAdmins",
  "eligibleGlobalAdminsCount", "eligibleGlobalAdminsWithProductivity",
  "eligibleGlobalAdminsWithProductivityCount", "emailActivityLast30Days", "emailRead",
  "emailReceived", "emailSent", "enabledCAPs", "enabledUsers", "encryptedDevices",
  "encryptionPercent", "endDateTime", "enrolledByOS", "enrolledDateTime",
  "enrollmentConfigsList", "estimatedMonthlyCost", "estimatedMonthlyWaste", "evidenceStatus",
  "expectedMx", "expectedSpf", "expiresAt", "externalAccessEnabled", "fail", "failCount",
  "failed", "failingRules", "fetchedAt", "fieldMetadata", "filesCount", "findingCount",
  "findings", "firstSeen", "framework", "frameworks", "ghostLicensedCount", "ghostUsers",
  "gracePeriodCount", "grantedScopes", "groupTypes", "groups", "guestAccessEnabled",
  "guestUsers", "guests", "hasActiveIssues", "hasClientSecret", "hasDkim", "hasDmarc",
  "hasExpiredCredentials", "hasHighRiskGrants", "hasHighRiskPermissions",
  "hasLongLivedSecrets", "hasMissingRequiredPermissions", "hasProductivityLicense",
  "hasProtection", "hasSpf", "hasTenantWideAdminConsent", "hasWildcardRedirectUris", "high",
  "highRiskScopes", "hybridJoined", "implementationStatus", "inactiveUsers", "informational",
  "installByPlatform", "installPermissionRequired", "installed", "isActive",
  "isAdminConsented", "isAppliable", "isCollecting", "isCompliant", "isEncrypted",
  "isFirstParty", "isHighRisk", "isManaged", "isMfaRegistered", "isOnDedicatedCapacity",
  "isOrgWide", "isOrphaned", "isPasswordlessCapable", "isSsprRegistered", "isSupervised",
  "isValueGap", "items", "jailBroken", "jailbrokenCount", "keys", "lastActivityDate",
  "lastModifiedDateTime", "lastReportedDateTime", "lastSeen", "lastSignIn",
  "lastSignInDateTime", "lastSignInSource", "lastSyncDateTime", "lastSynced",
  "legacyAuthBlockedByCA", "legacyAuthSignInCount", "licenseDependencies", "licensedUsers",
  "licenses", "low", "mailboxSizeDistribution", "malwareDetected", "managed",
  "managedDiscoveredApps", "managedIdentityCount", "managementAgent", "managementState",
  "managementType", "manual", "manualCount", "maxScore", "mde", "medium", "meetings",
  "meetingsOrganized", "meetingsOrganizedLast30Days", "memberUsers", "members", "messages",
  "messagesLast30Days", "metadataVersion", "method", "methodsRegistered", "metricId",
  "mfaDataSource", "mfaDisabled", "mfaDisabledUsers", "mfaEnabled", "mfaEnabledPercent",
  "mfaEnabledUsers", "mfaEnforcementSignal", "mfaMethodsBreakdown", "mfaUsersList",
  "microsoftOwnedCount", "missingRecommendedPermissions", "missingRequiredPermissions",
  "modifiedDateTime", "multiTenantApps", "mxConfigured", "needsOnboarding", "neverSignedIn",
  "nonCompliant", "nonCompliantDevices", "nonCompliantPolicies", "noncompliantDeviceCount",
  "notApplicable", "notApplicableDeviceCount", "notAssessed", "notAssignedDeviceCount",
  "notInstalled", "oauthApps", "odSharedExternally", "odSharedInternally", "odSynced",
  "odViewedOrEdited", "ok", "oneDriveSharingCapability", "oneDriveTotalStorageGB",
  "oneDriveUsedStorageGB", "operatingSystem", "operatingSystemVersion", "orgWideLinks",
  "orphanedWorkspaces", "os", "osVersion", "osVersionBreakdown", "overallAdoptionPercent",
  "overallCompliance", "overallCompliancePercent", "overallStatus", "owners", "pageViews",
  "parent", "partial", "partialData", "pass", "passCount", "pending", "percentOfUsers",
  "period", "permanentAdmins", "permanentAdminsCount", "permanentAdminsWithProductivity",
  "permanentAdminsWithProductivityCount", "permanentGlobalAdmins",
  "permanentGlobalAdminsCount", "permanentGlobalAdminsWithProductivity",
  "permanentGlobalAdminsWithProductivityCount", "permissionCheckError",
  "permissionDependencies", "permissionError", "permissionRequired", "permissions",
  "personalWorkspaces", "platform", "platformType", "policies", "policyPermissionError",
  "policySummaryByOS", "previousCheckStatus", "previousSeverity", "priority",
  "privateChatMessages", "privateTeams", "provider", "publicTeams", "quarantinedMessages",
  "range", "reactions", "read", "received", "recommendedApplicationPermissions",
  "refreshableDatasets", "registered", "remediatedDeviceCount", "reportCount",
  "reportOnlyCAPs", "requiredApplicationPermissions", "requiredPermissions", "resolved",
  "retentionEvidence", "retentionLabelCount", "retentionPolicies", "retryable",
  "riskDetectionTimeline", "riskFactors", "riskLastUpdatedDateTime", "riskLevel",
  "riskScore", "riskState", "riskyUsers", "riskyUsersDetail", "roleDataSource", "roles",
  "roomMailboxes", "ruleId", "saasApps", "sampledSites", "scans", "scopes", "score",
  "scoreInPercentage", "secureScore", "secureScoreControls", "secureScoreHistory",
  "secureScoreMax", "secureScorePercent", "securityEnabled", "sensitivity",
  "sensitivityLabels", "sensitivityLabelsList", "sensitivityLabelsPermissionRequired",
  "sent", "service", "servicePrincipalType", "servicePrincipals", "serviceSource",
  "services", "servicesHealthy", "servicesWithIssues", "setup", "setupComplete",
  "setupCompletedAt", "severity", "sharedMailboxes", "sharingAllowedDomainCount",
  "sharingBlockedDomainCount", "sharingCapability", "sharingDomainRestrictionMode",
  "signInAudience", "signInDataSource", "signInFallbackCount", "sites", "sku",
  "skuPartNumber", "snapshotKeys", "spSharedExternally", "spSharedInternally", "spSynced",
  "spViewedOrEdited", "spVisitedPages", "spamFiltered", "startDateTime", "startedAt",
  "state", "stateUpdatedAt", "status", "storageAllocatedGB", "storageUsedGB",
  "storageUtilizationPercent", "strength", "strengthLevel", "summary", "suspended", "tab",
  "tamperProtectionDisabledDevices", "tamperProtectionEnabledDevices",
  "tamperProtectionPercent", "tamperProtectionUnknownDevices", "targetApps", "targetUsers",
  "teamChatMessages", "teamsBySize", "tenant", "thirdPartyCount", "topTeams", "total",
  "totalActiveUsers", "totalAlerts", "totalAppProtectionPolicies", "totalApps",
  "totalAssignedApps", "totalChannels", "totalCompliancePolicies", "totalConfigProfiles",
  "totalControls", "totalDatasets", "totalDevices", "totalDiscoveredApps", "totalFailed",
  "totalFiles", "totalInstalled", "totalLicensedUsers", "totalLicenses", "totalMailboxes",
  "totalNotApplicable", "totalNotInstalled", "totalPageViews", "totalPending",
  "totalPolicies", "totalReports", "totalServices", "totalSharingLinks", "totalSites",
  "totalSitesAvailable", "totalStorageAllocatedGB", "totalStorageUsedGB", "totalTeamSize",
  "totalTeams", "totalUsers", "totalWorkspaces", "trend", "triggeredBy", "trustType", "type",
  "unifiedAuditLogEnabled", "unknown", "unmanaged", "unmanagedDiscoveredApps", "updatedAt",
  "urgentMessages", "userType", "users", "usersByDepartment", "usersCanRegisterApps",
  "utilizationPercent", "value", "valueGapCount", "version", "versions", "warning",
  "warningCount", "withHighRiskGrants", "workload", "workloads", "workspaces",
]);

const FORENAMES = [
  "Alex", "Bela", "Cai", "Dara", "Emre", "Fern", "Gia", "Hal", "Idris", "Jo",
  "Kit", "Lior", "Mira", "Nils", "Oona", "Pax", "Quinn", "Ravi", "Sana", "Tam",
];
const SURNAMES = [
  "Ashvale", "Brambleton", "Corrindale", "Dunmarch", "Ellwither", "Fenmoor",
  "Glasswick", "Harrowfen", "Inglemere", "Juniperry", "Kestrelby", "Larkmond",
];

export interface RedactionWarning {
  /** JSON pointer-ish path to the field, e.g. `users[3].favouriteColour`. */
  path: string;
  field: string;
  reason: "unrecognised field";
}

export interface RedactionResult<T = unknown> {
  value: T;
  warnings: RedactionWarning[];
  /** How many fields were dropped, by field name. */
  droppedByField: Record<string, number>;
}

/**
 * A redactor with its own replacement tables.
 *
 * Build one per recording, not one per snapshot: the tables are what make the
 * replacement consistent across files, so `demo-user-0007` in the Intune
 * snapshot is the same person as `demo-user-0007` in the users snapshot.
 */
export function createRedactor(profileName: string) {
  const maps = new Map<RedactorKind, Map<string, string>>();
  const warnings: RedactionWarning[] = [];
  const droppedByField: Record<string, number> = {};
  const domainRoot = `${profileName.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.example`;

  function replacement(kind: RedactorKind, original: string): string {
    let table = maps.get(kind);
    if (!table) {
      table = new Map();
      maps.set(kind, table);
    }
    const existing = table.get(original);
    if (existing !== undefined) return existing;

    const n = table.size + 1;
    const padded = String(n).padStart(4, "0");
    const person = `${FORENAMES[n % FORENAMES.length]} ${SURNAMES[n % SURNAMES.length]}`;
    const generated =
      kind === "tenantId" ? `demo-tenant-${domainRoot}`
      : kind === "orgName" ? `${profileName} (demonstration fixture)`
      : kind === "objectId" ? `demo-object-${padded}`
      : kind === "personOrThingName" ? `${person} (demo)`
      : kind === "deviceName" ? `DEMO-DEVICE-${padded}`
      : kind === "upn" ? `${person.toLowerCase().replace(/\s+/g, ".")}@${domainRoot}`
      : kind === "domain" ? (table.size === 0 ? domainRoot : `sub${padded}.${domainRoot}`)
      : kind === "url" ? `https://${domainRoot}/demo/${padded}`
      : "(redacted)";
    table.set(original, generated);
    return generated;
  }

  function walk(value: unknown, at: string): unknown {
    if (Array.isArray(value)) return value.map((item, i) => walk(item, `${at}[${i}]`));
    if (value === null || typeof value !== "object") return value;

    const out: Record<string, unknown> = {};
    for (const [field, child] of Object.entries(value as Record<string, unknown>)) {
      const where = at ? `${at}.${field}` : field;

      if (ALWAYS_DROP.has(field)) continue;

      const kind = REDACTORS[field];
      if (kind !== undefined) {
        out[field] = redactByKind(kind, child, where);
        continue;
      }

      if (PASSTHROUGH.has(field)) {
        out[field] = walk(child, where);
        continue;
      }

      // Fail closed. A field nobody has classified may carry anything, so it
      // does not travel, and the operator is told which one and where.
      warnings.push({ path: where, field, reason: "unrecognised field" });
      droppedByField[field] = (droppedByField[field] ?? 0) + 1;
    }
    return out;
  }

  function redactByKind(kind: RedactorKind, value: unknown, at: string): unknown {
    if (value === null || value === undefined) return value;
    if (kind === "freeText") return typeof value === "string" ? "(redacted free text)" : value;
    if (kind === "urlList" || kind === "nameList") {
      const inner: RedactorKind = kind === "urlList" ? "url" : "personOrThingName";
      return Array.isArray(value)
        ? value.map((item) => (typeof item === "string" ? replacement(inner, item) : walk(item, at)))
        : value;
    }
    if (typeof value === "string") return replacement(kind, value);
    // A recognised field carrying something other than a string (an `owner`
    // object, say) is still walked, so its own fields are classified.
    return walk(value, at);
  }

  return {
    redact<T = unknown>(value: unknown): RedactionResult<T> {
      const redacted = walk(value, "") as T;
      return { value: redacted, warnings: [...warnings], droppedByField: { ...droppedByField } };
    },
    get warnings(): RedactionWarning[] {
      return [...warnings];
    },
    get droppedByField(): Record<string, number> {
      return { ...droppedByField };
    },
  };
}

/* -------------------------------------------------------------------------
 * CLI.
 * ---------------------------------------------------------------------- */

interface Options {
  profile: string;
  api: string;
  out: string;
  dryRun: boolean;
  input: string | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    profile: "",
    api: "http://127.0.0.1:5100",
    out: path.resolve(process.cwd(), "fixtures"),
    dryRun: false,
    input: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === "--profile") options.profile = next();
    else if (arg === "--api") options.api = next().replace(/\/$/, "");
    else if (arg === "--out") options.out = path.resolve(next());
    else if (arg === "--input") options.input = path.resolve(next());
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unrecognised argument: ${arg}`);
  }

  if (!options.profile) throw new Error("--profile is required");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.profile)) {
    throw new Error("--profile must be lower-case letters, digits and hyphens");
  }
  return options;
}

function reportWarnings(warnings: RedactionWarning[], droppedByField: Record<string, number>): void {
  if (warnings.length === 0) {
    console.log("Redaction: no unrecognised fields.");
    return;
  }
  console.warn(
    `\nRedaction dropped ${warnings.length} field occurrence(s) it did not recognise:`,
  );
  for (const [field, count] of Object.entries(droppedByField).sort((a, b) => b[1] - a[1])) {
    const example = warnings.find((w) => w.field === field)!.path;
    console.warn(`  ${field}  x${count}  (first at ${example})`);
  }
  console.warn(
    "These fields are NOT in the output. Classify each one in exportFixture.ts if the\n" +
      "fixture needs it, then re-record. Never pass an unclassified field through.",
  );
}

async function redactOneFile(options: Options): Promise<void> {
  const raw = JSON.parse(await readFile(options.input!, "utf8"));
  const redactor = createRedactor(options.profile);
  const result = redactor.redact(raw);
  console.log(JSON.stringify(result.value, null, 2));
  reportWarnings(result.warnings, result.droppedByField);
}

async function record(options: Options): Promise<void> {
  const redactor = createRedactor(options.profile);
  const snapshots: Record<string, unknown> = {};
  const failures: string[] = [];

  for (const [key, endpoint] of Object.entries(SNAPSHOT_ENDPOINTS)) {
    const url = `${options.api}${endpoint}`;
    const response = await fetch(url, {
      headers: process.env.API_AUTH_TOKEN
        ? { Authorization: `Bearer ${process.env.API_AUTH_TOKEN}` }
        : {},
    });
    if (!response.ok) {
      failures.push(`${key}: ${response.status} from ${url}`);
      continue;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const payload = UNWRAP_DATA.has(key) ? body.data : body;
    // The demonstration-mode flag is a property of the server that served the
    // recording, not of the tenant, so it does not travel into the fixture.
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      delete (payload as Record<string, unknown>).demoMode;
    }
    snapshots[key] = redactor.redact(payload).value;
    console.log(`recorded ${key}`);
  }

  for (const failure of failures) console.warn(`SKIPPED ${failure}`);
  reportWarnings(redactor.warnings, redactor.droppedByField);

  if (options.dryRun) {
    console.log(`\n--dry-run: nothing written. ${Object.keys(snapshots).length} snapshot(s) would be.`);
    return;
  }

  // Lower-case and hyphen-only, so the directory name is itself a legal profile
  // name: point DEMO_FIXTURES_DIR at the profile directory and DEMO_MODE at
  // this directory to run the recording straight back without renaming it.
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").toLowerCase();
  const dir = path.join(options.out, options.profile, `recorded-${stamp}`);
  await mkdir(path.join(dir, "snapshots"), { recursive: true });

  for (const [key, data] of Object.entries(snapshots)) {
    await writeFile(
      path.join(dir, "snapshots", `${key}.json`),
      `${JSON.stringify(data, null, 2)}\n`,
      "utf8",
    );
  }

  await writeFile(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(
      {
        name: options.profile,
        description: `Recorded from ${options.api} on ${new Date().toISOString()}. NOT REVIEWED.`,
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        synthetic: false,
        source:
          "Recorded from a live server by scripts/src/exportFixture.ts and redacted by field name. " +
          "A human must read every file before this is promoted to a committed fixture.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`\nWrote ${Object.keys(snapshots).length} snapshot(s) to ${dir}`);
  console.log(
    "\nThis is a RECORDING, not a fixture. It is git-ignored on purpose.\n" +
      "Read every file in it before you move anything into the profile directory:\n" +
      "field-name redaction cannot see a tenant name inside a policy description,\n" +
      "a supplier in a site title, or a customer in a team name.",
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.input) {
    await redactOneFile(options);
    return;
  }
  await record(options);
}

// Only run the CLI when invoked directly, so the redactor can be imported.
if (process.argv[1] && process.argv[1].endsWith("exportFixture.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
