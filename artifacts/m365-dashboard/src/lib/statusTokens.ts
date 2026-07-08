/**
 * Canonical badge tokens for the dashboard's status/severity/risk concepts.
 *
 * Resolves the drift the review flagged: "low" was blue in one tab and yellow
 * in another; "manual" was muted in one place and blue in another. These maps
 * are the single source of truth — consume them everywhere instead of
 * re-declaring per-tab colour maps.
 *
 * Note: finding **severity** (a 5-level scale) and identity-protection **risk**
 * (a distinct 3-level scale) are intentionally kept as separate maps — they are
 * different concepts that merely share some label words. Only genuine
 * duplication is removed, not the semantic distinction.
 */
import type { FindingSeverity } from "@workspace/api-client-react";
import type { ConfidenceLabel, EvidenceStatus } from "@workspace/permissions-manifest";

/** Shared colour tones (Tailwind light+dark badge classes). */
export const BADGE_TONE = {
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  muted: "bg-muted text-muted-foreground",
} as const;

// ── Finding severity (critical → info) ──────────────────────────────────────
export const SEVERITY_BADGE_CLASS: Record<FindingSeverity, string> = {
  critical: BADGE_TONE.red,
  high: BADGE_TONE.orange,
  medium: BADGE_TONE.yellow,
  low: BADGE_TONE.blue,
  info: BADGE_TONE.muted,
};

// ── Identity-protection risk level (high → none) ────────────────────────────
export const RISK_BADGE_CLASS: Record<string, string> = {
  high: BADGE_TONE.red,
  medium: BADGE_TONE.orange,
  low: BADGE_TONE.yellow,
  none: BADGE_TONE.muted,
};

// ── Check / coverage status ─────────────────────────────────────────────────
// "manual" is canonically blue (distinct from "notAssessed" muted).
export const CHECK_STATUS_BADGE_CLASS: Record<string, string> = {
  pass: BADGE_TONE.green,
  fail: BADGE_TONE.red,
  warning: BADGE_TONE.yellow,
  manual: BADGE_TONE.blue,
  notAssessed: BADGE_TONE.muted,
};

export const CHECK_STATUS_LABEL: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  warning: "Review",
  manual: "Manual",
  notAssessed: "Not assessed",
};

// ── Evidence provenance / confidence (previously triplicated in KPICard and
// ChecklistTable) ────────────────────────────────────────────────────────────
export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, string> = {
  apiBacked: "API-backed",
  partial: "Partial",
  manual: "Manual",
  automationCandidate: "Automation candidate",
  notAssessed: "Not assessed",
};

export const CONFIDENCE_LABEL: Record<ConfidenceLabel, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  unknown: "Unknown confidence",
};
