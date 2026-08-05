import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createClient, type Client } from "@libsql/client";
import { hardenFile } from "./fileHardening.js";
import { logger } from "./logger.js";

const TTL_SECONDS = 3600;

export interface SnapshotEntry {
  key: string;
  data: string;
  fetchedAt: Date;
  expiresAt: Date;
  status: string;
  errorMsg: string | null;
}

function getDbPath(): string {
  const override = process.env.METRIC_DB_PATH?.trim();
  if (override) return path.resolve(override);
  const winAppData = process.env.APPDATA;
  if (process.platform === "win32" && winAppData) {
    return path.join(winAppData, "TenentDiscovery", "metrics.db");
  }
  return path.join(os.homedir(), ".config", "tenent-discovery", "metrics.db");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

let _client: Client | null = null;
let _initPromise: Promise<void> | null = null;

async function initClient(): Promise<void> {
  const dbPath = getDbPath();
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  _client = createClient({ url: `file:${dbPath}` });
  await _client.execute(`
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      key       TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      status    TEXT NOT NULL,
      error_msg TEXT
    )
  `);
  // Current generated findings (one row per fingerprint, latest scan).
  await _client.execute(`
    CREATE TABLE IF NOT EXISTS findings (
      fingerprint     TEXT PRIMARY KEY,
      rule_id         TEXT NOT NULL,
      category        TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL,
      severity        TEXT NOT NULL,
      check_status    TEXT NOT NULL,
      evidence_status TEXT NOT NULL,
      confidence_label TEXT NOT NULL,
      metric_id       TEXT,
      remediation     TEXT,
      evidence        TEXT,
      first_seen      INTEGER NOT NULL,
      last_seen       INTEGER NOT NULL
    )
  `);
  // User lifecycle state, keyed by fingerprint and kept separate so regeneration
  // never clobbers user input.
  await _client.execute(`
    CREATE TABLE IF NOT EXISTS finding_state (
      fingerprint TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'open',
      owner       TEXT,
      notes       TEXT,
      due_date    INTEGER,
      updated_at  INTEGER NOT NULL
    )
  `);
  // A discrete scan run groups archived snapshots and findings for drift/history.
  await _client.execute(`
    CREATE TABLE IF NOT EXISTS scan_runs (
      id           TEXT PRIMARY KEY,
      started_at   INTEGER NOT NULL,
      completed_at INTEGER,
      status       TEXT NOT NULL,
      triggered_by TEXT NOT NULL
    )
  `);
  // Full metric snapshot archive, one row per (scan, key).
  await _client.execute(`
    CREATE TABLE IF NOT EXISTS metric_snapshots_history (
      scan_id    TEXT NOT NULL,
      key        TEXT NOT NULL,
      data       TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      status     TEXT NOT NULL,
      error_msg  TEXT,
      PRIMARY KEY (scan_id, key)
    )
  `);
  // Findings archive, one row per (scan, fingerprint), for drift computation.
  await _client.execute(`
    CREATE TABLE IF NOT EXISTS findings_history (
      scan_id          TEXT NOT NULL,
      fingerprint      TEXT NOT NULL,
      rule_id          TEXT NOT NULL,
      category         TEXT NOT NULL,
      title            TEXT NOT NULL,
      severity         TEXT NOT NULL,
      check_status     TEXT NOT NULL,
      evidence_status  TEXT NOT NULL,
      confidence_label TEXT NOT NULL,
      PRIMARY KEY (scan_id, fingerprint)
    )
  `);

  // The database holds full tenant personal data (user principal names, mailbox
  // and device inventories), so it is restricted to the owner once libSQL has
  // actually created it, which is on the first statement above rather than on
  // createClient. A client backed by something other than this path (an
  // in-memory database, for instance) leaves nothing on disk to restrict.
  if (await fileExists(dbPath)) {
    await hardenFile(dbPath);
  }
}

export async function getClient(): Promise<Client> {
  if (_client) return _client;
  if (!_initPromise) _initPromise = initClient();
  await _initPromise;
  return _client!;
}

function rowToEntry(row: Record<string, unknown>): SnapshotEntry {
  return {
    key: row.key as string,
    data: row.data as string,
    fetchedAt: new Date((row.fetched_at as number) * 1000),
    expiresAt: new Date((row.expires_at as number) * 1000),
    status: row.status as string,
    errorMsg: (row.error_msg as string | null) ?? null,
  };
}

const inflight = new Map<string, Promise<unknown>>();

export async function getIfFresh<T>(key: string): Promise<T | null> {
  const client = await getClient();
  const now = Math.floor(Date.now() / 1000);
  const result = await client.execute({
    sql: "SELECT * FROM metric_snapshots WHERE key = ? AND expires_at > ? AND status = 'ok'",
    args: [key, now],
  });
  const row = result.rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.data as string) as T;
  } catch {
    return null;
  }
}

/**
 * Returns the latest successfully-collected snapshot for a key regardless of TTL.
 * Used by the findings engine, which evaluates whatever data was most recently
 * collected (freshness is governed by the background refresh, not this read).
 */
export async function getLatest<T>(key: string): Promise<T | null> {
  const client = await getClient();
  const result = await client.execute({
    sql: "SELECT data FROM metric_snapshots WHERE key = ? AND status = 'ok'",
    args: [key],
  });
  const row = result.rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.data as string) as T;
  } catch {
    return null;
  }
}

export async function set(key: string, data: unknown, ttlSeconds: number = TTL_SECONDS): Promise<void> {
  const client = await getClient();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  await client.execute({
    sql: `INSERT INTO metric_snapshots (key, data, fetched_at, expires_at, status, error_msg)
          VALUES (?, ?, ?, ?, 'ok', NULL)
          ON CONFLICT(key) DO UPDATE SET
            data = excluded.data,
            fetched_at = excluded.fetched_at,
            expires_at = excluded.expires_at,
            status = 'ok',
            error_msg = NULL`,
    args: [key, JSON.stringify(data), now, expiresAt],
  });
}

export async function setError(key: string, error: string): Promise<void> {
  const client = await getClient();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 60; // retry in 60s
  await client.execute({
    sql: `INSERT INTO metric_snapshots (key, data, fetched_at, expires_at, status, error_msg)
          VALUES (?, 'null', ?, ?, 'error', ?)
          ON CONFLICT(key) DO UPDATE SET
            fetched_at = excluded.fetched_at,
            expires_at = excluded.expires_at,
            status = 'error',
            error_msg = excluded.error_msg`,
    args: [key, now, expiresAt, error],
  });
}

export async function markAllStale(): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: "UPDATE metric_snapshots SET expires_at = 0",
    args: [],
  });
}

export async function getAllEntries(): Promise<SnapshotEntry[]> {
  const client = await getClient();
  const result = await client.execute("SELECT * FROM metric_snapshots");
  return result.rows.map((row) => rowToEntry(row as Record<string, unknown>));
}

export async function getOrFetch<T>(
  key: string,
  collect: () => Promise<T>,
  ttlSeconds: number = TTL_SECONDS,
): Promise<T> {
  const fresh = await getIfFresh<T>(key);
  if (fresh !== null) return fresh;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = collect()
    .then(async (data) => {
      try {
        await set(key, data, ttlSeconds);
      } catch (err) {
        logger.warn({ err, key }, "Failed to persist metric snapshot");
      }
      return data;
    })
    .catch(async (err) => {
      try {
        await setError(key, err instanceof Error ? err.message : String(err));
      } catch {
        // ignore persist error
      }
      throw err;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}
