import { defineConfig } from "drizzle-kit";
import os from "os";
import path from "path";

function getDbUrl(): string {
  const override = process.env.METRIC_DB_PATH?.trim();
  if (override) return `file:${path.resolve(override)}`;

  const winAppData = process.env.APPDATA;
  if (process.platform === "win32" && winAppData) {
    return `file:${path.join(winAppData, "TenentDiscovery", "metrics.db")}`;
  }
  return `file:${path.join(os.homedir(), ".config", "tenent-discovery", "metrics.db")}`;
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "sqlite",
  dbCredentials: {
    url: getDbUrl(),
  },
});
