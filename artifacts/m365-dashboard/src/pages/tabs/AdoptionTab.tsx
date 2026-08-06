import { useGetM365AdoptionWithMetadata } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui-kit/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@workspace/ui-kit/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ExportBtn } from "@/components/ExportBtn";
import { DataTable } from "@/components/DataTable";
import { ErrorPanel, RefreshIndicator } from "@/components/ErrorPanel";
import { TableSkeleton } from "@/components/TableSkeleton";
import { getCollectionIssues, summarizeIssues } from "@/lib/collectionStatus";
import { useChartTheme } from "@/lib/useChartTheme";
import { formatNumber } from "@/lib/utils";
import { useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import type { WorkloadAdoptionItem, WorkloadDepthMetrics } from "@workspace/api-client-react";

import { chartPalette } from "@/lib/chartPalette";

// Semantic aliases into the shared palette for this tab's period/value-gap colours.
const CHART_COLORS = {
  d30: chartPalette.blue,
  d90: chartPalette.purple,
  d180: chartPalette.green,
  valueGap: chartPalette.red,
  warning: chartPalette.warning,
};

function adoptionColor(pct: number): string {
  if (pct < 20) return CHART_COLORS.valueGap;
  if (pct < 50) return CHART_COLORS.warning;
  if (pct < 70) return CHART_COLORS.d90;
  return CHART_COLORS.d180;
}

function DepthBadge({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] bg-muted rounded px-1.5 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{formatNumber(value)}</span>
    </span>
  );
}

function DepthMetricsBadges({ depth, workload }: { depth: WorkloadDepthMetrics | null; workload: string }) {
  if (!depth) return null;
  if (workload === "Teams") return (
    <div className="flex flex-wrap gap-1 mt-1">
      <DepthBadge label="Team chats" value={depth.teamChatMessages} />
      <DepthBadge label="Private chats" value={depth.privateChatMessages} />
      <DepthBadge label="Calls" value={depth.calls} />
      <DepthBadge label="Meetings" value={depth.meetings} />
    </div>
  );
  if (workload === "OneDrive") return (
    <div className="flex flex-wrap gap-1 mt-1">
      <DepthBadge label="Viewed/Edited" value={depth.odViewedOrEdited} />
      <DepthBadge label="Synced" value={depth.odSynced} />
      <DepthBadge label="Shared internally" value={depth.odSharedInternally} />
      <DepthBadge label="Shared externally" value={depth.odSharedExternally} />
    </div>
  );
  if (workload === "SharePoint") return (
    <div className="flex flex-wrap gap-1 mt-1">
      <DepthBadge label="Pages visited" value={depth.spVisitedPages} />
      <DepthBadge label="Files viewed/edited" value={depth.spViewedOrEdited} />
      <DepthBadge label="Files synced" value={depth.spSynced} />
      <DepthBadge label="Shared externally" value={depth.spSharedExternally} />
    </div>
  );
  if (workload === "Exchange") return (
    <div className="flex flex-wrap gap-1 mt-1">
      <DepthBadge label="Sent" value={depth.emailSent} />
      <DepthBadge label="Received" value={depth.emailReceived} />
      <DepthBadge label="Read" value={depth.emailRead} />
    </div>
  );
  return null;
}

const columns: ColumnDef<WorkloadAdoptionItem>[] = [
  {
    accessorKey: "displayName",
    header: "Workload",
    cell: ({ row }) => (
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.displayName}</span>
          {row.original.isValueGap && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              Value Gap
            </Badge>
          )}
        </div>
        <DepthMetricsBadges depth={row.original.depth} workload={row.original.workload} />
      </div>
    ),
  },
  {
    accessorKey: "licensedUsers",
    header: "Licensed Users",
    cell: ({ row }) => (
      <span>{formatNumber(row.original.licensedUsers)}</span>
    ),
  },
  {
    accessorKey: "activeUsers",
    header: "Active (30d)",
    cell: ({ row }) => (
      <span
        className="font-semibold"
        style={{ color: CHART_COLORS.d30 }}
      >
        {formatNumber(row.original.activeUsers)}
      </span>
    ),
  },
  {
    accessorKey: "inactiveUsers",
    header: "Inactive",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatNumber(row.original.inactiveUsers)}
      </span>
    ),
  },
  {
    accessorKey: "adoptionPercent",
    header: "Adoption %",
    cell: ({ row }) => {
      const pct = row.original.adoptionPercent;
      return (
        <div className="flex items-center gap-2">
          <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(pct, 100)}%`,
                backgroundColor: adoptionColor(pct),
              }}
            />
          </div>
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: adoptionColor(pct) }}
          >
            {pct.toFixed(1)}%
          </span>
        </div>
      );
    },
  },
];

export function AdoptionTab() {
  const { data: adoptionWithMetadata, isLoading, isFetching, isError, error, refetch } =
    useGetM365AdoptionWithMetadata();

  const loading = isLoading;
  const data = adoptionWithMetadata?.data;
  const issue = summarizeIssues(getCollectionIssues(data));

  const getFieldMeta = (field: string) =>
    adoptionWithMetadata?.fieldMetadata?.[field];

  const { gridColor, tickColor } = useChartTheme();

  const trendData = useMemo(() => {
    if (!data?.workloads) return [];
    return data.workloads.map((w) => {
      const byPeriod = Object.fromEntries(
        w.trend.map((t) => [t.period, t.adoptionPercent]),
      );
      return {
        name: w.displayName,
        D30: byPeriod["D30"] ?? 0,
        D90: byPeriod["D90"] ?? 0,
        D180: byPeriod["D180"] ?? 0,
      };
    });
  }, [data?.workloads]);

  const csvData = useMemo(
    () =>
      data?.workloads.map((w) => ({
        Workload: w.displayName,
        "Licensed Users": w.licensedUsers,
        "Active Users (30d)": w.activeUsers,
        "Inactive Users": w.inactiveUsers,
        "Adoption % (30d)": w.adoptionPercent,
        "Adoption % (90d)": w.trend.find((t) => t.period === "D90")?.adoptionPercent ?? "",
        "Adoption % (180d)": w.trend.find((t) => t.period === "D180")?.adoptionPercent ?? "",
        "Value Gap": w.isValueGap ? "Yes" : "No",
      })) ?? [],
    [data?.workloads],
  );

  const valueGapWorkloads = useMemo(
    () => data?.workloads.filter((w) => w.isValueGap) ?? [],
    [data?.workloads],
  );

  if (isError) {
    return <ErrorPanel title="Couldn't load adoption data" error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="relative space-y-4">
      <RefreshIndicator active={isFetching && !isLoading} />
      <CollapsibleSection
        title="Adoption Summary"
        description="Overall M365 workload activation across your tenant"
        storageKey="adoption-summary"
        defaultOpen={true}
        density="compact"
        issue={issue}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Overall Adoption"
            value={
              loading ? undefined : `${data?.overallAdoptionPercent ?? 0}%`
            }
            loading={loading}
            valueColor={
              data
                ? adoptionColor(data.overallAdoptionPercent)
                : undefined
            }
            evidenceStatus={getFieldMeta("overallAdoptionPercent")?.evidenceStatus}
            confidenceLabel={getFieldMeta("overallAdoptionPercent")?.confidenceLabel}
          />
          <KPICard
            title="Active Users (30d)"
            value={
              loading
                ? undefined
                : formatNumber(data?.totalActiveUsers ?? 0)
            }
            loading={loading}
            valueColor={CHART_COLORS.d30}
            evidenceStatus={getFieldMeta("totalActiveUsers")?.evidenceStatus}
            confidenceLabel={getFieldMeta("totalActiveUsers")?.confidenceLabel}
          />
          <KPICard
            title="Licensed Users"
            value={
              loading
                ? undefined
                : formatNumber(data?.totalLicensedUsers ?? 0)
            }
            loading={loading}
            evidenceStatus={getFieldMeta("totalLicensedUsers")?.evidenceStatus}
            confidenceLabel={getFieldMeta("totalLicensedUsers")?.confidenceLabel}
          />
          <KPICard
            title="Value Gaps"
            value={
              loading ? undefined : String(data?.valueGapCount ?? 0)
            }
            loading={loading}
            valueColor={
              (data?.valueGapCount ?? 0) > 0
                ? CHART_COLORS.valueGap
                : CHART_COLORS.d180
            }
            evidenceStatus={getFieldMeta("valueGapCount")?.evidenceStatus}
            confidenceLabel={getFieldMeta("valueGapCount")?.confidenceLabel}
          />
        </div>
        {(data?.collectionNotes ?? []).map((note) => (
          <p key={note} className="text-[11px] text-muted-foreground mt-2">{note}</p>
        ))}
      </CollapsibleSection>

      {!loading && valueGapWorkloads.length > 0 && (
        <CollapsibleSection
          title="Value Gaps"
          description="Workloads with <20% adoption — licensed but largely unused"
          storageKey="adoption-value-gaps"
          defaultOpen={true}
          density="compact"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {valueGapWorkloads.map((w) => (
              <Card
                key={w.workload}
                className="border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20"
              >
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{w.displayName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatNumber(w.activeUsers)} active of{" "}
                        {formatNumber(w.licensedUsers)} licensed
                      </p>
                    </div>
                    <span
                      className="text-2xl font-bold tabular-nums"
                      style={{ color: CHART_COLORS.valueGap }}
                    >
                      {w.adoptionPercent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-2 w-full h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-red-500"
                      style={{ width: `${Math.min(w.adoptionPercent, 100)}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Adoption Trend (30 / 90 / 180 days)"
        description="Per-workload adoption rate across reporting periods"
        storageKey="adoption-trend"
        defaultOpen={true}
      >
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Workload Adoption by Period</CardTitle>
            {!loading && csvData.length > 0 && (
              <ExportBtn filename="workload-adoption.csv" data={csvData} ariaLabel="Export adoption data as CSV" />
            )}
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="w-full h-[300px]" />
            ) : (
              <ResponsiveContainer width="100%" height={300} debounce={0}>
                <BarChart
                  data={trendData}
                  layout="vertical"
                  margin={{ left: 20, right: 40, top: 5, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    vertical={true}
                    stroke={gridColor}
                  />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: tickColor }}
                    stroke={tickColor}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: tickColor }}
                    stroke={tickColor}
                    width={175}
                  />
                  <Tooltip
                    isAnimationActive={false}
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                    formatter={(value: number) => `${value.toFixed(1)}%`}
                  />
                  <Legend />
                  <Bar
                    dataKey="D30"
                    name="Last 30 days"
                    fill={CHART_COLORS.d30}
                    fillOpacity={0.9}
                    isAnimationActive={false}
                    radius={[0, 2, 2, 0]}
                  />
                  <Bar
                    dataKey="D90"
                    name="Last 90 days"
                    fill={CHART_COLORS.d90}
                    fillOpacity={0.7}
                    isAnimationActive={false}
                    radius={[0, 2, 2, 0]}
                  />
                  <Bar
                    dataKey="D180"
                    name="Last 180 days"
                    fill={CHART_COLORS.d180}
                    fillOpacity={0.6}
                    isAnimationActive={false}
                    radius={[0, 2, 2, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </CollapsibleSection>

      {!loading && data?.copilotAdoption && (
        <CollapsibleSection
          title="Microsoft 365 Copilot Adoption"
          description="Copilot enabled vs active users by app (30-day window)"
          storageKey="adoption-copilot"
          defaultOpen={true}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <KPICard
                title="Copilot Enabled"
                value={formatNumber(data.copilotAdoption.enabledUsers)}
                loading={false}
              />
              <KPICard
                title="Active Users (30d)"
                value={formatNumber(data.copilotAdoption.activeUsers)}
                loading={false}
                valueColor={CHART_COLORS.d30}
              />
              <KPICard
                title="Copilot Adoption"
                value={`${data.copilotAdoption.adoptionPercent.toFixed(1)}%`}
                loading={false}
                valueColor={adoptionColor(data.copilotAdoption.adoptionPercent)}
              />
            </div>
            <Card>
              <CardHeader className="px-4 pt-4 pb-2">
                <CardTitle className="text-base">Copilot Active Users by App</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220} debounce={0}>
                  <BarChart data={data.copilotAdoption.appBreakdown} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                    <XAxis dataKey="displayName" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                    <YAxis tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v: number) => formatNumber(v)} />
                    <Legend />
                    <Bar dataKey="enabledUsers" name="Enabled" fill={CHART_COLORS.d90} fillOpacity={0.5} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="activeUsers" name="Active (30d)" fill={CHART_COLORS.d30} fillOpacity={0.9} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Microsoft 365 Apps Activation"
        description="Active users per app in the last 30 days (Outlook, Teams, Word, Excel, PowerPoint, OneNote)"
        storageKey="adoption-apps"
        defaultOpen={false}
      >
        {loading ? (
          <Skeleton className="w-full h-[200px]" />
        ) : (
          <Card>
            <CardContent className="pt-4">
              <ResponsiveContainer width="100%" height={220} debounce={0}>
                <BarChart
                  data={data?.appsActivation ?? []}
                  margin={{ left: 10, right: 20, top: 5, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                  <XAxis dataKey="displayName" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <YAxis tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                  <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v: number) => formatNumber(v)} />
                  <Bar dataKey="activeUsers" name="Active Users (30d)" fill={CHART_COLORS.d30} fillOpacity={0.9} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Service Activation Matrix"
        description="Per-workload breakdown of licensed vs active vs inactive users"
        storageKey="adoption-matrix"
        defaultOpen={false}
      >
        {loading ? (
          <TableSkeleton rows={6} rowClassName="h-12" className="p-0" />
        ) : (
          <DataTable
            columns={columns}
            data={data?.workloads ?? []}
            initialSorting={[{ id: "adoptionPercent", desc: false }]}
            emptyMessage="No workload data available."
            rowClassName={(w) => (w.isValueGap ? "bg-red-50/40 dark:bg-red-950/20" : "")}
          />
        )}
      </CollapsibleSection>
    </div>
  );
}
