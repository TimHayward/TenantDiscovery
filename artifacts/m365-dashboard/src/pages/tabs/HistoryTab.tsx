import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { useGetM365Findings } from "@workspace/api-client-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { EmptyState } from "@/components/EmptyState";
import { ErrorPanel, RefreshIndicator } from "@/components/ErrorPanel";
import { TableSkeleton } from "@/components/TableSkeleton";
import { DriftComparison } from "@/components/history/DriftComparison";
import { FindingHistory } from "@/components/history/FindingHistory";
import { ScanRunsTable } from "@/components/history/ScanRunsTable";
import {
  SeverityTrendChart,
  SingleScanSnapshot,
  buildTrendPoints,
} from "@/components/history/SeverityTrendChart";
import { SummaryOnlyNote } from "@/components/history/SummaryOnlyNote";
import {
  DEFAULT_WINDOW,
  WINDOW_OPTIONS,
  useScanHistory,
} from "@/components/history/useScanHistory";

/**
 * The scan archive, made visible.
 *
 * The backend has archived a snapshot and a findings summary on every run for
 * some time, and computed drift between any two of them, without any of it
 * reaching a screen. This tab is that data and nothing else: it adds no
 * derivation the API does not already perform, and it says on screen wherever
 * it aggregates or where the archive is thinner than the live view.
 */
export function HistoryTab() {
  const [windowSize, setWindowSize] = useState<number>(DEFAULT_WINDOW);
  const history = useScanHistory(windowSize);

  // The live register supplies the triage state and the register's own
  // first/last seen, neither of which is archived per scan.
  const register = useGetM365Findings();
  const registerFindings = useMemo(() => register.data?.findings ?? [], [register.data]);

  const points = useMemo(
    () => buildTrendPoints(history.windowed, history.details),
    [history.windowed, history.details],
  );

  const completedRuns = useMemo(
    () => history.runs.filter((run) => run.status === "completed"),
    [history.runs],
  );

  if (history.isError) {
    return (
      <ErrorPanel
        title="Couldn't load the scan history"
        error={history.error}
        onRetry={history.refetch}
      />
    );
  }

  // The empty case is the first thing a new installation sees, so it is one
  // explanation rather than four sections each reporting nothing.
  if (!history.isLoading && history.runs.length === 0) {
    return (
      <div className="relative space-y-4">
        <RefreshIndicator active={history.isFetching} />
        <EmptyState
          icon={CalendarClock}
          title="No scans recorded yet"
          description="A scan is archived each time data is collected. Press Refresh Data in the header to record the first one; the trend and drift views appear once there are two."
        />
      </div>
    );
  }

  return (
    <div className="relative space-y-4">
      <RefreshIndicator active={history.isFetching && !history.isLoading} />

      <CollapsibleSection
        title="Scan Runs"
        description="Every retained run, newest first"
        storageKey="history-scans"
        sectionId="history-scans"
        defaultOpen={true}
        density="compact"
        issue={history.issue}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {history.runs.length} retained run{history.runs.length === 1 ? "" : "s"}. Older runs
              are pruned by the server once the retention limit is reached, and are not recoverable
              from here.
            </p>
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground print:hidden">
              Read detail for
              <select
                value={windowSize}
                onChange={(event) => setWindowSize(Number(event.target.value))}
                className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
              >
                {WINDOW_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    the {option} most recent
                  </option>
                ))}
              </select>
            </label>
          </div>
          {history.isLoading ? (
            <TableSkeleton rows={5} className="p-0" />
          ) : (
            <ScanRunsTable runs={history.runs} />
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Severity Trend Across Scans"
        description="One line per severity, one point per scan"
        storageKey="history-trend"
        sectionId="history-trend"
        defaultOpen={true}
        issue={history.issue}
      >
        <SummaryOnlyNote>
          The counts are of archived findings, so they follow the rules as they were evaluated at
          each scan. A rule added later does not retrospectively appear in earlier scans.
        </SummaryOnlyNote>

        {history.isLoading ? (
          <TableSkeleton rows={6} rowClassName="h-10" className="p-0" />
        ) : points.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No completed scans to plot"
            description="Every retained run either failed or is still in progress, so there are no archived findings to count."
          />
        ) : points.length === 1 ? (
          <SingleScanSnapshot point={points[0]} />
        ) : (
          <SeverityTrendChart points={points} />
        )}

        {(history.omittedCompleted > 0 || history.incompleteRuns > 0 || history.failedDetails > 0) && (
          <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            {history.omittedCompleted > 0 && (
              <p>
                {history.omittedCompleted} older completed scan
                {history.omittedCompleted === 1 ? " is" : "s are"} retained but outside the chosen
                window and not plotted.
              </p>
            )}
            {history.incompleteRuns > 0 && (
              <p>
                {history.incompleteRuns} run{history.incompleteRuns === 1 ? "" : "s"} did not
                complete and {history.incompleteRuns === 1 ? "is" : "are"} excluded: a partial
                archive would draw a fall that never happened.
              </p>
            )}
            {history.failedDetails > 0 && (
              <p>
                {history.failedDetails} scan{history.failedDetails === 1 ? "" : "s"} could not be
                read and {history.failedDetails === 1 ? "is" : "are"} shown as a gap in the line,
                not as zero.
              </p>
            )}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Drift Between Two Scans"
        description="What appeared, what resolved, and what changed severity or status"
        storageKey="history-drift"
        sectionId="history-drift"
        defaultOpen={true}
        issue={history.issue}
      >
        {history.isLoading ? (
          <TableSkeleton rows={4} rowClassName="h-16" className="p-0" />
        ) : (
          <DriftComparison completedRuns={completedRuns} />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Per-Finding History"
        description="First seen, resolved and reopened, with the manual triage change interleaved"
        storageKey="history-finding"
        sectionId="history-finding"
        defaultOpen={false}
        issue={history.issue}
      >
        {history.isLoading ? (
          <TableSkeleton rows={6} className="p-0" />
        ) : (
          <FindingHistory
            windowed={history.windowed}
            details={history.details}
            register={registerFindings}
            registerAvailable={!register.isError}
          />
        )}
      </CollapsibleSection>
    </div>
  );
}
