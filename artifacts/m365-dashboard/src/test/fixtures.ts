import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The response bodies the MSW handlers serve.
 *
 * These are not authored here. They are the demonstration profiles committed
 * under `fixtures/` by T10, read straight off disk, so the dashboard tests and
 * `DEMO_MODE=<profile>` show the same tenant and there is one place to change
 * it. Authoring a second set of example bodies next to that one is how the two
 * drift, and a test suite asserting on a shape the server no longer produces is
 * worse than no test suite.
 *
 * Two things the profiles do not carry have to be built on top:
 *
 *  - the `with-metadata` envelope, which the routes assemble per field. The
 *    per-field wording is server-side presentation; what matters to a component
 *    is that a metadata entry exists for a field it asks about, so it is
 *    derived from the snapshot's own keys.
 *  - `/api/onboarding/status` and `/api/m365/connection-test`, which have no
 *    snapshot because the fixture route synthesises them. They are restated
 *    here, matching `artifacts/api-server/src/routes/m365Fixtures.ts`, and are
 *    validated against the same Zod schemas as everything else.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "..", "..", "..", "..", "fixtures");

/** The profile the tests read from. `neglected-smb` is the other one. */
export const FIXTURE_PROFILE = "healthy-mid-market";

const cache = new Map<string, unknown>();

/**
 * Read one snapshot from the demonstration profile, by the key the fixture
 * manifest uses (the file's stem: `m365-overview`, `m365-licenses`, ...).
 *
 * The result is deep-frozen-by-convention rather than by `Object.freeze`: it is
 * cached, so a test that mutates it changes what every later test sees. Use
 * `withOverrides` to vary a body instead.
 */
export function snapshot<T = Record<string, unknown>>(key: string): T {
  const cached = cache.get(key);
  if (cached !== undefined) return structuredClone(cached) as T;

  const file = path.join(FIXTURE_ROOT, FIXTURE_PROFILE, "snapshots", `${key}.json`);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (cause) {
    throw new Error(
      `No fixture snapshot "${key}" in profile "${FIXTURE_PROFILE}". ` +
        `Looked for ${file}. The available keys are the file stems under ` +
        `fixtures/${FIXTURE_PROFILE}/snapshots/.`,
      { cause },
    );
  }

  const parsed: unknown = JSON.parse(raw);
  cache.set(key, parsed);
  return structuredClone(parsed) as T;
}

/** A copy of `body` with `overrides` applied at the top level. */
export function withOverrides<T extends object>(body: T, overrides: Partial<T>): T {
  return { ...body, ...overrides };
}

/**
 * Wrap a snapshot in the `{ data, fieldMetadata, metadataVersion }` envelope the
 * `/with-metadata` routes return.
 *
 * Every top-level key of the data gets an entry, so a component that reads
 * `fieldMetadata[someField]` finds one for any field that exists. The values are
 * uniform on purpose: a test that cares about a particular evidence status
 * should say so at the call site rather than depend on what the server happens
 * to claim about that field today.
 */
export function withMetadata<T extends Record<string, unknown>>(
  data: T,
  overrides: Record<string, FieldMetadata> = {},
): { data: T; fieldMetadata: Record<string, FieldMetadata>; metadataVersion: string } {
  const fieldMetadata: Record<string, FieldMetadata> = {};
  for (const key of Object.keys(data)) {
    fieldMetadata[key] = {
      evidenceStatus: "apiBacked",
      confidenceLabel: "high",
      sourceLabel: `Demonstration fixture (${FIXTURE_PROFILE})`,
    };
  }
  return {
    data,
    fieldMetadata: { ...fieldMetadata, ...overrides },
    metadataVersion: "1.0",
  };
}

export interface FieldMetadata {
  evidenceStatus:
    | "apiBacked"
    | "partial"
    | "manual"
    | "automationCandidate"
    | "notAssessed";
  confidenceLabel: "high" | "medium" | "low" | "unknown";
  sourceLabel?: string;
  notes?: string[];
}

const FIXED_TIME = "2026-07-01T09:00:00.000Z";

/**
 * The onboarding status a completed, fully consented tenant returns. Mirrors
 * the demonstration-mode reply in `m365Fixtures.ts`; kept minimal because the
 * dashboard only reads the permission lists and the two booleans.
 */
export const onboardingStatusFixture = {
  targetClientId: `demo-client-${FIXTURE_PROFILE}`,
  targetTenantId: `demo-tenant-${FIXTURE_PROFILE}`,
  targetAppDisplayName: "Northwind Traders (demonstration fixture)",
  requiredApplicationPermissions: ["Directory.Read.All", "Reports.Read.All"],
  recommendedApplicationPermissions: ["Policy.Read.All"],
  configuredApplicationPermissions: [
    "Directory.Read.All",
    "Policy.Read.All",
    "Reports.Read.All",
  ],
  missingRequiredPermissions: [],
  missingRecommendedPermissions: [],
  hasMissingRequiredPermissions: false,
  allRequiredPermissionsMissing: false,
  canContinueWithMissingPermissions: false,
  permissionCheckError: null,
  permissionCheckSucceeded: true,
  needsOnboarding: false,
  setup: {
    tenantId: `demo-tenant-${FIXTURE_PROFILE}`,
    clientId: `demo-client-${FIXTURE_PROFILE}`,
    clientSecret: null,
    hasClientSecret: false,
    setupComplete: true,
    setupCompletedAt: FIXED_TIME,
    acknowledgedMissingPermissions: [],
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  },
};

/** A connection test in which every check passed. */
export const connectionTestFixture = {
  ok: true,
  checkedAt: FIXED_TIME,
  tenant: {
    id: `demo-tenant-${FIXTURE_PROFILE}`,
    displayName: "Northwind Traders (demonstration fixture)",
    defaultDomain: `${FIXTURE_PROFILE}.example`,
  },
  checks: [
    {
      id: "config",
      label: "Credentials configured",
      status: "ok" as const,
      category: "config" as const,
      message: "Served from the demonstration fixture. Nothing was contacted.",
    },
    {
      id: "auth",
      label: "Token acquired",
      status: "ok" as const,
      category: "auth" as const,
      message: "Served from the demonstration fixture. Nothing was contacted.",
    },
  ],
  missingRequiredPermissions: [],
};

/** Collection status with nothing in flight and every key fresh. */
export const collectionStatusFixture = {
  isCollecting: false,
  keys: {
    "m365-overview": {
      status: "ok" as const,
      fetchedAt: FIXED_TIME,
      expiresAt: "2026-07-01T09:30:00.000Z",
    },
  },
};

/** An empty data-source register. The dashboard only lists what it is given. */
export const dataSourcesFixture = {
  items: [],
  summary: {
    total: 0,
    byConfidence: { high: 0, medium: 0, low: 0, unknown: 0 },
    byEvidenceStatus: {
      apiBacked: 0,
      partial: 0,
      manual: 0,
      automationCandidate: 0,
      notAssessed: 0,
    },
  },
};
