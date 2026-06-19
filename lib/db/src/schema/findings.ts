import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** Current generated findings (one row per fingerprint, latest scan). */
export const findings = sqliteTable("findings", {
  fingerprint:     text("fingerprint").primaryKey(),
  ruleId:          text("rule_id").notNull(),
  category:        text("category").notNull(),
  title:           text("title").notNull(),
  description:     text("description").notNull(),
  severity:        text("severity").notNull(),
  checkStatus:     text("check_status").notNull(),
  evidenceStatus:  text("evidence_status").notNull(),
  confidenceLabel: text("confidence_label").notNull(),
  metricId:        text("metric_id"),
  remediation:     text("remediation"),
  evidence:        text("evidence"),
  firstSeen:       integer("first_seen").notNull(),
  lastSeen:        integer("last_seen").notNull(),
});

/** User-managed remediation lifecycle, kept separate from generated findings. */
export const findingState = sqliteTable("finding_state", {
  fingerprint: text("fingerprint").primaryKey(),
  status:      text("status").notNull().default("open"),
  owner:       text("owner"),
  notes:       text("notes"),
  dueDate:     integer("due_date"),
  updatedAt:   integer("updated_at").notNull(),
});

export type Finding = typeof findings.$inferSelect;
export type FindingState = typeof findingState.$inferSelect;
