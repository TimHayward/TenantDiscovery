import type { FieldEvidenceStatus, FieldConfidenceLabel } from "../metadata.js";

/** Inherent risk ranking of a finding's rule. */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** Outcome of a control assessment (mirrors the frontend ChecklistTable taxonomy). */
export type CheckStatus = "pass" | "fail" | "warning" | "manual";

/** User-managed remediation lifecycle for a finding. */
export type FindingStatus = "open" | "acknowledged" | "remediated" | "suppressed";

/** Recognised security baselines a rule can map onto. Data-driven so more can be added. */
export type FrameworkId = "CIS-M365" | "NCSC-CE";

/** A binding from a finding/rule to a specific control in a recognised framework. */
export interface FrameworkRef {
  framework: FrameworkId;
  /** Control identifier within the framework (e.g. CIS "1.1.1", Cyber Essentials "SAC"). */
  controlId: string;
}

export const FINDING_STATUSES: FindingStatus[] = [
  "open",
  "acknowledged",
  "remediated",
  "suppressed",
];

/**
 * A canonical finding produced by the findings engine. The `fingerprint` is a
 * stable identifier (`ruleId` plus an optional target) so user lifecycle state
 * re-binds across rescans rather than duplicating.
 */
export interface Finding {
  fingerprint: string;
  ruleId: string;
  category: string;
  title: string;
  description: string;
  severity: Severity;
  checkStatus: CheckStatus;
  evidenceStatus: FieldEvidenceStatus;
  confidenceLabel: FieldConfidenceLabel;
  metricId?: string;
  remediation?: string;
  evidence?: unknown;
  /** Recognised-framework controls this finding contributes evidence to. */
  frameworks?: FrameworkRef[];
}

/** A finding joined with its persisted lifecycle state and timestamps. */
export interface FindingWithState extends Finding {
  status: FindingStatus;
  owner: string | null;
  stateNotes: string | null;
  dueDate: string | null;
  firstSeen: string;
  lastSeen: string;
  stateUpdatedAt: string | null;
}
