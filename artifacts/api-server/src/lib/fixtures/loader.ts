import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DemoModeError, getDemoProfile } from "./demoMode.js";

/**
 * The fixture format version. Bump it when the shape of a snapshot file changes
 * in a way an older fixture cannot satisfy, so that a stale fixture is rejected
 * loudly instead of rendering a half-empty dashboard.
 */
export const FIXTURE_SCHEMA_VERSION = 1;

export interface FixtureManifest {
  /** Human-readable profile name, e.g. "Neglected SMB". */
  name: string;
  description: string;
  schemaVersion: number;
  /** ISO date the fixture was recorded or authored. */
  recordedAt: string;
  /**
   * Whether every value in the fixture was invented rather than derived from a
   * real tenant. False means a human must have reviewed the redaction.
   */
  synthetic: boolean;
  /** Free text: where the fixture came from, for a reviewer reading the file. */
  source: string;
}

/**
 * Directories that may hold the fixture tree, in the order they are tried.
 *
 * The server runs both from `src` under vitest and from a single bundled
 * `dist/index.mjs`, and the repository root sits a different number of levels up
 * in each case, so the tree is found by walking upwards rather than by a fixed
 * relative path. `DEMO_FIXTURES_DIR` short-circuits the search, which is how a
 * container (where the bundle is copied away from the repository) points at a
 * mounted fixture volume.
 */
function candidateRoots(): string[] {
  const override = process.env.DEMO_FIXTURES_DIR?.trim();
  if (override) return [path.resolve(override)];

  const roots: string[] = [];
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    roots.push(path.join(dir, "fixtures"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  roots.push(path.resolve(process.cwd(), "fixtures"));
  return roots;
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

let cachedProfileDir: { profile: string; dir: string } | null = null;

/** The directory holding the configured profile, located once per profile. */
export async function resolveProfileDir(): Promise<string> {
  const profile = getDemoProfile();
  if (profile === null) {
    throw new DemoModeError("No fixture profile is configured (DEMO_MODE is unset).");
  }
  if (cachedProfileDir?.profile === profile) return cachedProfileDir.dir;

  const tried = candidateRoots();
  for (const root of tried) {
    const dir = path.join(root, profile);
    if (await isDirectory(dir)) {
      cachedProfileDir = { profile, dir };
      return dir;
    }
  }

  throw new DemoModeError(
    `Fixture profile "${profile}" was not found. Looked in: ${tried.join(", ")}. ` +
      "Set DEMO_FIXTURES_DIR to the directory holding the fixture profiles.",
  );
}

function assertManifest(value: unknown, file: string): FixtureManifest {
  if (typeof value !== "object" || value === null) {
    throw new DemoModeError(`${file} is not a fixture manifest object.`);
  }
  const manifest = value as Partial<FixtureManifest>;
  for (const field of ["name", "description", "recordedAt", "source"] as const) {
    if (typeof manifest[field] !== "string" || manifest[field]!.length === 0) {
      throw new DemoModeError(`${file} is missing the required string field "${field}".`);
    }
  }
  if (manifest.schemaVersion !== FIXTURE_SCHEMA_VERSION) {
    throw new DemoModeError(
      `${file} declares schemaVersion ${String(manifest.schemaVersion)}, but this server reads ` +
        `version ${FIXTURE_SCHEMA_VERSION}. Re-record the fixture.`,
    );
  }
  if (typeof manifest.synthetic !== "boolean") {
    throw new DemoModeError(`${file} is missing the required boolean field "synthetic".`);
  }
  return manifest as FixtureManifest;
}

let cachedManifest: { profile: string; manifest: FixtureManifest } | null = null;

export async function loadManifest(): Promise<FixtureManifest> {
  const profile = getDemoProfile();
  if (profile === null) {
    throw new DemoModeError("No fixture profile is configured (DEMO_MODE is unset).");
  }
  if (cachedManifest?.profile === profile) return cachedManifest.manifest;

  const file = path.join(await resolveProfileDir(), "manifest.json");
  const manifest = assertManifest(JSON.parse(await fs.readFile(file, "utf8")), file);
  cachedManifest = { profile, manifest };
  return manifest;
}

/**
 * The recorded snapshot for one metric key, e.g. `m365-overview`.
 *
 * A key with no fixture file throws. The caller records that as a collection
 * error, which is the same thing a live collector failure produces, so a
 * fixture that is missing a key looks like a failed collection rather than like
 * a tenant that genuinely has no data.
 */
export async function loadSnapshot(key: string): Promise<unknown> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) {
    throw new DemoModeError(`"${key}" is not a valid snapshot key.`);
  }
  const file = path.join(await resolveProfileDir(), "snapshots", `${key}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    throw new DemoModeError(
      `Fixture profile "${getDemoProfile()}" has no snapshot for "${key}" (${file}): ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

/** Every snapshot key the configured profile provides. */
export async function listSnapshotKeys(): Promise<string[]> {
  const dir = path.join(await resolveProfileDir(), "snapshots");
  const entries = await fs.readdir(dir);
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

/** Drops the located-directory and manifest caches. Exists for tests. */
export function resetFixtureCache(): void {
  cachedProfileDir = null;
  cachedManifest = null;
}
