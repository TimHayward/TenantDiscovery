import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema/index.js";

export function getDbPath(): string {
  const override = process.env.METRIC_DB_PATH?.trim();
  if (override) return path.resolve(override);

  const winAppData = process.env.APPDATA;
  if (process.platform === "win32" && winAppData) {
    return path.join(winAppData, "TenentDiscovery", "metrics.db");
  }
  return path.join(os.homedir(), ".config", "tenent-discovery", "metrics.db");
}

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const dbPath = getDbPath();
    const client = createClient({ url: `file:${dbPath}` });
    _db = drizzle(client, { schema });
  }
  return _db;
}

export * from "./schema/index.js";
