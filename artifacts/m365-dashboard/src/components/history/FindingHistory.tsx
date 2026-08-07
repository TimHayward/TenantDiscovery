import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import type { FindingWithState, ScanDetail, ScanRun } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@workspace/ui-kit/card";
import { Input } from "@workspace/ui-kit/input";
import { DataTable } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { CHECK_STATUS_LABEL, SEVERITY_BADGE_CLASS } from "@/lib/statusTokens";
import { SEVERITY_ORDER, isKnownSeverity } from "./severitySeries";
import { NotArchived, SummaryOnlyNote } from "./SummaryOnlyNote";

/** The same rule the drift endpoint applies: anything that is not a pass is live work. */
function isActionable(checkStatus: string): boolean {
  return checkStatus !== "pass";
}

function severityBadgeClass(severity: string): string {
  return isKnownSeverity(severity) ? SEVERITY_BADGE_CLASS[severity] : "bg-muted text-muted-foreground";
}

function checkStatusLabel(status: string): string {
  return CHECK_STATUS_LABEL[status] ?? status;
}

function formatMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export interface FindingCandidate {
  fingerprint: string;
  title: string;
  category: string;
  /** Severity at the most recent scan in which the finding appears. */
  latestSeverity: string;
  latestCheckStatus: string;
  scansSeen: number;
  /** Whether the finding is still in the live register. */
  inRegister: boolean;
}

type EventKind =
  | "appeared"
  | "resolved"
  | "reopened"
  | "severity"
  | "status"
  | "carried"
  | "manual"
  | "register";

interface TimelineEvent {
  at: string;
  kind: EventKind;
  headline: string;
  detail?: string;
  /** Where the fact came from, so an evidence pack can be checked against it. */
  source: string;
}

const EVENT_TONE: Record<EventKind, string> = {
  appeared: "bg-red-500",
  resolved: "bg-green-600",
  reopened: "bg-orange-500",
  severity: "bg-amber-500",
  status: "bg-amber-500",
  carried: "bg-muted-foreground",
  manual: "bg-blue-500",
  register: "bg-muted-foreground",
};

/**
 * Every fingerprint the retained scans or the live register know about.
 *
 * The register is included because a finding that first appeared after the last
 * archived scan would otherwise be invisible here, and excluded findings would
 * be exactly the newest ones.
 */
export function buildCandidates(
  windowed: ScanRun[],
  details: Map<string, ScanDetail>,
  register: FindingWithState[],
): FindingCandidate[] {
  const byFingerprint = new Map<string, FindingCandidate>();

  // Oldest first, so the last write for a fingerprint is its most recent state.
  for (const run of windowed) {
    for (const finding of details.get(run.id)?.findings ?? []) {
      const existing = byFingerprint.get(finding.fingerprint);
      byFingerprint.set(finding.fingerprint, {
        fingerprint: finding.fingerprint,
        title: finding.title,
        category: finding.category,
        latestSeverity: finding.severity,
        latestCheckStatus: finding.checkStatus,
        scansSeen: (existing?.scansSeen ?? 0) + 1,
        inRegister: false,
      });
    }
  }

  for (const finding of register) {
    const existing = byFingerprint.get(finding.fingerprint);
    byFingerprint.set(finding.fingerprint, {
      fingerprint: finding.fingerprint,
      title: finding.title,
      category: finding.category,
      latestSeverity: finding.severity,
      latestCheckStatus: finding.checkStatus,
      scansSeen: existing?.scansSeen ?? 0,
      inRegister: true,
    });
  }

  return [...byFingerprint.values()].sort((a, b) => {
    const bySeverity =
      SEVERITY_ORDER.indexOf(a.latestSeverity as (typeof SEVERITY_ORDER)[number]) -
      SEVERITY_ORDER.indexOf(b.latestSeverity as (typeof SEVERITY_ORDER)[number]);
    return bySeverity !== 0 ? bySeverity : a.title.localeCompare(b.title);
  });
}

/**
 * The event list for one finding: what the archive says, in order, with the one
 * manual state change the API retains folded in at its own timestamp.
 *
 * Transitions are read between consecutive retained scans, so the earliest
 * event carries the caveat that history before the retained window is gone.
 * `firstSeen` and `lastSeen` come from the live register, which tracks them
 * independently of scan retention, and are shown as separate anchors rather
 * than mixed into the derived transitions.
 */
export function buildTimeline(
  fingerprint: string,
  windowed: ScanRun[],
  details: Map<string, ScanDetail>,
  registerEntry: FindingWithState | undefined,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let previous: { severity: string; checkStatus: string } | null = null;
  let previouslyActionable = false;
  let everSeen = false;

  for (const run of windowed) {
    const detail = details.get(run.id);
    if (!detail) continue;
    const current = detail.findings.find((finding) => finding.fingerprint === fingerprint);
    const at = run.startedAt;

    if (!current) {
      if (previous && previouslyActionable) {
        events.push({
          at,
          kind: "resolved",
          headline: "Resolved",
          detail: "No longer produced by the rules at this scan.",
          source: `Scan ${detail.id}`,
        });
      }
      previous = null;
      previouslyActionable = false;
      continue;
    }

    const actionable = isActionable(current.checkStatus);

    if (!previous) {
      events.push({
        at,
        kind: everSeen ? "reopened" : "appeared",
        headline: everSeen ? "Reopened" : "First seen in the retained history",
        detail: `${current.severity} · ${checkStatusLabel(current.checkStatus)}`,
        source: `Scan ${detail.id}`,
      });
    } else {
      if (previouslyActionable && !actionable) {
        events.push({
          at,
          kind: "resolved",
          headline: "Moved to Pass",
          detail: `${checkStatusLabel(previous.checkStatus)} → ${checkStatusLabel(current.checkStatus)}`,
          source: `Scan ${detail.id}`,
        });
      } else if (!previouslyActionable && actionable) {
        events.push({
          at,
          kind: "reopened",
          headline: "Reopened",
          detail: `${checkStatusLabel(previous.checkStatus)} → ${checkStatusLabel(current.checkStatus)}`,
          source: `Scan ${detail.id}`,
        });
      } else if (previous.checkStatus !== current.checkStatus) {
        events.push({
          at,
          kind: "status",
          headline: "Check status changed",
          detail: `${checkStatusLabel(previous.checkStatus)} → ${checkStatusLabel(current.checkStatus)}`,
          source: `Scan ${detail.id}`,
        });
      }
      if (previous.severity !== current.severity) {
        events.push({
          at,
          kind: "severity",
          headline: "Severity changed",
          detail: `${previous.severity} → ${current.severity}`,
          source: `Scan ${detail.id}`,
        });
      }
    }

    everSeen = true;
    previous = { severity: current.severity, checkStatus: current.checkStatus };
    previouslyActionable = actionable;
  }

  if (registerEntry) {
    events.push({
      at: registerEntry.firstSeen,
      kind: "register",
      headline: "First seen",
      detail: "Recorded by the findings register, which tracks this independently of scan retention.",
      source: "Findings register",
    });
    events.push({
      at: registerEntry.lastSeen,
      kind: "register",
      headline: "Last seen",
      detail: "Most recent evaluation in which the rules produced this finding.",
      source: "Findings register",
    });
    if (registerEntry.stateUpdatedAt) {
      const parts = [`Status set to ${registerEntry.status}`];
      if (registerEntry.owner) parts.push(`owner ${registerEntry.owner}`);
      if (registerEntry.dueDate) parts.push(`due ${registerEntry.dueDate}`);
      if (registerEntry.stateNotes) parts.push(`note: ${registerEntry.stateNotes}`);
      events.push({
        at: registerEntry.stateUpdatedAt,
        kind: "manual",
        headline: "Triage state changed by hand",
        detail: parts.join(" · "),
        source: "Findings register (latest change only)",
      });
    }
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

const columns: ColumnDef<FindingCandidate>[] = [
  {
    accessorKey: "title",
    header: "Finding",
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.original.title}</p>
        <p className="text-[11px] capitalize text-muted-foreground">{row.original.category}</p>
      </div>
    ),
  },
  {
    accessorKey: "latestSeverity",
    header: "Severity",
    cell: ({ row }) => (
      <Badge
        className={`${severityBadgeClass(row.original.latestSeverity)} border-0 text-[10px] font-normal capitalize`}
      >
        {row.original.latestSeverity}
      </Badge>
    ),
  },
  {
    accessorKey: "latestCheckStatus",
    header: "Check",
    cell: ({ row }) => (
      <span className="text-xs">{checkStatusLabel(row.original.latestCheckStatus)}</span>
    ),
  },
  {
    accessorKey: "scansSeen",
    header: "Scans present",
    cell: ({ row }) => (
      <span className="text-xs tabular-nums">
        {row.original.scansSeen === 0 ? (
          <NotArchived label="Not in retained scans" />
        ) : (
          row.original.scansSeen
        )}
      </span>
    ),
  },
];

/**
 * The audit trail for a single finding: pick one, read what happened to it.
 */
export function FindingHistory({
  windowed,
  details,
  register,
  registerAvailable,
}: {
  windowed: ScanRun[];
  details: Map<string, ScanDetail>;
  register: FindingWithState[];
  /** False when the register request failed, so triage state is absent rather than empty. */
  registerAvailable: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const candidates = useMemo(
    () => buildCandidates(windowed, details, register),
    [windowed, details, register],
  );

  const registerByFingerprint = useMemo(
    () => new Map(register.map((finding) => [finding.fingerprint, finding])),
    [register],
  );

  const timeline = useMemo(
    () =>
      selected
        ? buildTimeline(selected, windowed, details, registerByFingerprint.get(selected))
        : [],
    [selected, windowed, details, registerByFingerprint],
  );

  const selectedCandidate = candidates.find((candidate) => candidate.fingerprint === selected);

  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No findings to trace"
        description="Once a scan has been recorded, each finding it produced can be followed across later scans here."
      />
    );
  }

  return (
    <div className="space-y-3">
      <SummaryOnlyNote>
        Transitions are read between consecutive retained scans, so anything that happened before
        the oldest retained scan is not recoverable. Triage state comes from the live register,
        which keeps only the latest change, not a log of every change.
      </SummaryOnlyNote>

      <Input
        placeholder="Search findings…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="h-8 w-64 text-sm"
      />

      <DataTable
        columns={columns}
        data={candidates}
        globalFilter={search}
        pageSize={8}
        rowNoun="findings"
        emptyMessage="No findings match the search."
        onRowClick={(row) => setSelected(row.fingerprint)}
        rowClassName={(row) => (row.fingerprint === selected ? "bg-muted/60" : "")}
      />

      {!selectedCandidate ? (
        <p className="text-xs text-muted-foreground">
          Select a finding to see its history.
        </p>
      ) : (
        <Card className="print:break-inside-avoid">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={`${severityBadgeClass(selectedCandidate.latestSeverity)} border-0 text-[10px] font-normal capitalize`}
              >
                {selectedCandidate.latestSeverity}
              </Badge>
              <p className="text-sm font-semibold">{selectedCandidate.title}</p>
            </div>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {selectedCandidate.fingerprint}
            </p>
            {!registerAvailable && (
              <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                The findings register could not be read, so no triage state is shown. This is a
                missing source, not an absence of triage.
              </p>
            )}
            {registerAvailable && !registerByFingerprint.has(selectedCandidate.fingerprint) && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                No longer in the live register, so its triage state is <NotArchived />.
              </p>
            )}

            {timeline.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                No recorded events for this finding within the retained scans.
              </p>
            ) : (
              <ol className="mt-3 space-y-0">
                {timeline.map((event, index) => (
                  <li key={`${event.at}-${event.kind}-${index}`} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${EVENT_TONE[event.kind]}`} />
                      {index < timeline.length - 1 && <span className="w-px flex-1 bg-border" />}
                    </div>
                    <div className="pb-3">
                      <p className="text-xs font-medium">
                        {event.headline}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {formatMoment(event.at)}
                        </span>
                      </p>
                      {event.detail && (
                        <p className="text-[11px] text-muted-foreground">{event.detail}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/70">{event.source}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
