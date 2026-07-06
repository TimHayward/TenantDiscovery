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

/** Shared colour tones (Tailwind light+dark badge classes). */
const TONE = {
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  muted: "bg-muted text-muted-foreground",
} as const;

// ── Finding severity (critical → info) ──────────────────────────────────────
export const SEVERITY_BADGE_CLASS: Record<FindingSeverity, string> = {
  critical: TONE.red,
  high: TONE.orange,
  medium: TONE.yellow,
  low: TONE.blue,
  info: TONE.muted,
};

// ── Identity-protection risk level (high → none) ────────────────────────────
export const RISK_BADGE_CLASS: Record<string, string> = {
  high: TONE.red,
  medium: TONE.orange,
  low: TONE.yellow,
  none: TONE.muted,
};

// ── Check / coverage status ─────────────────────────────────────────────────
// "manual" is canonically blue (distinct from "notAssessed" muted).
export const CHECK_STATUS_BADGE_CLASS: Record<string, string> = {
  pass: TONE.green,
  fail: TONE.red,
  warning: TONE.yellow,
  manual: TONE.blue,
  notAssessed: TONE.muted,
};

export const CHECK_STATUS_LABEL: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  warning: "Review",
  manual: "Manual",
  notAssessed: "Not assessed",
};
