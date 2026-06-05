import { logger } from "./logger.js";
import * as metricStore from "./metricStore.js";
import type { SnapshotEntry } from "./metricStore.js";
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

async function runTask(task: Task): Promise<void> {
  if (running.has(task.key)) return;
  running.add(task.key);
  try {
    logger.info({ key: task.key }, "Background collect starting");
    const data = await task.collect();
    await metricStore.set(task.key, data, TTL_SECONDS);
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

export function start(): void {
  logger.info("Starting background refresh scheduler");

  // Stagger initial collection
  TASKS.forEach((task, index) => {
    setTimeout(() => {
      runTask(task).catch(() => {});
    }, index * STAGGER_MS);
  });

  // Periodic re-warm
  setInterval(() => {
    refreshStale().catch((err) => logger.warn({ err }, "refreshStale tick failed"));
  }, TICK_INTERVAL_MS);
}

export async function triggerAll(): Promise<void> {
  await metricStore.markAllStale();
  for (const task of TASKS) {
    runTask(task).catch(() => {});
  }
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
