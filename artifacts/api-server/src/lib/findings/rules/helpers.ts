import { getMetricDataSourceEntry } from "@workspace/permissions-manifest";
import type { FieldEvidenceStatus, FieldConfidenceLabel } from "../../metadata.js";
import type { CheckStatus, Finding, Severity } from "../types.js";

/**
 * A rule definition. `evaluate` inspects the relevant metric snapshot and returns
 * the current outcome; everything else is static metadata used to build the Finding.
 */
export interface RuleDefinition<T> {
  ruleId: string;
  category: string;
  title: string;
  description: string;
  severity: Severity;
  metricId: string;
  remediation?: string;
  /** Returns the assessment outcome, or null when the metric is unavailable. */
  evaluate: (data: T | null) => { checkStatus: CheckStatus; detail?: string; evidence?: unknown } | null;
}

/**
 * Resolve a rule against metric data into a Finding. Evidence/confidence are pulled
 * from the central manifest registry (single source of truth) with sane fallbacks.
 */
export function runRule<T>(rule: RuleDefinition<T>, data: T | null): Finding | null {
  const outcome = rule.evaluate(data);
  if (!outcome) return null;

  const registry = getMetricDataSourceEntry(rule.metricId);
  const evidenceStatus = (registry?.evidenceStatus ?? "notAssessed") as FieldEvidenceStatus;
  const confidenceLabel = (registry?.confidenceLabel ?? "unknown") as FieldConfidenceLabel;

  return {
    fingerprint: rule.ruleId,
    ruleId: rule.ruleId,
    category: rule.category,
    title: rule.title,
    description: outcome.detail ? `${rule.description} — ${outcome.detail}` : rule.description,
    severity: rule.severity,
    checkStatus: outcome.checkStatus,
    evidenceStatus,
    confidenceLabel,
    metricId: rule.metricId,
    remediation: rule.remediation,
    evidence: outcome.evidence,
  };
}
