import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetM365Findings,
  usePatchM365Finding,
  useGetM365Drift,
  getGetM365FindingsQueryKey,
  type FindingWithState,
  type FindingSeverity,
  type FindingStatus,
  type DriftEntry,
} from "@workspace/api-client-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Card, CardContent } from "@workspace/ui-kit/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@workspace/ui-kit/input";
import { Skeleton } from "@workspace/ui-kit/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui-kit/table";
import { ErrorPanel, RefreshIndicator } from "@/components/ErrorPanel";
import { TableSkeleton } from "@/components/TableSkeleton";
import { getCollectionIssues, summarizeIssues } from "@/lib/collectionStatus";

import { CHECK_STATUS_LABEL, SEVERITY_BADGE_CLASS } from "@/lib/statusTokens";

const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];
const STATUS_OPTIONS: FindingStatus[] = ["open", "acknowledged", "remediated", "suppressed"];

const SEVERITY_STYLES = SEVERITY_BADGE_CLASS;

function DriftColumn({ title, entries, tone }: { title: string; entries: DriftEntry[]; tone: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className={`text-sm font-semibold mb-2 ${tone}`}>{title} ({entries.length})</p>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <ul className="space-y-1">
            {entries.map((e) => (
              <li key={e.fingerprint} className="text-xs">
                <span className="capitalize text-muted-foreground">[{e.severity}]</span> {e.title}
                {e.previousCheckStatus && (
                  <span className="text-muted-foreground"> ({e.previousCheckStatus} → {e.checkStatus})</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function FindingsTab() {
  const [severityFilter, setSeverityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [search, setSearch] = useState("");

  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, isError, error, refetch } = useGetM365Findings();
  const { data: drift } = useGetM365Drift();
  const loading = isLoading;
  const issue = summarizeIssues(getCollectionIssues(data));

  const patch = usePatchM365Finding({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetM365FindingsQueryKey() });
      },
    },
  });

  const findings = useMemo(() => data?.findings ?? [], [data]);
  const summary = data?.summary;

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(findings.map((f) => f.category))).sort()],
    [findings],
  );

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (severityFilter !== "All" && f.severity !== severityFilter) return false;
      if (statusFilter !== "All" && f.status !== statusFilter) return false;
      if (categoryFilter !== "All" && f.category !== categoryFilter) return false;
      if (search && !`${f.title} ${f.description}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [findings, severityFilter, statusFilter, categoryFilter, search]);

  const updateField = (f: FindingWithState, field: "status" | "owner" | "notes", value: string) => {
    patch.mutate({ fingerprint: f.fingerprint, data: { [field]: value } });
  };

  const openCount = summary?.byStatus?.open ?? 0;

  const hasDrift =
    drift && (drift.added.length > 0 || drift.resolved.length > 0 || drift.changed.length > 0);

  if (isError) {
    return <ErrorPanel title="Couldn't load the findings register" error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="relative space-y-4">
      <RefreshIndicator active={isFetching && !isLoading} />
      <CollapsibleSection
        title="What Changed Since Last Scan"
        description="Findings that appeared, were resolved, or changed between the two most recent scans"
        storageKey="findings-drift"
        defaultOpen={true}
        density="compact"
      >
        {!drift || !drift.fromScanId ? (
          <p className="text-sm text-muted-foreground">
            Not enough scan history yet. Drift appears once at least two scans have been recorded.
          </p>
        ) : !hasDrift ? (
          <p className="text-sm text-muted-foreground">No changes since the previous scan.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <DriftColumn title="New" entries={drift.added} tone="text-red-600 dark:text-red-400" />
            <DriftColumn title="Resolved" entries={drift.resolved} tone="text-green-600 dark:text-green-400" />
            <DriftColumn title="Changed" entries={drift.changed} tone="text-yellow-600 dark:text-yellow-400" />
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Findings Summary"
        description="Consolidated remediation register across Security and Compliance"
        storageKey="findings-summary"
        defaultOpen={true}
        density="compact"
        issue={issue}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {SEVERITY_ORDER.map((sev) => (
            <Card key={sev}>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground capitalize">{sev}</p>
                {loading ? (
                  <Skeleton className="h-7 w-10 mx-auto mt-1" />
                ) : (
                  <p className="text-2xl font-bold mt-0.5">{summary?.bySeverity?.[sev] ?? 0}</p>
                )}
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Open</p>
              {loading ? (
                <Skeleton className="h-7 w-10 mx-auto mt-1" />
              ) : (
                <p className="text-2xl font-bold mt-0.5 text-red-600 dark:text-red-400">{openCount}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        sectionId="findings-register"
        title="Findings Register"
        description="Filter, assign, and track remediation of each finding"
        storageKey="findings-register"
        defaultOpen={true}
        density="compact"
      >
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Input
              placeholder="Search findings…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-60 text-sm"
            />
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="All">All Severities</option>
              {SEVERITY_ORDER.map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="All">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c === "All" ? "All Categories" : c}</option>
              ))}
            </select>
          </div>

          <Card>
            <CardContent className="p-0">
              {loading ? (
                <TableSkeleton rows={8} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4 h-8 w-[90px]">Severity</TableHead>
                      <TableHead className="h-8">Finding</TableHead>
                      <TableHead className="h-8 w-[110px]">Category</TableHead>
                      <TableHead className="h-8 w-[90px]">Check</TableHead>
                      <TableHead className="h-8 w-[140px]">Status</TableHead>
                      <TableHead className="h-8 w-[140px]">Owner</TableHead>
                      <TableHead className="h-8 w-[200px]">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                          No findings match the current filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((f) => (
                        <TableRow key={f.fingerprint}>
                          <TableCell className="pl-4 py-2 align-top">
                            <Badge className={`${SEVERITY_STYLES[f.severity]} font-normal text-xs border-0 capitalize`}>
                              {f.severity}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2 align-top">
                            <p className="text-sm font-medium">{f.title}</p>
                            <p className="text-xs text-muted-foreground">{f.description}</p>
                            {f.remediation && (
                              <p className="text-[11px] text-muted-foreground mt-1">
                                <span className="font-medium">Fix:</span> {f.remediation}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="py-2 align-top text-xs capitalize">{f.category}</TableCell>
                          <TableCell className="py-2 align-top text-xs">{CHECK_STATUS_LABEL[f.checkStatus] ?? f.checkStatus}</TableCell>
                          <TableCell className="py-2 align-top">
                            <select
                              value={f.status}
                              onChange={(e) => updateField(f, "status", e.target.value)}
                              className="h-8 rounded-md border bg-background px-2 text-xs capitalize w-full"
                            >
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s} className="capitalize">{s}</option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell className="py-2 align-top">
                            {/* Keyed on the server value so a refetched change remounts with fresh data
                                (an uncontrolled defaultValue alone goes stale). */}
                            <Input
                              key={`owner-${f.owner ?? ""}`}
                              defaultValue={f.owner ?? ""}
                              placeholder="Unassigned"
                              onBlur={(e) => {
                                if (e.target.value !== (f.owner ?? "")) updateField(f, "owner", e.target.value);
                              }}
                              className="h-8 text-xs"
                            />
                          </TableCell>
                          <TableCell className="py-2 align-top">
                            <Input
                              key={`notes-${f.stateNotes ?? ""}`}
                              defaultValue={f.stateNotes ?? ""}
                              placeholder="Add note…"
                              onBlur={(e) => {
                                if (e.target.value !== (f.stateNotes ?? "")) updateField(f, "notes", e.target.value);
                              }}
                              className="h-8 text-xs"
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </CollapsibleSection>
    </div>
  );
}
