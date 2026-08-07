import { useCallback, useMemo } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  useGetM365Scans,
  getGetM365ScanQueryOptions,
  getGetM365ScansQueryKey,
  type ScanDetail,
  type ScanRun,
} from "@workspace/api-client-react";
import {
  getCollectionIssues,
  summarizeIssues,
  type IssueSummary,
} from "@/lib/collectionStatus";

/** How many scans the tab reads detail for, and the default of those choices. */
export const WINDOW_OPTIONS = [10, 20, 50] as const;
export const DEFAULT_WINDOW = 20;

export interface ScanHistory {
  /** Every run the API returned, newest first, unfiltered. */
  runs: ScanRun[];
  /**
   * Completed runs only, oldest first, capped at the chosen window.
   *
   * A failed or in-progress run has an incomplete findings archive, so plotting
   * it would draw a dip that never happened. The tab says on screen how many
   * runs it excluded for this reason.
   */
  windowed: ScanRun[];
  /** Detail for each run in `windowed`, keyed by scan id. Absent while loading. */
  details: Map<string, ScanDetail>;
  /** Completed runs the window left out, so the tab can say so. */
  omittedCompleted: number;
  /** Runs excluded because they did not complete. */
  incompleteRuns: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  /** Number of per-scan detail requests that failed. */
  failedDetails: number;
  /**
   * Collection issues carried by the scan list, for `CollapsibleSection`'s
   * `issue` prop. The scan endpoints do not emit `collectionIssues` today, so
   * this is null in practice; reading it the same way every other section does
   * means it starts working the day they do.
   */
  issue: IssueSummary | null;
  refetch: () => void;
}

/**
 * The scan list plus per-scan detail for the most recent `windowSize` completed
 * runs.
 *
 * There is no endpoint that returns severity counts per scan, so the only way
 * to plot a trend is to read `/m365/scans/{id}` once per scan: the window exists
 * to bound that fan-out rather than to hide history. The detail requests go
 * through the generated query options rather than a hand-written fetch, so they
 * share the cache, the base URL and the error shape with every other query, and
 * `useQueries` is what lets a list of them be issued from one hook.
 */
export function useScanHistory(windowSize: number): ScanHistory {
  const queryClient = useQueryClient();
  const list = useGetM365Scans();

  const runs = useMemo(() => list.data?.scans ?? [], [list.data]);

  const { windowed, omittedCompleted, incompleteRuns } = useMemo(() => {
    const completed = runs.filter((run) => run.status === "completed");
    const recent = completed.slice(0, windowSize);
    return {
      // The API returns newest first; a time axis reads oldest first.
      windowed: [...recent].reverse(),
      omittedCompleted: completed.length - recent.length,
      incompleteRuns: runs.length - completed.length,
    };
  }, [runs, windowSize]);

  const detailQueries = useQueries({
    queries: windowed.map((run) => getGetM365ScanQueryOptions(run.id)),
  });

  const details = useMemo(() => {
    const map = new Map<string, ScanDetail>();
    for (const query of detailQueries) {
      if (query.data) map.set(query.data.id, query.data);
    }
    return map;
  }, [detailQueries]);

  const failedDetails = detailQueries.filter((query) => query.isError).length;
  const firstDetailError = detailQueries.find((query) => query.isError)?.error;

  const refetch = useCallback(() => {
    // Invalidating by prefix re-runs the list and every detail query together,
    // which is what a reader pressing Retry means, and avoids holding a
    // per-query refetch array that changes identity on every render.
    void queryClient.invalidateQueries({ queryKey: getGetM365ScansQueryKey() });
    void queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/m365/scans/"),
    });
  }, [queryClient]);

  return {
    runs,
    windowed,
    details,
    omittedCompleted,
    incompleteRuns,
    isLoading: list.isLoading || detailQueries.some((query) => query.isLoading),
    isFetching: list.isFetching || detailQueries.some((query) => query.isFetching),
    // Only the list failing is fatal for the tab: a single scan's detail failing
    // costs one point on the chart, and is reported next to the chart instead.
    isError: list.isError,
    error: list.error ?? firstDetailError,
    failedDetails,
    issue: summarizeIssues(getCollectionIssues(list.data)),
    refetch,
  };
}
