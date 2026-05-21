import { useGetM365AdoptionWithMetadata } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
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
import { CSVLink } from "react-csv";
import { Download } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  flexRender,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import type { WorkloadAdoptionItem, WorkloadDepthMetrics } from "@workspace/api-client-react";

const CHART_COLORS = {
  d30: "#1E3D59",
  d90: "#795EFF",
  d180: "#009118",
  valueGap: "#A60808",
  warning: "#d97706",
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
      <span className="font-semibold">{value.toLocaleString()}</span>
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
      <span>{row.original.licensedUsers.toLocaleString()}</span>
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
        {row.original.activeUsers.toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "inactiveUsers",
    header: "Inactive",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.inactiveUsers.toLocaleString()}
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
  const { data: adoptionWithMetadata, isLoading, isFetching } =
    useGetM365AdoptionWithMetadata();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const loading = isLoading || isFetching;
  const data = adoptionWithMetadata?.data;

  const getFieldMeta = (field: string) =>
    adoptionWithMetadata?.fieldMetadata?.[field];

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const [sorting, setSorting] = useState<SortingState>([
    { id: "adoptionPercent", desc: false },
  ]);

  const table = useReactTable({
    data: data?.workloads ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

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

  return (
    <div className="space-y-4">
      <CollapsibleSection
        title="Adoption Summary"
        description="Overall M365 workload activation across your tenant"
        storageKey="adoption-summary"
        defaultOpen={true}
        density="compact"
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
                : data?.totalActiveUsers.toLocaleString()
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
                : data?.totalLicensedUsers.toLocaleString()
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
                        {w.activeUsers.toLocaleString()} active of{" "}
                        {w.licensedUsers.toLocaleString()} licensed
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
              <CSVLink
                data={csvData}
                filename="workload-adoption.csv"
                className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80"
                style={{
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.1)"
                    : "#F0F1F2",
                  color: isDark ? "#c8c9cc" : "#4b5563",
                }}
                aria-label="Export adoption data as CSV"
              >
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
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
                value={data.copilotAdoption.enabledUsers.toLocaleString()}
                loading={false}
              />
              <KPICard
                title="Active Users (30d)"
                value={data.copilotAdoption.activeUsers.toLocaleString()}
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
                    <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v: number) => v.toLocaleString()} />
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
                  <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v: number) => v.toLocaleString()} />
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
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        className="cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {
                            { asc: " ↑", desc: " ↓" }[
                              header.column.getIsSorted() as string
                            ] ?? null
                          }
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length > 0 ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={
                        row.original.isValueGap
                          ? "bg-red-50/40 dark:bg-red-950/20"
                          : undefined
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No workload data available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
