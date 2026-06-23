import { getMetricDataSourceEntry } from "@workspace/permissions-manifest";
import type { FieldEvidenceStatus, FieldConfidenceLabel } from "../../metadata.js";
import type { CheckStatus, Finding, Severity } from "../types.js";

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
  /** Returns the assessment outcomes, or null when the metric is unavailable. */
  evaluate: (data: T | null) => RuleOutcome[] | null;
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
  }));
}
