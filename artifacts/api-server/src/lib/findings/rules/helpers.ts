import { getMetricDataSourceEntry } from "@workspace/permissions-manifest";
import type { FieldEvidenceStatus, FieldConfidenceLabel } from "../../metadata.js";
import type { CheckStatus, Finding, FrameworkRef, Severity } from "../types.js";

/**
 * A single assessment outcome. A rule with no `target` produces one whole-tenant
 * finding; rules that evaluate per entity emit one outcome per affected entity.
 */
export interface RuleOutcome {
  checkStatus: CheckStatus;
  detail?: string;
  evidence?: unknown;
  /** Stable entity id; omitted = whole-tenant control. Forms part of the fingerprint. */
  target?: string;
  /** Human label appended to the title (e.g. a user UPN). */
  targetLabel?: string;
  /** Per-entity severity override (e.g. mapped from risk level); defaults to rule.severity. */
  severity?: Severity;
}

/**
 * A rule definition. `evaluate` inspects the relevant metric snapshot and returns
 * the current outcomes; everything else is static metadata used to build the Finding.
 */
export interface RuleDefinition<T> {
  ruleId: string;
  category: string;
  title: string;
  description: string;
  severity: Severity;
  metricId: string;
  remediation?: string;
  /** Recognised-framework controls every finding from this rule maps onto. */
  frameworks?: FrameworkRef[];
  /** Returns the assessment outcomes, or null when the metric is unavailable. */
  evaluate: (data: T | null) => RuleOutcome[] | null;
}

/**
 * Per-entity rule helper. Returns the offender outcomes as-is, or — when there are
 * none — a single whole-tenant `pass` so the control reads as satisfied (rather than
 * silent / not-assessed) in the register and framework coverage.
 */
export function entityOutcomesOrPass(
  offenders: RuleOutcome[],
  passDetail: string,
): RuleOutcome[] {
  return offenders.length > 0 ? offenders : [{ checkStatus: "pass", detail: passDetail }];
}

/** Whole days elapsed since an ISO timestamp, or null when absent/unparsable. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor((Date.now() - ms) / 86_400_000);
}

/**
 * Resolve a rule against metric data into zero or more Findings. Evidence/confidence
 * are pulled from the central manifest registry (single source of truth) with sane
 * fallbacks. Each outcome with a `target` becomes its own per-entity finding.
 */
export function runRule<T>(rule: RuleDefinition<T>, data: T | null): Finding[] {
  const outcomes = rule.evaluate(data);
  if (!outcomes) return [];

  const registry = getMetricDataSourceEntry(rule.metricId);
  const evidenceStatus = (registry?.evidenceStatus ?? "notAssessed") as FieldEvidenceStatus;
  const confidenceLabel = (registry?.confidenceLabel ?? "unknown") as FieldConfidenceLabel;

  return outcomes.map((outcome) => ({
    fingerprint: outcome.target ? `${rule.ruleId}:${outcome.target}` : rule.ruleId,
    ruleId: rule.ruleId,
    category: rule.category,
    title: outcome.targetLabel ? `${rule.title} — ${outcome.targetLabel}` : rule.title,
    description: outcome.detail ? `${rule.description} — ${outcome.detail}` : rule.description,
    severity: outcome.severity ?? rule.severity,
    checkStatus: outcome.checkStatus,
    evidenceStatus,
    confidenceLabel,
    metricId: rule.metricId,
    remediation: rule.remediation,
    evidence: outcome.evidence,
    frameworks: rule.frameworks,
  }));
}
