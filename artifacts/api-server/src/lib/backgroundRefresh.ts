import { getDemoProfile, isDemoMode } from "./fixtures/demoMode.js";
import { loadManifest, loadSnapshot } from "./fixtures/loader.js";
import { logger } from "./logger.js";
import * as metricStore from "./metricStore.js";
import type { SnapshotEntry } from "./metricStore.js";
import { recordScan } from "./scanStore.js";
import { collectOverview } from "./collectors/overview.js";
import { collectUsers } from "./collectors/users.js";
import { collectAdminExposure } from "./collectors/adminExposure.js";
import { collectLicenses } from "./collectors/licenses.js";
import { collectSecurity, collectSecurityEstate } from "./collectors/security.js";
import { collectExchange } from "./collectors/exchange.js";
import { collectTeams } from "./collectors/teams.js";
import { collectSharePoint, collectSharePointSharing } from "./collectors/sharePoint.js";
import { collectSharePointPolicies } from "./collectors/sharePointPolicies.js";
import { collectCompliance } from "./collectors/compliance.js";
import { collectServiceHealth } from "./collectors/serviceHealth.js";
import { collectIntune, collectIntuneApps } from "./collectors/intune.js";
import { collectApps } from "./collectors/apps.js";
import { collectServicePrincipals } from "./collectors/servicePrincipals.js";
import { collectAdoption } from "./collectors/adoption.js";
import { collectPowerBI } from "./collectors/powerBI.js";

const TTL_SECONDS = 3600;
const STAGGER_MS = 5_000;
const TICK_INTERVAL_MS = 30 * 60 * 1000;
const REFRESH_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Fixture snapshots never go stale, and a stale one would be worse than useless:
 * `getOrFetch` falls back to the live collector when a key has expired, and in
 * demonstration mode that collector has no credentials to work with. Ten years
 * keeps the seeded snapshots fresh for the life of any demonstration, so the
 * only thing that ever rewrites them is an explicit refresh, which reads the
 * fixture again.
 */
const DEMO_TTL_SECONDS = 10 * 365 * 24 * 3600;

interface Task {
  key: string;
  collect: () => Promise<unknown>;
}

const TASKS: Task[] = [
  { key: "m365-overview",              collect: collectOverview },
  { key: "m365-users",                 collect: collectUsers },
  { key: "m365-security",              collect: collectSecurity },
  { key: "m365-licenses",              collect: collectLicenses },
  { key: "m365-exchange",              collect: collectExchange },
  { key: "m365-teams",                 collect: collectTeams },
  { key: "m365-sharepoint",            collect: collectSharePoint },
  { key: "m365-sharepoint-sharing",    collect: collectSharePointSharing },
  { key: "m365-compliance",            collect: collectCompliance },
  { key: "m365-service-health",        collect: collectServiceHealth },
  { key: "m365-intune",                collect: collectIntune },
  { key: "m365-intune-apps",           collect: collectIntuneApps },
  { key: "m365-apps",                  collect: collectApps },
  { key: "m365-service-principals",    collect: collectServicePrincipals },
  { key: "m365-users-admin-exposure",  collect: collectAdminExposure },
  { key: "m365-adoption",              collect: collectAdoption },
  { key: "m365-powerbi",               collect: collectPowerBI },
  { key: "m365-security-estate",       collect: collectSecurityEstate },
  { key: "m365-sharepoint-policies",   collect: collectSharePointPolicies },
];

const running = new Set<string>();

/**
 * Where a task's data comes from.
 *
 * Demonstration mode replaces the collector, and nothing below it. Every
 * snapshot still lands in the metric store through the same write, so the
 * findings engine, the drift computation, the scan archive, the export pipeline
 * and all twenty-odd routes run on the code they run on in production; the only
 * substitution is the one call that would otherwise have reached Microsoft.
 *
 * See `docs/agent-runs/T10.md` for why the substitution is here rather than at
 * the HTTP transport.
 */
function sourceFor(task: Task): () => Promise<unknown> {
  return isDemoMode() ? () => loadSnapshot(task.key) : task.collect;
}

function ttlSeconds(): number {
  return isDemoMode() ? DEMO_TTL_SECONDS : TTL_SECONDS;
}

async function runTask(task: Task): Promise<void> {
  if (running.has(task.key)) return;
  running.add(task.key);
  try {
    logger.info({ key: task.key }, "Background collect starting");
    const data = await sourceFor(task)();
    await metricStore.set(task.key, data, ttlSeconds());
    logger.info({ key: task.key }, "Background collect complete");
  } catch (err) {
    logger.warn({ err, key: task.key }, "Background collect failed");
    try {
      await metricStore.setError(task.key, err instanceof Error ? err.message : String(err));
    } catch { /* ignore */ }
  } finally {
    running.delete(task.key);
  }
}

async function refreshStale(): Promise<void> {
  const entries = await metricStore.getAllEntries();
  const entryMap = new Map(entries.map((e: SnapshotEntry) => [e.key, e]));
  const now = Date.now();

  for (const task of TASKS) {
    const entry: SnapshotEntry | undefined = entryMap.get(task.key);
    if (!entry) continue;
    const remaining = entry.expiresAt.getTime() - now;
    if (remaining < REFRESH_THRESHOLD_MS) {
      runTask(task).catch(() => {});
    }
  }
}

/**
 * Announce demonstration mode at startup, loudly enough that nobody who reads a
 * log can be in any doubt about what the dashboard above it is showing.
 */
async function announceDemoMode(profile: string): Promise<void> {
  const banner = "=".repeat(78);
  const manifest = await loadManifest().catch(() => null);
  for (const line of [
    banner,
    "  DEMONSTRATION MODE IS ON. THIS SERVER IS NOT CONNECTED TO A REAL TENANT.",
    `  Fixture profile : ${profile}${manifest ? ` (${manifest.name})` : ""}`,
    ...(manifest
      ? [
          `  Description     : ${manifest.description}`,
          `  Recorded        : ${manifest.recordedAt}`,
          `  Synthetic data  : ${manifest.synthetic ? "yes, entirely invented" : "NO — recorded from a real tenant and redacted"}`,
        ]
      : ["  Manifest        : could not be read; the fixture may be incomplete"]),
    "  Every figure the dashboard shows is fictional. Do not present it as an",
    "  assessment of any tenant. Unset DEMO_MODE to return to live collection.",
    banner,
  ]) {
    logger.warn(line);
  }
}

/**
 * Seed every snapshot from the fixture and record the baseline scan.
 *
 * Live collection is staggered over a minute and a half to be gentle with Graph
 * throttling. Reading nineteen local files needs none of that, and the point of
 * demonstration mode is that the dashboard has data the moment it is opened, so
 * this runs the lot at once and records the baseline scan as soon as they land.
 */
async function seedFromFixtures(profile: string): Promise<void> {
  const startedAt = Date.now();
  await announceDemoMode(profile);
  await Promise.all(TASKS.map((task) => runTask(task)));
  await recordScan("demo-fixture", startedAt);
  logger.warn({ profile, keys: TASKS.length }, "Demonstration fixture loaded");
}

export function start(): void {
  const demoProfile = getDemoProfile();
  if (demoProfile !== null) {
    seedFromFixtures(demoProfile).catch((err) =>
      logger.error({ err, profile: demoProfile }, "Failed to load the demonstration fixture"),
    );
    return;
  }

  logger.info("Starting background refresh scheduler");

  // Stagger initial collection, then record a baseline scan once they have run.
  TASKS.forEach((task, index) => {
    setTimeout(() => {
      runTask(task).catch(() => {});
    }, index * STAGGER_MS);
  });
  const bootDelay = TASKS.length * STAGGER_MS + 30_000;
  setTimeout(() => {
    recordScan("startup").catch((err) => logger.warn({ err }, "Startup scan failed"));
  }, bootDelay);

  // Periodic re-warm
  setInterval(() => {
    refreshStale().catch((err) => logger.warn({ err }, "refreshStale tick failed"));
  }, TICK_INTERVAL_MS);
}

/**
 * Run every collector to completion, then record a scan (archives snapshots,
 * regenerates + archives findings, computes drift baseline). Callers typically
 * fire-and-forget this; the HTTP refresh route returns 202 immediately.
 */
export async function triggerAll(triggeredBy: string = "manual"): Promise<void> {
  const startedAt = Date.now();
  await metricStore.markAllStale();
  await Promise.all(TASKS.map((task) => runTask(task)));
  await recordScan(triggeredBy, startedAt);
}

export type KeyStatus = {
  status: "ok" | "error" | "collecting" | "pending";
  fetchedAt: string | null;
  expiresAt: string | null;
};

export function getStatus(): Record<string, KeyStatus> {
  const result: Record<string, KeyStatus> = {};
  // Will be populated asynchronously; callers should await getStatusAsync
  for (const task of TASKS) {
    result[task.key] = {
      status: running.has(task.key) ? "collecting" : "pending",
      fetchedAt: null,
      expiresAt: null,
    };
  }
  return result;
}

export async function getStatusAsync(): Promise<Record<string, KeyStatus>> {
  const entries = await metricStore.getAllEntries();
  const entryMap = new Map(entries.map((e: SnapshotEntry) => [e.key, e]));
  const result: Record<string, KeyStatus> = {};

  for (const task of TASKS) {
    const entry = entryMap.get(task.key);
    if (running.has(task.key)) {
      result[task.key] = {
        status: "collecting",
        fetchedAt: entry?.fetchedAt?.toISOString() ?? null,
        expiresAt: entry?.expiresAt?.toISOString() ?? null,
      };
    } else if (!entry) {
      result[task.key] = { status: "pending", fetchedAt: null, expiresAt: null };
    } else {
      result[task.key] = {
        status: entry.status as "ok" | "error",
        fetchedAt: entry.fetchedAt?.toISOString() ?? null,
        expiresAt: entry.expiresAt?.toISOString() ?? null,
      };
    }
  }
  return result;
}

export const TASK_KEYS = TASKS.map((t) => t.key);
