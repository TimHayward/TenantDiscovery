import type { ScanRun } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui-kit/table";
import { BADGE_TONE } from "@/lib/statusTokens";

const RUN_STATUS_BADGE: Record<string, string> = {
  completed: BADGE_TONE.green,
  failed: BADGE_TONE.red,
  in_progress: BADGE_TONE.blue,
};

const RUN_STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  failed: "Failed",
  in_progress: "In progress",
};

function duration(run: ScanRun): string {
  if (!run.completedAt) return "—";
  const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return "<1s";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function started(run: ScanRun): string {
  const date = new Date(run.startedAt);
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Every retained run, newest first, including the ones the trend excludes.
 *
 * A failed run is the reason a chart has a gap where a client expects a point,
 * so it has to be visible somewhere rather than quietly filtered out of every
 * view on the tab.
 */
export function ScanRunsTable({ runs }: { runs: ScanRun[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-8 pl-3 text-[11px]">Started</TableHead>
            <TableHead className="h-8 text-[11px]">Status</TableHead>
            <TableHead className="h-8 text-[11px]">Duration</TableHead>
            <TableHead className="h-8 text-[11px]">Triggered by</TableHead>
            <TableHead className="h-8 text-[11px]">Findings archived</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="whitespace-nowrap py-1.5 pl-3 text-xs">{started(run)}</TableCell>
              <TableCell className="py-1.5">
                <Badge
                  className={`${RUN_STATUS_BADGE[run.status] ?? BADGE_TONE.muted} border-0 text-[10px] font-normal`}
                >
                  {RUN_STATUS_LABEL[run.status] ?? run.status}
                </Badge>
              </TableCell>
              <TableCell className="py-1.5 text-xs tabular-nums">{duration(run)}</TableCell>
              <TableCell className="py-1.5 text-xs">{run.triggeredBy}</TableCell>
              <TableCell className="py-1.5 text-xs tabular-nums">{run.findingCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
