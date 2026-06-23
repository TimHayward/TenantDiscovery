import type { CollectionIssue } from "@workspace/api-client-react";

/**
 * Visible status a metric or section can carry when its data could not be fully
 * collected. Distinct from EvidenceStatus (which describes how a metric is
 * sourced when it *is* available) — this describes a collection failure.
 */
export type IssueKind = "permission" | "license" | "error";

export interface IssueSummary {
  kind: IssueKind;
  message: string;
  /** Number of underlying issues represented by this summary. */
  count: number;
}

const ISSUE_LABELS: Record<IssueKind, string> = {
  permission: "Permission required",
  license: "Licence required",
  error: "Collection error",
};

export function issueKindLabel(kind: IssueKind): string {
  return ISSUE_LABELS[kind];
}

function kindFromCategory(category: CollectionIssue["category"]): IssueKind {
  if (category === "permission") return "permission";
  if (category === "license") return "license";
  return "error";
}

// Severity order so the most actionable issue wins when several are present.
const KIND_SEVERITY: Record<IssueKind, number> = { permission: 3, license: 2, error: 1 };

/**
 * Reduce a list of collection issues to a single summary for display, picking
 * the most actionable category. Optionally filter to issues whose `source`
 * contains `sourceFilter` (case-insensitive) so an individual card can show only
 * the issue relevant to it.
 */
export function summarizeIssues(
  issues: CollectionIssue[] | undefined | null,
  sourceFilter?: string,
): IssueSummary | null {
  if (!issues || issues.length === 0) return null;
  const relevant = sourceFilter
    ? issues.filter((i) => i.source.toLowerCase().includes(sourceFilter.toLowerCase()))
    : issues;
  if (relevant.length === 0) return null;

  let best = relevant[0];
  for (const issue of relevant) {
    if (KIND_SEVERITY[kindFromCategory(issue.category)] > KIND_SEVERITY[kindFromCategory(best.category)]) {
      best = issue;
    }
  }
  return { kind: kindFromCategory(best.category), message: best.message, count: relevant.length };
}

/**
 * Read a `collectionIssues` array off any API response shape without forcing the
 * caller to widen its type. Returns an empty array when absent.
 */
export function getCollectionIssues(data: unknown): CollectionIssue[] {
  if (data && typeof data === "object" && Array.isArray((data as { collectionIssues?: unknown }).collectionIssues)) {
    return (data as { collectionIssues: CollectionIssue[] }).collectionIssues;
  }
  return [];
}
