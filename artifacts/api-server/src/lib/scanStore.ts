import { randomUUID } from "node:crypto";
import { getClient } from "./metricStore.js";
import { regenerateFindings, autoCloseResolved } from "./findings/store.js";
import type { Finding } from "./findings/types.js";

const DEFAULT_HISTORY_LIMIT = 50;

function historyLimit(): number {
  const raw = process.env.SCAN_HISTORY_LIMIT?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_HISTORY_LIMIT;
}

function toIso(seconds: unknown): string | null {
  return seconds == null ? null : new Date((seconds as number) * 1000).toISOString();
}

export interface ScanRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  triggeredBy: string;
  findingCount: number;
}

/**
 * Record a scan: snapshot the current metric store into history, regenerate and
 * archive findings, auto-close resolved findings, and prune old scans. Returns the
 * new scan id. Collectors are NOT run here — callers run them first.
 */
export async function recordScan(triggeredBy: string, startedAtMs?: number): Promise<string> {
  const client = await getClient();
  const id = randomUUID();
  const startedAt = Math.floor((startedAtMs ?? Date.now()) / 1000);

  await client.execute({
    sql: `INSERT INTO scan_runs (id, started_at, completed_at, status, triggered_by)
          VALUES (?, ?, NULL, 'in_progress', ?)`,
    args: [id, startedAt, triggeredBy],
  });

  try {
    // Archive the current metric snapshots.
    const snaps = await client.execute({
      sql: "SELECT key, data, fetched_at, status, error_msg FROM metric_snapshots",
      args: [],
    });

    // Regenerate findings from the latest snapshots and archive them.
    const findings: Finding[] = await regenerateFindings();

    // One batch rather than a loop of awaited statements: a scan of any size
    // costs a single round trip, and the whole archive commits together or not
    // at all, so a failure part way through cannot leave a half-archived scan.
    const statements = [
      ...snaps.rows.map((row) => ({
        sql: `INSERT INTO metric_snapshots_history (scan_id, key, data, fetched_at, status, error_msg)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          id, row.key as string, row.data as string,
          row.fetched_at as number, row.status as string, (row.error_msg as string | null) ?? null,
        ] as (string | number | null)[],
      })),
      ...findings.map((f) => ({
        sql: `INSERT INTO findings_history
                (scan_id, fingerprint, rule_id, category, title, severity, check_status, evidence_status, confidence_label)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, f.fingerprint, f.ruleId, f.category, f.title, f.severity,
          f.checkStatus, f.evidenceStatus, f.confidenceLabel,
        ] as (string | number | null)[],
      })),
    ];
    if (statements.length > 0) {
      await client.batch(statements, "write");
    }

    await autoCloseResolved(findings.map((f) => f.fingerprint));

    await client.execute({
      sql: "UPDATE scan_runs SET completed_at = ?, status = 'completed' WHERE id = ?",
      args: [Math.floor(Date.now() / 1000), id],
    });
  } catch (err) {
    await client.execute({
      sql: "UPDATE scan_runs SET completed_at = ?, status = 'failed' WHERE id = ?",
      args: [Math.floor(Date.now() / 1000), id],
    });
    throw err;
  }

  await pruneOldScans();
  return id;
}

/** Keep only the most recent N completed scans; delete archived data for the rest. */
export async function pruneOldScans(): Promise<void> {
  const client = await getClient();
  const limit = historyLimit();
  const old = await client.execute({
    sql: `SELECT id FROM scan_runs ORDER BY started_at DESC LIMIT -1 OFFSET ?`,
    args: [limit],
  });
  if (old.rows.length === 0) return;

  // Same reasoning as the archive in `recordScan`: one round trip, and the three
  // deletes for a scan commit together, so a pruned scan cannot survive as an
  // orphaned run row with its history already gone.
  const statements = old.rows.flatMap((row) => {
    const sid = row.id as string;
    return [
      { sql: "DELETE FROM metric_snapshots_history WHERE scan_id = ?", args: [sid] },
      { sql: "DELETE FROM findings_history WHERE scan_id = ?", args: [sid] },
      { sql: "DELETE FROM scan_runs WHERE id = ?", args: [sid] },
    ];
  });
  await client.batch(statements, "write");
}

export async function listScans(): Promise<ScanRun[]> {
  const client = await getClient();
  const result = await client.execute({
    sql: `SELECT r.*, (SELECT COUNT(*) FROM findings_history h WHERE h.scan_id = r.id) AS finding_count
          FROM scan_runs r ORDER BY r.started_at DESC`,
    args: [],
  });
  return result.rows.map((row) => ({
    id: row.id as string,
    startedAt: toIso(row.started_at)!,
    completedAt: toIso(row.completed_at),
    status: row.status as string,
    triggeredBy: row.triggered_by as string,
    findingCount: Number(row.finding_count ?? 0),
  }));
}

export interface ScanDetail extends ScanRun {
  snapshotKeys: string[];
  findings: Array<{
    fingerprint: string;
    ruleId: string;
    category: string;
    title: string;
    severity: string;
    checkStatus: string;
  }>;
}

export async function getScan(id: string): Promise<ScanDetail | null> {
  const client = await getClient();
  const runRes = await client.execute({ sql: "SELECT * FROM scan_runs WHERE id = ?", args: [id] });
  const run = runRes.rows[0];
  if (!run) return null;

  const snapRes = await client.execute({
    sql: "SELECT key FROM metric_snapshots_history WHERE scan_id = ? ORDER BY key",
    args: [id],
  });
  const findRes = await client.execute({
    sql: `SELECT fingerprint, rule_id, category, title, severity, check_status
          FROM findings_history WHERE scan_id = ?`,
    args: [id],
  });

  return {
    id: run.id as string,
    startedAt: toIso(run.started_at)!,
    completedAt: toIso(run.completed_at),
    status: run.status as string,
    triggeredBy: run.triggered_by as string,
    findingCount: findRes.rows.length,
    snapshotKeys: snapRes.rows.map((r) => r.key as string),
    findings: findRes.rows.map((r) => ({
      fingerprint: r.fingerprint as string,
      ruleId: r.rule_id as string,
      category: r.category as string,
      title: r.title as string,
      severity: r.severity as string,
      checkStatus: r.check_status as string,
    })),
  };
}

export interface DriftEntry {
  fingerprint: string;
  title: string;
  category: string;
  severity: string;
  checkStatus: string;
  previousCheckStatus?: string;
  previousSeverity?: string;
}

export interface DriftReport {
  fromScanId: string | null;
  toScanId: string | null;
  added: DriftEntry[];
  resolved: DriftEntry[];
  changed: DriftEntry[];
}

interface HistRow {
  fingerprint: string;
  title: string;
  category: string;
  severity: string;
  checkStatus: string;
}

async function findingsForScan(scanId: string): Promise<Map<string, HistRow>> {
  const client = await getClient();
  const res = await client.execute({
    sql: `SELECT fingerprint, title, category, severity, check_status
          FROM findings_history WHERE scan_id = ?`,
    args: [scanId],
  });
  const map = new Map<string, HistRow>();
  for (const r of res.rows) {
    map.set(r.fingerprint as string, {
      fingerprint: r.fingerprint as string,
      title: r.title as string,
      category: r.category as string,
      severity: r.severity as string,
      checkStatus: r.check_status as string,
    });
  }
  return map;
}

/**
 * Compute drift between two scans. When ids are omitted, defaults to the two most
 * recent scans ("what changed since last scan"). A finding is "added" if it newly
 * fails/warns/needs-manual, "resolved" if it dropped or moved to pass, "changed"
 * if its severity or check status differs.
 */
export async function computeDrift(fromId?: string, toId?: string): Promise<DriftReport> {
  const scans = await listScans();
  const resolvedTo = toId ?? scans[0]?.id ?? null;
  const resolvedFrom = fromId ?? scans[1]?.id ?? null;

  if (!resolvedTo || !resolvedFrom) {
    return { fromScanId: resolvedFrom, toScanId: resolvedTo, added: [], resolved: [], changed: [] };
  }

  const [from, to] = await Promise.all([
    findingsForScan(resolvedFrom),
    findingsForScan(resolvedTo),
  ]);

  const added: DriftEntry[] = [];
  const resolved: DriftEntry[] = [];
  const changed: DriftEntry[] = [];

  const isActionable = (s: string) => s !== "pass";

  for (const [fp, cur] of to) {
    const prev = from.get(fp);
    if (!prev) {
      if (isActionable(cur.checkStatus)) added.push(entry(cur));
    } else if (cur.checkStatus !== prev.checkStatus || cur.severity !== prev.severity) {
      changed.push({ ...entry(cur), previousCheckStatus: prev.checkStatus, previousSeverity: prev.severity });
    }
  }
  for (const [fp, prev] of from) {
    const cur = to.get(fp);
    // Resolved: dropped entirely, or moved from actionable to pass.
    if (!cur && isActionable(prev.checkStatus)) {
      resolved.push(entry(prev));
    } else if (cur && isActionable(prev.checkStatus) && !isActionable(cur.checkStatus)) {
      resolved.push(entry(cur));
    }
  }

  return { fromScanId: resolvedFrom, toScanId: resolvedTo, added, resolved, changed };
}

function entry(r: HistRow): DriftEntry {
  return {
    fingerprint: r.fingerprint,
    title: r.title,
    category: r.category,
    severity: r.severity,
    checkStatus: r.checkStatus,
  };
}
