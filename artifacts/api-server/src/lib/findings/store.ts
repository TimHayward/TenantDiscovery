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

/**
 * Regenerate findings from the latest metric snapshots and persist them to the
 * `findings` table. Upserts preserve `first_seen`; fingerprints no longer present
 * are removed from the live table (their `finding_state` rows are retained so
 * lifecycle re-binds if the finding reappears). Returns the generated findings.
 */
export async function regenerateFindings(): Promise<Finding[]> {
  const findings = await evaluateFindings();
  const client = await getClient();
  const now = Math.floor(Date.now() / 1000);

  for (const f of findings) {
    await client.execute({
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
      ],
    });
  }

  // Remove findings that were not regenerated this run.
  const fingerprints = findings.map((f) => f.fingerprint);
  if (fingerprints.length > 0) {
    const placeholders = fingerprints.map(() => "?").join(",");
    await client.execute({
      sql: `DELETE FROM findings WHERE fingerprint NOT IN (${placeholders})`,
      args: fingerprints,
    });
  } else {
    await client.execute({ sql: "DELETE FROM findings", args: [] });
  }

  return findings;
}

export interface FindingsQuery {
  severity?: string;
  status?: string;
  category?: string;
}

/** Read the consolidated register, joined with lifecycle state. */
export async function getFindings(query: FindingsQuery = {}): Promise<FindingWithState[]> {
  const client = await getClient();
  const result = await client.execute({
    sql: `SELECT f.*, s.status AS state_status, s.owner, s.notes AS state_notes,
                 s.due_date, s.updated_at AS state_updated_at
          FROM findings f
          LEFT JOIN finding_state s ON s.fingerprint = f.fingerprint
          ORDER BY
            CASE f.severity
              WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
              WHEN 'low' THEN 3 ELSE 4 END,
            f.category, f.rule_id`,
    args: [],
  });

  let rows = result.rows.map((row): FindingWithState => ({
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

  if (query.severity) rows = rows.filter((r) => r.severity === query.severity);
  if (query.status) rows = rows.filter((r) => r.status === query.status);
  if (query.category) rows = rows.filter((r) => r.category === query.category);
  return rows;
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
