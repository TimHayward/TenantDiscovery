import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createClient, type Client } from "@libsql/client";
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
}

async function getClient(): Promise<Client> {
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
