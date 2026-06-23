import { AlertTriangle, KeyRound, BadgeAlert } from "lucide-react";
import { issueKindLabel, type IssueSummary } from "@/lib/collectionStatus";

const ICONS = {
  permission: KeyRound,
  license: BadgeAlert,
  error: AlertTriangle,
} as const;

/**
 * Inline banner surfaced at the top of a section whose metrics carry one or more
 * collection issues, so an empty/zeroed section reads as "couldn't collect this"
 * rather than a genuine zero.
 */
export function SectionStatusBanner({ issue }: { issue: IssueSummary | null | undefined }) {
  if (!issue) return null;
  const Icon = ICONS[issue.kind];
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 text-xs leading-relaxed">
        <span className="font-semibold">{issueKindLabel(issue.kind)}</span>
        {issue.count > 1 ? <span className="ml-1 opacity-80">({issue.count} sources affected)</span> : null}
        <span className="ml-1 block opacity-90 break-words">{issue.message}</span>
      </div>
    </div>
  );
}
