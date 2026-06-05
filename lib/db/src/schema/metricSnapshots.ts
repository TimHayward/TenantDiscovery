import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const metricSnapshots = sqliteTable("metric_snapshots", {
  key:       text("key").primaryKey(),
  data:      text("data").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  status:    text("status").notNull(),
  errorMsg:  text("error_msg"),
});

export type MetricSnapshot = typeof metricSnapshots.$inferSelect;
export type InsertMetricSnapshot = typeof metricSnapshots.$inferInsert;
