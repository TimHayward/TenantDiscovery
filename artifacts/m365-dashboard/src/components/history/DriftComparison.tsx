import { useEffect, useMemo, useState } from "react";
import { ArrowRight, GitCompare } from "lucide-react";
import {
  useGetM365Drift,
  getGetM365DriftQueryKey,
  type DriftEntry,
  type ScanRun,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@workspace/ui-kit/card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorPanel } from "@/components/ErrorPanel";
import { TableSkeleton } from "@/components/TableSkeleton";
import { CHECK_STATUS_LABEL, SEVERITY_BADGE_CLASS } from "@/lib/statusTokens";
import { SEVERITY_ORDER, isKnownSeverity } from "./severitySeries";
import { SummaryOnlyNote } from "./SummaryOnlyNote";

function scanLabel(run: ScanRun): string {
  const date = new Date(run.startedAt);
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} (${run.findingCount} findings)`;
}

function severityRank(severity: string): number {
  const index = SEVERITY_ORDER.indexOf(severity as (typeof SEVERITY_ORDER)[number]);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

function severityBadgeClass(severity: string): string {
  return isKnownSeverity(severity) ? SEVERITY_BADGE_CLASS[severity] : "bg-muted text-muted-foreground";
}

function checkStatusLabel(status: string): string {
  return CHECK_STATUS_LABEL[status] ?? status;
}

/** "2 critical, 1 high" for a column header. An aggregate, and labelled as one. */
function severityTally(entries: DriftEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.severity, (counts.get(entry.severity) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => severityRank(a[0]) - severityRank(b[0]))
    .map(([severity, count]) => `${count} ${severity}`)
    .join(", ");
}

function DriftColumn({
  title,
  description,
  entries,
  tone,
}: {
  title: string;
  description: string;
  entries: DriftEntry[];
  tone: string;
}) {
  // Sorted by severity for reading; the set of entries is exactly what the API
  // returned for this bucket, neither filtered nor merged.
  const sorted = useMemo(
    () => [...entries].sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    [entries],
  );
  const tally = severityTally(entries);

  return (
    <Card className="print:break-inside-avoid">
      <CardContent className="p-3">
        <p className={`text-sm font-semibold ${tone}`}>
          {title} ({entries.length})
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        {tally && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Counted by severity: {tally}
          </p>
        )}
        {sorted.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">None.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sorted.map((entry) => (
              <li key={entry.fingerprint} className="text-xs">
                <div className="flex items-start gap-1.5">
                  <Badge
                    className={`${severityBadgeClass(entry.severity)} shrink-0 border-0 text-[10px] font-normal capitalize`}
                  >
                    {entry.severity}
                  </Badge>
                  <span className="font-medium">{entry.title}</span>
                </div>
                <p className="mt-0.5 pl-1 text-[11px] capitalize text-muted-foreground">
                  {entry.category}
                  {" · "}
                  {entry.previousCheckStatus || entry.previousSeverity ? (
                    <span className="normal-case">
                      {entry.previousSeverity && entry.previousSeverity !== entry.severity && (
                        <>
                          {entry.previousSeverity} <ArrowRight className="inline h-3 w-3" />{" "}
                          {entry.severity}
                          {entry.previousCheckStatus !== entry.checkStatus ? ", " : ""}
                        </>
                      )}
                      {entry.previousCheckStatus && entry.previousCheckStatus !== entry.checkStatus && (
                        <>
                          {checkStatusLabel(entry.previousCheckStatus)}{" "}
                          <ArrowRight className="inline h-3 w-3" /> {checkStatusLabel(entry.checkStatus)}
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="normal-case">{checkStatusLabel(entry.checkStatus)}</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Drift between two chosen scans.
 *
 * The three columns are the endpoint's three arrays, rendered one for one. The
 * endpoint's own rules are printed alongside them because two of the rules
 * surprise people: a finding that moves from an actionable status to Pass is
 * reported in both Resolved and Changed, and a finding that appears already
 * passing is reported in neither. Silently deduplicating the first would make
 * this view disagree with the API and with the export, so the overlap is
 * explained rather than removed.
 */
export function DriftComparison({ completedRuns }: { completedRuns: ScanRun[] }) {
  // Newest first, which is how the API returns them and how the selectors read.
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");

  // Default to the API's own default pair, "what changed since last scan", and
  // re-seed only while the selection is empty so a reader's choice is not
  // overwritten by a background refetch of the scan list.
  useEffect(() => {
    if (completedRuns.length < 2) return;
    setToId((current) => (current ? current : completedRuns[0].id));
    setFromId((current) => (current ? current : completedRuns[1].id));
  }, [completedRuns]);

  const ready = Boolean(fromId && toId);
  const params = { from: fromId, to: toId };
  // The key has to carry the pair, or a second comparison would be served the
  // first one's answer from cache.
  const { data, isLoading, isError, error, refetch } = useGetM365Drift(params, {
    query: { queryKey: getGetM365DriftQueryKey(params), enabled: ready },
  });

  const fromRun = completedRuns.find((run) => run.id === fromId);
  const toRun = completedRuns.find((run) => run.id === toId);
  const reversed =
    fromRun && toRun && new Date(fromRun.startedAt) > new Date(toRun.startedAt);

  if (completedRuns.length === 0) {
    return (
      <EmptyState
        icon={GitCompare}
        title="No scans to compare"
        description="Drift compares two completed scans. Run a data refresh to record the first one."
      />
    );
  }

  if (completedRuns.length === 1) {
    return (
      <EmptyState
        icon={GitCompare}
        title="Only one scan so far"
        description="Drift needs two completed scans. The second one, whenever it runs, will be comparable with this one."
      />
    );
  }

  return (
    <div className="space-y-3">
      <SummaryOnlyNote>
        Drift is computed from the archived summary rows, so an entry names the finding and its
        severity but carries no description, remediation or triage state.
      </SummaryOnlyNote>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Baseline scan
          <select
            value={fromId}
            onChange={(event) => setFromId(event.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
          >
            {completedRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {scanLabel(run)}
              </option>
            ))}
          </select>
        </label>
        <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Compared scan
          <select
            value={toId}
            onChange={(event) => setToId(event.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
          >
            {completedRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {scanLabel(run)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {fromId === toId && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Both selectors name the same scan, so there is nothing to compare.
        </p>
      )}
      {reversed && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          The baseline is the later of the two scans, so "appeared" and "resolved" read backwards.
        </p>
      )}

      {isError ? (
        <ErrorPanel title="Couldn't compute drift" error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <TableSkeleton rows={4} rowClassName="h-16" className="p-0" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <DriftColumn
              title="Appeared"
              description="Not present in the baseline, and not passing in the compared scan."
              entries={data.added}
              tone="text-red-600 dark:text-red-400"
            />
            <DriftColumn
              title="Resolved"
              description="Actionable in the baseline, then dropped out or moved to Pass."
              entries={data.resolved}
              tone="text-green-600 dark:text-green-400"
            />
            <DriftColumn
              title="Changed"
              description="Present in both, with a different severity or check status."
              entries={data.changed}
              tone="text-amber-600 dark:text-amber-400"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            The three lists are the endpoint's own, entry for entry. A finding that moved from an
            actionable status to Pass is reported in both Resolved and Changed, so the three counts
            can exceed the number of distinct findings that moved. A finding that appears already
            passing is reported in none of the three.
          </p>
        </>
      )}
    </div>
  );
}
