import { useGetM365Security } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CSVLink } from "react-csv";
import { Download } from "lucide-react";
import { useTheme } from "next-themes";
import { formatDate } from "@/lib/utils";
import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ConditionalAccessPolicyItem } from "@workspace/api-client-react/src/generated/api.schemas";

const CHART_COLORS = {
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
  yellow: "#eab308",
};
const CHART_COLOR_LIST = [CHART_COLORS.blue, CHART_COLORS.purple, CHART_COLORS.green, CHART_COLORS.red, CHART_COLORS.pink];

function StateBadge({ state }: { state: string }) {
  if (state === "enabled")
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal text-xs">Enabled</Badge>;
  if (state === "disabled")
    return <Badge variant="outline" className="text-muted-foreground font-normal text-xs">Disabled</Badge>;
  if (state === "enabledForReportingButNotEnforced")
    return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 font-normal text-xs">Report Only</Badge>;
  return <Badge variant="outline" className="font-normal text-xs">{state}</Badge>;
}

const caColumns: ColumnDef<ConditionalAccessPolicyItem>[] = [
  {
    accessorKey: "displayName",
    header: "Policy Name",
    cell: ({ row }) => (
      <span className="font-medium text-sm leading-tight">{row.original.displayName}</span>
    ),
  },
  {
    accessorKey: "state",
    header: "State",
    cell: ({ row }) => <StateBadge state={row.original.state} />,
  },
  {
    accessorKey: "targetUsers",
    header: "Target Users",
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.targetUsers}</span>,
  },
  {
    accessorKey: "targetApps",
    header: "Target Apps",
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.targetApps}</span>,
  },
  {
    accessorKey: "authStrength",
    header: "Auth Requirement",
    cell: ({ row }) => {
      const val = row.original.authStrength;
      if (val === "None") return <span className="text-muted-foreground text-sm">—</span>;
      return <span className="text-sm font-medium">{val}</span>;
    },
  },
  {
    accessorKey: "modifiedDateTime",
    header: "Last Modified",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{formatDate(row.original.modifiedDateTime)}</span>
    ),
  },
];

export function SecurityTab() {
  const { data, isLoading, isFetching } = useGetM365Security();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const loading = isLoading || isFetching;

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const mfaDonutData = data ? [
    { name: "MFA Enabled", value: data.mfaEnabledUsers },
    { name: "MFA Disabled", value: data.mfaDisabledUsers },
  ] : [];

  const caPolicyData = data ? [
    { name: "Enabled", value: data.enabledCAPs },
    { name: "Disabled", value: data.disabledCAPs },
    { name: "Report-Only", value: data.reportOnlyCAPs },
  ] : [];

  const [caSorting, setCaSorting] = useState<SortingState>([{ id: "state", desc: false }]);
  const [caFilter, setCaFilter] = useState("");

  const caTable = useReactTable({
    data: data?.caPolicies ?? [],
    columns: caColumns,
    state: { sorting: caSorting, globalFilter: caFilter },
    onSortingChange: setCaSorting,
    onGlobalFilterChange: setCaFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Secure Score" value={data ? `${data.secureScore} / ${data.secureScoreMax}` : undefined} loading={loading} />
        <KPICard title="Secure Score %" value={data ? `${data.secureScorePercent}%` : undefined} loading={loading} valueColor={data && data.secureScorePercent < 70 ? CHART_COLORS.red : CHART_COLORS.green} />
        <KPICard title="MFA Coverage" value={data ? `${data.mfaEnabledPercent}%` : undefined} loading={loading} />
        <KPICard title="CA Policies (Enabled)" value={data?.enabledCAPs} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Secure Score History</CardTitle>
            {!loading && data?.secureScoreHistory && data.secureScoreHistory.length > 0 && (
              <CSVLink data={data.secureScoreHistory} filename="secure-score-history.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[260px]" /> : (
              <ResponsiveContainer width="100%" height={260} debounce={0}>
                <AreaChart data={data?.secureScoreHistory || []}>
                  <defs>
                    <linearGradient id="gradientScore" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.blue} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={CHART_COLORS.blue} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} tickFormatter={(v) => formatDate(v, "MMM d")} />
                  <YAxis tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.05)", stroke: "none" }} isAnimationActive={false} />
                  <Legend />
                  <Area type="monotone" dataKey="score" name="Score" fill="url(#gradientScore)" stroke={CHART_COLORS.blue} fillOpacity={1} strokeWidth={2} activeDot={{ r: 5, fill: CHART_COLORS.blue, stroke: "#ffffff", strokeWidth: 3 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Score by Control Category</CardTitle>
            {!loading && data?.controlCategories && data.controlCategories.length > 0 && (
              <CSVLink data={data.controlCategories} filename="score-by-category.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[260px]" /> : (
              <ResponsiveContainer width="100%" height={260} debounce={0}>
                <BarChart data={data?.controlCategories || []} margin={{ left: -20, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="category" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                  <YAxis tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.05)", stroke: "none" }} isAnimationActive={false} />
                  <Legend />
                  <Bar dataKey="score" name="Current Score" fill={CHART_COLORS.blue} fillOpacity={0.85} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="maxScore" name="Max Score" fill={CHART_COLORS.purple} fillOpacity={0.5} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">MFA Registration Status</CardTitle>
            {!loading && mfaDonutData.length > 0 && (
              <CSVLink data={mfaDonutData} filename="mfa-status.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[220px]" /> : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220} debounce={0}>
                  <PieChart>
                    <Pie data={mfaDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} cornerRadius={2} paddingAngle={2} isAnimationActive={false} stroke="none">
                      <Cell fill={CHART_COLORS.green} />
                      <Cell fill={CHART_COLORS.red} />
                    </Pie>
                    <Tooltip isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4">
                  {mfaDonutData.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: index === 0 ? CHART_COLORS.green : CHART_COLORS.red }} />
                      <span className="text-muted-foreground">{entry.name}</span>
                      <span className="font-semibold">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">CA Policies by State</CardTitle>
            {!loading && caPolicyData.length > 0 && (
              <CSVLink data={caPolicyData} filename="ca-policies-summary.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[220px]" /> : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220} debounce={0}>
                  <PieChart>
                    <Pie data={caPolicyData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} cornerRadius={2} paddingAngle={2} isAnimationActive={false} stroke="none">
                      <Cell fill={CHART_COLORS.green} />
                      <Cell fill={CHART_COLORS.red} />
                      <Cell fill={CHART_COLORS.yellow} />
                    </Pie>
                    <Tooltip isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4">
                  {caPolicyData.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: [CHART_COLORS.green, CHART_COLORS.red, CHART_COLORS.yellow][index] }} />
                      <span className="text-muted-foreground">{entry.name}</span>
                      <span className="font-semibold">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Conditional Access Policies Detail Table */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Conditional Access Policies</CardTitle>
            {!loading && data?.caPolicies && (
              <p className="text-xs text-muted-foreground mt-0.5">{data.caPolicies.length} policies total</p>
            )}
          </div>
          {!loading && data?.caPolicies && data.caPolicies.length > 0 && (
            <CSVLink
              data={data.caPolicies.map(p => ({
                Name: p.displayName,
                State: p.state,
                "Target Users": p.targetUsers,
                "Target Apps": p.targetApps,
                "Auth Requirement": p.authStrength,
                "Last Modified": p.modifiedDateTime ?? "",
              }))}
              filename="conditional-access-policies.csv"
              className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80"
              style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
              aria-label="Export CA policies as CSV"
            >
              <Download className="w-3.5 h-3.5" />
            </CSVLink>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-64" />
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                placeholder="Search policies..."
                value={caFilter}
                onChange={(e) => setCaFilter(e.target.value)}
                className="max-w-sm"
              />
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {caTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((header) => (
                          <TableHead
                            key={header.id}
                            onClick={header.column.getToggleSortingHandler()}
                            className="cursor-pointer select-none whitespace-nowrap"
                          >
                            <div className="flex items-center gap-1">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? null}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {caTable.getRowModel().rows.length > 0 ? (
                      caTable.getRowModel().rows.map((row) => (
                        <TableRow key={row.id}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id} className="py-2 align-top">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={caColumns.length} className="h-20 text-center text-muted-foreground">
                          No policies found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing{" "}
                  {caTable.getState().pagination.pageIndex * caTable.getState().pagination.pageSize + (caTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)}{" "}
                  to{" "}
                  {Math.min(
                    (caTable.getState().pagination.pageIndex + 1) * caTable.getState().pagination.pageSize,
                    caTable.getFilteredRowModel().rows.length
                  )}{" "}
                  of {caTable.getFilteredRowModel().rows.length}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => caTable.previousPage()} disabled={!caTable.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => caTable.nextPage()} disabled={!caTable.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
