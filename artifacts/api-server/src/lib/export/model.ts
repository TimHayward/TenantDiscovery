import { getMetricDataSourceEntry } from "@workspace/permissions-manifest";
import { getFindings } from "../findings/store.js";
import { evaluateFindings } from "../findings/engine.js";
import { computeFrameworkCoverage, type FrameworkCoverage } from "../findings/frameworks/coverage.js";
import { getScan } from "../scanStore.js";
import { computeDrift, type DriftReport } from "../scanStore.js";
import type { FindingWithState } from "../findings/types.js";

export interface FindingExportRow extends Record<string, unknown> {
  severity: string;
  category: string;
  title: string;
  description: string;
  checkStatus: string;
  status: string;
  owner: string;
  dueDate: string;
  evidenceStatus: string;
  confidenceLabel: string;
  source: string;
  remediation: string;
  notes: string;
  firstSeen: string;
  lastSeen: string;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function sourceLabel(metricId?: string): string {
  if (!metricId) return "";
  const entry = getMetricDataSourceEntry(metricId);
  return entry?.dataSources?.map((d) => d.label).join("; ") ?? "";
}

function toRow(f: FindingWithState): FindingExportRow {
  return {
    severity: f.severity,
    category: f.category,
    title: f.title,
    description: f.description,
    checkStatus: f.checkStatus,
    status: f.status,
    owner: f.owner ?? "",
    dueDate: f.dueDate ?? "",
    evidenceStatus: f.evidenceStatus,
    confidenceLabel: f.confidenceLabel,
    source: sourceLabel(f.metricId),
    remediation: f.remediation ?? "",
    notes: f.stateNotes ?? "",
    firstSeen: f.firstSeen,
    lastSeen: f.lastSeen,
  };
}

export const FINDING_EXPORT_COLUMNS: Array<{ key: keyof FindingExportRow; header: string }> = [
  { key: "severity", header: "Severity" },
  { key: "category", header: "Category" },
  { key: "title", header: "Finding" },
  { key: "description", header: "Description" },
  { key: "checkStatus", header: "Check Status" },
  { key: "status", header: "Lifecycle Status" },
  { key: "owner", header: "Owner" },
  { key: "dueDate", header: "Due Date" },
  { key: "evidenceStatus", header: "Evidence" },
  { key: "confidenceLabel", header: "Confidence" },
  { key: "source", header: "Source" },
  { key: "remediation", header: "Remediation" },
  { key: "notes", header: "Notes" },
  { key: "firstSeen", header: "First Seen" },
  { key: "lastSeen", header: "Last Seen" },
];

/** Findings rows for evidence exports. When scanId is given, uses the archived scan. */
export async function getFindingRows(scanId?: string): Promise<FindingExportRow[]> {
  if (scanId) {
    const scan = await getScan(scanId);
    if (!scan) return [];
    return scan.findings
      .map((f) => ({
        severity: f.severity,
        category: f.category,
        title: f.title,
        description: "",
        checkStatus: f.checkStatus,
        status: "",
        owner: "",
        dueDate: "",
        evidenceStatus: "",
        confidenceLabel: "",
        source: "",
        remediation: "",
        notes: "",
        firstSeen: "",
        lastSeen: "",
      }))
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
  }
  const findings = await getFindings();
  return findings.map(toRow);
}

/** Per-framework coverage summary, computed from current findings. */
export interface FrameworkCoverageSummaryRow {
  framework: string;
  name: string;
  totalControls: number;
  pass: number;
  fail: number;
  warning: number;
  manual: number;
  notAssessed: number;
  coveragePercent: number;
}

/** Current framework control coverage, for exports. Always reflects live rule mapping. */
export async function getFrameworkCoverage(): Promise<FrameworkCoverage[]> {
  const findings = await evaluateFindings();
  return computeFrameworkCoverage(findings);
}

export interface ExecutiveModel {
  generatedAt: string;
  scanId: string | null;
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  topFindings: FindingExportRow[];
  drift: DriftReport;
  frameworks: FrameworkCoverageSummaryRow[];
}

/** Build the executive summary model (KPIs, severity breakdown, top findings, drift). */
export async function getExecutiveModel(scanId?: string): Promise<ExecutiveModel> {
  const rows = await getFindingRows(scanId);
  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const r of rows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    if (r.status) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }
  const topFindings = rows
    .filter((r) => r.checkStatus !== "pass")
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
    .slice(0, 15);

  const drift = await computeDrift(undefined, scanId);
  const coverage = await getFrameworkCoverage();

  return {
    generatedAt: new Date().toISOString(),
    scanId: scanId ?? null,
    total: rows.length,
    bySeverity,
    byStatus,
    topFindings,
    drift,
    frameworks: coverage.map((c) => ({ framework: c.framework, name: c.name, ...c.summary })),
  };
}
