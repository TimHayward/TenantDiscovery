import { getClient } from "../metricStore.js";
import { evaluateFindings } from "./engine.js";
import {
  type Finding,
  type FindingStatus,
  type FindingWithState,
  FINDING_STATUSES,
} from "./types.js";

function toIso(seconds: unknown): string {
  return new Date((seconds as number) * 1000).toISOString();
}

// Single-flight guard so concurrent regenerations (e.g. many dashboard polls)
// share one run instead of racing the upsert/delete against each other.
let regenInflight: Promise<Finding[]> | null = null;
// Signature of the metric snapshots the register was last generated from, so
// reads can skip regeneration when nothing has been collected since.
let lastRegenSnapshotSignature: string | null = null;

/**
 * A cheap fingerprint of the current metric snapshots. Snapshots are only ever
 * upserted (never mutated in place without bumping fetched_at), so the row count
 * plus the newest fetched_at changes whenever any collector runs.
 */
async function snapshotSignature(client: Awaited<ReturnType<typeof getClient>>): Promise<string> {
  const res = await client.execute(
    "SELECT COUNT(*) AS n, COALESCE(MAX(fetched_at), 0) AS m FROM metric_snapshots WHERE status = 'ok'",
  );
  const row = res.rows[0];
  return `${row?.n ?? 0}:${row?.m ?? 0}`;
}

/**
 * Regenerate findings from the latest metric snapshots and persist them to the
 * `findings` table. Upserts preserve `first_seen`; fingerprints no longer present
 * are removed from the live table (their `finding_state` rows are retained so
 * lifecycle re-binds if the finding reappears). The upserts and the prune run in
 * a single transaction so concurrent readers never observe a partially-rebuilt
 * register. Returns the generated findings.
 */
export async function regenerateFindings(): Promise<Finding[]> {
  if (regenInflight) return regenInflight;
  regenInflight = doRegenerate().finally(() => {
    regenInflight = null;
  });
  return regenInflight;
}

/**
 * Regenerate only when the metric snapshots have changed since the last run.
 * Used by read paths so a burst of dashboard polls doesn't rewrite the register
 * on every request when no new data has been collected.
 */
export async function ensureFindingsCurrent(): Promise<void> {
  const client = await getClient();
  const signature = await snapshotSignature(client);
  if (signature === lastRegenSnapshotSignature) return;
  await regenerateFindings();
}

async function doRegenerate(): Promise<Finding[]> {
  const client = await getClient();
  const signature = await snapshotSignature(client);
  const findings = await evaluateFindings();
  const now = Math.floor(Date.now() / 1000);

  const statements = findings.map((f) => ({
    sql: `INSERT INTO findings
            (fingerprint, rule_id, category, title, description, severity, check_status,
             evidence_status, confidence_label, metric_id, remediation, evidence, first_seen, last_seen)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(fingerprint) DO UPDATE SET
            rule_id = excluded.rule_id,
            category = excluded.category,
            title = excluded.title,
            description = excluded.description,
            severity = excluded.severity,
            check_status = excluded.check_status,
            evidence_status = excluded.evidence_status,
            confidence_label = excluded.confidence_label,
            metric_id = excluded.metric_id,
            remediation = excluded.remediation,
            evidence = excluded.evidence,
            last_seen = excluded.last_seen`,
    args: [
      f.fingerprint, f.ruleId, f.category, f.title, f.description, f.severity, f.checkStatus,
      f.evidenceStatus, f.confidenceLabel, f.metricId ?? null, f.remediation ?? null,
      f.evidence !== undefined ? JSON.stringify(f.evidence) : null, now, now,
    ] as (string | number | null)[],
  }));

  // Remove findings that were not regenerated this run.
  const fingerprints = findings.map((f) => f.fingerprint);
  if (fingerprints.length > 0) {
    const placeholders = fingerprints.map(() => "?").join(",");
    statements.push({
      sql: `DELETE FROM findings WHERE fingerprint NOT IN (${placeholders})`,
      args: fingerprints,
    });
  } else {
    statements.push({ sql: "DELETE FROM findings", args: [] });
  }

  // Atomic: all upserts + the prune commit together or not at all.
  await client.batch(statements, "write");
  lastRegenSnapshotSignature = signature;

  return findings;
}

export interface FindingsQuery {
  severity?: string;
  status?: string;
  category?: string;
  /** Exact fingerprint, for reading back a single row after a write. */
  fingerprint?: string;
}

/**
 * Read the consolidated register, joined with lifecycle state.
 *
 * Severity, status and category are filtered in SQL with bound parameters, not
 * in JavaScript, so the statement returns only the rows the caller asked for.
 * A finding with no `finding_state` row is "open" by definition, which is why
 * the status predicate coalesces rather than comparing `s.status` directly:
 * comparing directly would silently drop every never-triaged finding from a
 * `?status=open` query.
 */
export async function getFindings(query: FindingsQuery = {}): Promise<FindingWithState[]> {
  const client = await getClient();

  const conditions: string[] = [];
  const args: (string | number | null)[] = [];
  // The three user-facing filters test truthiness, not `!== undefined`, because
  // `category` is a free string in the query schema: `?category=` arrives as ""
  // and has always meant "unfiltered" rather than "match nothing".
  if (query.severity) {
    conditions.push("f.severity = ?");
    args.push(query.severity);
  }
  if (query.status) {
    conditions.push("COALESCE(s.status, 'open') = ?");
    args.push(query.status);
  }
  if (query.category) {
    conditions.push("f.category = ?");
    args.push(query.category);
  }
  // Fingerprint is an exact internal lookup, so an empty one must match nothing
  // rather than fall through and return the whole register.
  if (query.fingerprint !== undefined) {
    conditions.push("f.fingerprint = ?");
    args.push(query.fingerprint);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await client.execute({
    sql: `SELECT f.*, s.status AS state_status, s.owner, s.notes AS state_notes,
                 s.due_date, s.updated_at AS state_updated_at
          FROM findings f
          LEFT JOIN finding_state s ON s.fingerprint = f.fingerprint
          ${where}
          ORDER BY
            CASE f.severity
              WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
              WHEN 'low' THEN 3 ELSE 4 END,
            f.category, f.rule_id`,
    args,
  });

  return result.rows.map((row): FindingWithState => ({
    fingerprint: row.fingerprint as string,
    ruleId: row.rule_id as string,
    category: row.category as string,
    title: row.title as string,
    description: row.description as string,
    severity: row.severity as FindingWithState["severity"],
    checkStatus: row.check_status as FindingWithState["checkStatus"],
    evidenceStatus: row.evidence_status as FindingWithState["evidenceStatus"],
    confidenceLabel: row.confidence_label as FindingWithState["confidenceLabel"],
    metricId: (row.metric_id as string | null) ?? undefined,
    remediation: (row.remediation as string | null) ?? undefined,
    evidence: row.evidence ? safeParse(row.evidence as string) : undefined,
    status: ((row.state_status as string | null) ?? "open") as FindingStatus,
    owner: (row.owner as string | null) ?? null,
    stateNotes: (row.state_notes as string | null) ?? null,
    dueDate: row.due_date != null ? toIso(row.due_date) : null,
    firstSeen: toIso(row.first_seen),
    lastSeen: toIso(row.last_seen),
    stateUpdatedAt: row.state_updated_at != null ? toIso(row.state_updated_at) : null,
  }));
}

/**
 * Read a single finding by fingerprint, joined with lifecycle state. Returns the
 * same shape as `getFindings`, so a caller that needs one row after a write does
 * not have to read and sort the whole register to find it.
 */
export async function getFinding(fingerprint: string): Promise<FindingWithState | undefined> {
  const [row] = await getFindings({ fingerprint });
  return row;
}

export interface FindingStateUpdate {
  status?: FindingStatus;
  owner?: string | null;
  notes?: string | null;
  dueDate?: string | null;
}

/**
 * Update the lifecycle state for a finding, merging only the provided fields with
 * any existing state. Returns false if the fingerprint is unknown or status invalid.
 */
export async function updateFindingState(
  fingerprint: string,
  update: FindingStateUpdate,
): Promise<boolean> {
  const client = await getClient();
  const existing = await client.execute({
    sql: "SELECT fingerprint FROM findings WHERE fingerprint = ?",
    args: [fingerprint],
  });
  if (existing.rows.length === 0) return false;

  if (update.status && !FINDING_STATUSES.includes(update.status)) return false;

  // Load current state so a partial PATCH does not clear untouched fields.
  const current = await client.execute({
    sql: "SELECT status, owner, notes, due_date FROM finding_state WHERE fingerprint = ?",
    args: [fingerprint],
  });
  const prev = current.rows[0];

  const status = update.status ?? (prev?.status as string | undefined) ?? "open";
  const owner = update.owner !== undefined ? update.owner : ((prev?.owner as string | null) ?? null);
  const notes = update.notes !== undefined ? update.notes : ((prev?.notes as string | null) ?? null);
  const dueSeconds =
    update.dueDate !== undefined
      ? update.dueDate === null ? null : Math.floor(new Date(update.dueDate).getTime() / 1000)
      : ((prev?.due_date as number | null) ?? null);
  const now = Math.floor(Date.now() / 1000);

  await client.execute({
    sql: `INSERT INTO finding_state (fingerprint, status, owner, notes, due_date, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(fingerprint) DO UPDATE SET
            status = excluded.status,
            owner = excluded.owner,
            notes = excluded.notes,
            due_date = excluded.due_date,
            updated_at = excluded.updated_at`,
    args: [fingerprint, status, owner, notes, dueSeconds, now],
  });
  return true;
}

/** Auto-close lifecycle state for fingerprints that no longer appear in the register. */
export async function autoCloseResolved(activeFingerprints: string[]): Promise<void> {
  const client = await getClient();
  if (activeFingerprints.length === 0) return;
  const placeholders = activeFingerprints.map(() => "?").join(",");
  await client.execute({
    sql: `UPDATE finding_state SET status = 'remediated', updated_at = ?
          WHERE fingerprint NOT IN (${placeholders})
            AND status NOT IN ('remediated', 'suppressed')`,
    args: [Math.floor(Date.now() / 1000), ...activeFingerprints],
  });
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
