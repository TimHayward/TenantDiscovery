import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/** A discrete scan run grouping archived snapshots and findings for drift/history. */
export const scanRuns = sqliteTable("scan_runs", {
  id:          text("id").primaryKey(),
  startedAt:   integer("started_at").notNull(),
  completedAt: integer("completed_at"),
  status:      text("status").notNull(),
  triggeredBy: text("triggered_by").notNull(),
});

/** Full metric snapshot archive, one row per (scan, key). */
export const metricSnapshotsHistory = sqliteTable(
  "metric_snapshots_history",
  {
    scanId:    text("scan_id").notNull(),
    key:       text("key").notNull(),
    data:      text("data").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    status:    text("status").notNull(),
    errorMsg:  text("error_msg"),
  },
  (t) => [primaryKey({ columns: [t.scanId, t.key] })],
);

/** Findings archive, one row per (scan, fingerprint), for drift computation. */
export const findingsHistory = sqliteTable(
  "findings_history",
  {
    scanId:          text("scan_id").notNull(),
    fingerprint:     text("fingerprint").notNull(),
    ruleId:          text("rule_id").notNull(),
    category:        text("category").notNull(),
    title:           text("title").notNull(),
    severity:        text("severity").notNull(),
    checkStatus:     text("check_status").notNull(),
    evidenceStatus:  text("evidence_status").notNull(),
    confidenceLabel: text("confidence_label").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scanId, t.fingerprint] })],
);

export type ScanRun = typeof scanRuns.$inferSelect;
export type MetricSnapshotHistory = typeof metricSnapshotsHistory.$inferSelect;
export type FindingHistory = typeof findingsHistory.$inferSelect;
