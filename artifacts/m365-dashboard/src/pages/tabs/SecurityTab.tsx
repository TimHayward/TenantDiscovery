import { useGetM365Security } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { CSVLink } from "react-csv";
import { Download, ChevronDown, ChevronUp, CheckCircle2, XCircle, ShieldCheck, ShieldAlert } from "lucide-react";
import { useTheme } from "next-themes";
import { formatDate } from "@/lib/utils";
import { useState, useMemo } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel, flexRender,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  ConditionalAccessPolicyItem,
  MfaUserItem,
  MfaMethodStrengthItem,
} from "@workspace/api-client-react/src/generated/api.schemas";

const C = {
  blue:   "#0079F2",
  purple: "#795EFF",
  green:  "#009118",
  red:    "#A60808",
  yellow: "#eab308",
  orange: "#f97316",
  gray:   "#9ca3af",
};

const STRENGTH_COLOR: Record<string, string> = {
  "Phishing-resistant": C.green,
  "Strong":             C.blue,
  "Medium":             C.yellow,
  "Weak":               C.red,
  "Unknown":            C.gray,
};

const STRENGTH_ORDER = ["Phishing-resistant", "Strong", "Medium", "Weak", "Unknown"];

// ── helpers ──────────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: string }) {
  if (state === "enabled")
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal text-xs">Enabled</Badge>;
  if (state === "disabled")
    return <Badge variant="outline" className="text-muted-foreground font-normal text-xs">Disabled</Badge>;
  if (state === "enabledForReportingButNotEnforced")
    return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 font-normal text-xs">Report Only</Badge>;
  return <Badge variant="outline" className="font-normal text-xs">{state}</Badge>;
}

function StrengthBadge({ strength }: { strength: string }) {
  const color = STRENGTH_COLOR[strength] ?? C.gray;
  const bg: Record<string, string> = {
    "Phishing-resistant": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    "Strong":             "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    "Medium":             "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    "Weak":               "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <Badge className={`${bg[strength] ?? ""} font-normal text-xs border-0`}>{strength}</Badge>
    </div>
  );
}

// ── CA policy table ───────────────────────────────────────────────────────────

const caColumns: ColumnDef<ConditionalAccessPolicyItem>[] = [
  { accessorKey: "displayName", header: "Policy Name", cell: ({ row }) => <span className="font-medium text-sm">{row.original.displayName}</span> },
  { accessorKey: "state", header: "State", cell: ({ row }) => <StateBadge state={row.original.state} /> },
  { accessorKey: "targetUsers", header: "Target Users", cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.targetUsers}</span> },
  { accessorKey: "targetApps", header: "Target Apps", cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.targetApps}</span> },
  { accessorKey: "authStrength", header: "Auth Requirement", cell: ({ row }) => {
    const v = row.original.authStrength;
    return v === "None" ? <span className="text-muted-foreground text-sm">—</span> : <span className="text-sm font-medium">{v}</span>;
  }},
  { accessorKey: "modifiedDateTime", header: "Last Modified", cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDate(row.original.modifiedDateTime)}</span> },
];

// ── MFA user table ────────────────────────────────────────────────────────────

const mfaUserColumns: ColumnDef<MfaUserItem>[] = [
  {
    accessorKey: "displayName",
    header: "User",
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-sm">{row.original.displayName}</p>
        <p className="text-xs text-muted-foreground">{row.original.userPrincipalName}</p>
      </div>
    ),
  },
  {
    accessorKey: "isMfaRegistered",
    header: "MFA Status",
    cell: ({ row }) =>
      row.original.isMfaRegistered ? (
        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">Registered</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">Not Registered</span>
        </div>
      ),
  },
  {
    accessorKey: "methodsRegistered",
    header: "Methods Registered",
    cell: ({ row }) => {
      const methods: string[] = row.original.methodsRegistered ?? [];
      if (methods.length === 0) return <span className="text-muted-foreground text-sm">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {methods.map((m) => (
            <Badge key={m} variant="outline" className="text-xs font-normal">{m}</Badge>
          ))}
        </div>
      );
    },
  },
  {
    accessorKey: "isPasswordlessCapable",
    header: "Passwordless",
    cell: ({ row }) =>
      row.original.isPasswordlessCapable ? (
        <ShieldCheck className="w-4 h-4 text-green-500" />
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
  },
  {
    accessorKey: "accountEnabled",
    header: "Account",
    cell: ({ row }) =>
      row.original.accountEnabled ? (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal text-xs">Active</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground font-normal text-xs">Disabled</Badge>
      ),
  },
  {
    accessorKey: "userType",
    header: "Type",
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.userType}</span>,
  },
];

// ── MFA method table ──────────────────────────────────────────────────────────

const methodColumns: ColumnDef<MfaMethodStrengthItem>[] = [
  {
    accessorKey: "strengthLevel",
    header: "Strength",
    cell: ({ row }) => <StrengthBadge strength={row.original.strength} />,
    sortingFn: (a, b) => b.original.strengthLevel - a.original.strengthLevel,
  },
  { accessorKey: "displayName", header: "Method", cell: ({ row }) => <span className="font-medium text-sm">{row.original.displayName}</span> },
  {
    accessorKey: "count",
    header: "Users",
    cell: ({ row }) => <span className="font-semibold text-sm">{row.original.count}</span>,
  },
  {
    accessorKey: "percentOfUsers",
    header: "% of Users",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <div className="w-20 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(row.original.percentOfUsers, 100)}%`, backgroundColor: STRENGTH_COLOR[row.original.strength] ?? C.gray }}
          />
        </div>
        <span className="text-sm text-muted-foreground">{row.original.percentOfUsers}%</span>
      </div>
    ),
  },
];

// ── component ─────────────────────────────────────────────────────────────────

export function SecurityTab() {
  const { data, isLoading, isFetching } = useGetM365Security();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const loading = isLoading || isFetching;

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  // MFA donut
  const mfaDonutData = data ? [
    { name: "MFA Enabled", value: data.mfaEnabledUsers },
    { name: "MFA Disabled", value: data.mfaDisabledUsers },
  ] : [];

  // CA policy summary donut
  const caPolicyData = data ? [
    { name: "Enabled",     value: data.enabledCAPs },
    { name: "Disabled",    value: data.disabledCAPs },
    { name: "Report-Only", value: data.reportOnlyCAPs },
  ] : [];

  // MFA method bar chart – group by strength
  const methodChartData = useMemo(() => {
    if (!data?.mfaMethodsBreakdown) return [];
    return [...data.mfaMethodsBreakdown].sort(
      (a, b) => b.strengthLevel - a.strengthLevel || b.count - a.count
    );
  }, [data]);

  // ── expand/collapse MFA users panel ──
  const [mfaUsersOpen, setMfaUsersOpen] = useState(false);
  const [mfaUserFilter, setMfaUserFilter] = useState("");
  const [mfaUserSorting, setMfaUserSorting] = useState<SortingState>([{ id: "isMfaRegistered", desc: false }]);

  const mfaUserTable = useReactTable({
    data: data?.mfaUsersList ?? [],
    columns: mfaUserColumns,
    state: { sorting: mfaUserSorting, globalFilter: mfaUserFilter },
    onSortingChange: setMfaUserSorting,
    onGlobalFilterChange: setMfaUserFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });

  // ── CA policy table ──
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

  // ── MFA methods table ──
  const [methodSorting, setMethodSorting] = useState<SortingState>([{ id: "strengthLevel", desc: true }]);

  const methodTable = useReactTable({
    data: data?.mfaMethodsBreakdown ?? [],
    columns: methodColumns,
    state: { sorting: methodSorting },
    onSortingChange: setMethodSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const exportButton = (filename: string, csvData: object[]) =>
    !loading && csvData.length > 0 ? (
      <CSVLink
        data={csvData}
        filename={filename}
        className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80"
        style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
        aria-label="Export CSV"
      >
        <Download className="w-3.5 h-3.5" />
      </CSVLink>
    ) : null;

  return (
    <div className="space-y-4">

      {/* ── KPI row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Secure Score" value={data ? `${data.secureScore} / ${data.secureScoreMax}` : undefined} loading={loading} />
        <KPICard title="Secure Score %" value={data ? `${data.secureScorePercent}%` : undefined} loading={loading} valueColor={data && data.secureScorePercent < 70 ? C.red : C.green} />
        <KPICard title="MFA Coverage" value={data ? `${data.mfaEnabledPercent}%` : undefined} loading={loading} />
        <KPICard title="CA Policies (Enabled)" value={data?.enabledCAPs} loading={loading} />
      </div>

      {/* ── Row 2: Score history + Score by category ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Secure Score History</CardTitle>
            {exportButton("secure-score-history.csv", data?.secureScoreHistory ?? [])}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[260px]" /> : (
              <ResponsiveContainer width="100%" height={260} debounce={0}>
                <AreaChart data={data?.secureScoreHistory ?? []}>
                  <defs>
                    <linearGradient id="gradScore" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.blue} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={C.blue} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} tickFormatter={(v) => formatDate(v, "MMM d")} />
                  <YAxis tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                  <Tooltip isAnimationActive={false} />
                  <Legend />
                  <Area type="monotone" dataKey="score" name="Score" fill="url(#gradScore)" stroke={C.blue} strokeWidth={2} activeDot={{ r: 5 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Score by Control Category</CardTitle>
            {exportButton("score-by-category.csv", data?.controlCategories ?? [])}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[260px]" /> : (
              <ResponsiveContainer width="100%" height={260} debounce={0}>
                <BarChart data={data?.controlCategories ?? []} margin={{ left: -20, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="category" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                  <YAxis tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                  <Tooltip isAnimationActive={false} />
                  <Legend />
                  <Bar dataKey="score" name="Current Score" fill={C.blue} fillOpacity={0.85} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="maxScore" name="Max Score" fill={C.purple} fillOpacity={0.5} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 3: MFA donut + CA donut ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* MFA donut + expandable user table */}
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">MFA Registration Status</CardTitle>
            {exportButton("mfa-status.csv", mfaDonutData)}
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? <Skeleton className="w-full h-[220px]" /> : (
              <>
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={220} debounce={0}>
                    <PieChart>
                      <Pie data={mfaDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} cornerRadius={2} paddingAngle={2} isAnimationActive={false} stroke="none">
                        <Cell fill={C.green} />
                        <Cell fill={C.red} />
                      </Pie>
                      <Tooltip isAnimationActive={false} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-4">
                    {mfaDonutData.map((entry, i) => (
                      <div key={entry.name} className="flex items-center gap-2 text-sm">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: i === 0 ? C.green : C.red }} />
                        <span className="text-muted-foreground">{entry.name}</span>
                        <span className="font-semibold">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Expand/collapse user detail */}
                <button
                  onClick={() => setMfaUsersOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md border text-sm font-medium transition-colors hover:bg-muted/50"
                >
                  <span>View user-level MFA details ({data?.mfaUsersList?.length ?? 0} users)</span>
                  {mfaUsersOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>
              </>
            )}
          </CardContent>
        </Card>

        {/* CA policy donut */}
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">CA Policies by State</CardTitle>
            {exportButton("ca-policies-summary.csv", caPolicyData)}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[220px]" /> : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220} debounce={0}>
                  <PieChart>
                    <Pie data={caPolicyData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} cornerRadius={2} paddingAngle={2} isAnimationActive={false} stroke="none">
                      <Cell fill={C.green} />
                      <Cell fill={C.red} />
                      <Cell fill={C.yellow} />
                    </Pie>
                    <Tooltip isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4">
                  {caPolicyData.map((entry, i) => (
                    <div key={entry.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: [C.green, C.red, C.yellow][i] }} />
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

      {/* ── MFA user detail panel (expandable) ───────────────────────────────── */}
      {mfaUsersOpen && (
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">MFA Registration — User Details</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {data?.mfaEnabledUsers} registered · {data?.mfaDisabledUsers} not registered
              </p>
            </div>
            {exportButton("mfa-users.csv", (data?.mfaUsersList ?? []).map(u => ({
              Name: u.displayName,
              UPN: u.userPrincipalName,
              MFARegistered: u.isMfaRegistered,
              Methods: u.methodsRegistered.join(", "),
              Passwordless: u.isPasswordlessCapable,
              AccountEnabled: u.accountEnabled,
              Type: u.userType,
            })))}
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Input
                  placeholder="Filter by name or email..."
                  value={mfaUserFilter}
                  onChange={(e) => setMfaUserFilter(e.target.value)}
                  className="max-w-sm"
                />
                <div className="flex gap-2 text-sm text-muted-foreground">
                  <button
                    onClick={() => setMfaUserFilter("")}
                    className="underline hover:text-foreground transition-colors"
                  >
                    All
                  </button>
                  <span>·</span>
                  <button
                    onClick={() => { setMfaUserFilter(""); setMfaUserSorting([{ id: "isMfaRegistered", desc: false }]); }}
                    className="underline hover:text-foreground transition-colors"
                  >
                    Not Registered First
                  </button>
                </div>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {mfaUserTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((header) => (
                          <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none whitespace-nowrap">
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
                    {mfaUserTable.getRowModel().rows.length > 0 ? (
                      mfaUserTable.getRowModel().rows.map((row) => (
                        <TableRow key={row.id} className={!row.original.isMfaRegistered ? "bg-red-50/40 dark:bg-red-950/10" : ""}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id} className="py-2 align-top">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={mfaUserColumns.length} className="h-16 text-center text-muted-foreground">
                          No users match the filter.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {mfaUserTable.getState().pagination.pageIndex * mfaUserTable.getState().pagination.pageSize + (mfaUserTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)} to{" "}
                  {Math.min((mfaUserTable.getState().pagination.pageIndex + 1) * mfaUserTable.getState().pagination.pageSize, mfaUserTable.getFilteredRowModel().rows.length)} of{" "}
                  {mfaUserTable.getFilteredRowModel().rows.length}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => mfaUserTable.previousPage()} disabled={!mfaUserTable.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => mfaUserTable.nextPage()} disabled={!mfaUserTable.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── MFA Method Strength ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">MFA Method Strength</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Ranked by Microsoft's authentication strength guidance</p>
          </div>
          {exportButton("mfa-methods.csv", (data?.mfaMethodsBreakdown ?? []).map(m => ({
            Method: m.displayName,
            Strength: m.strength,
            Users: m.count,
            "% of Users": m.percentOfUsers,
          })))}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="w-full h-[200px]" />
              <Skeleton className="w-full h-[140px]" />
            </div>
          ) : (data?.mfaMethodsBreakdown?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <ShieldAlert className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No MFA method data available.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Strength guide legend */}
              <div className="flex flex-wrap gap-3">
                {STRENGTH_ORDER.filter(s => (data?.mfaMethodsBreakdown ?? []).some(m => m.strength === s)).map(s => (
                  <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STRENGTH_COLOR[s] }} />
                    {s}
                  </div>
                ))}
              </div>

              {/* Bar chart */}
              <ResponsiveContainer width="100%" height={220} debounce={0}>
                <BarChart data={methodChartData} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                  <YAxis type="category" dataKey="displayName" tick={{ fontSize: 11, fill: tickColor }} stroke="none" width={180} />
                  <Tooltip
                    isAnimationActive={false}
                    formatter={(value: number, _: string, props: any) => [
                      `${value} users (${props.payload.percentOfUsers}%)`,
                      props.payload.displayName,
                    ]}
                  />
                  <Bar dataKey="count" name="Users" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                    {methodChartData.map((entry, i) => (
                      <Cell key={i} fill={STRENGTH_COLOR[entry.strength] ?? C.gray} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Method table */}
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    {methodTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((header) => (
                          <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none whitespace-nowrap">
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
                    {methodTable.getRowModel().rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-2.5">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── CA Policy detail table ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Conditional Access Policies</CardTitle>
            {!loading && data?.caPolicies && (
              <p className="text-xs text-muted-foreground mt-0.5">{data.caPolicies.length} policies total</p>
            )}
          </div>
          {exportButton("conditional-access-policies.csv", (data?.caPolicies ?? []).map(p => ({
            Name: p.displayName, State: p.state, "Target Users": p.targetUsers,
            "Target Apps": p.targetApps, "Auth Requirement": p.authStrength,
            "Last Modified": p.modifiedDateTime ?? "",
          })))}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-64" />
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              <Input placeholder="Search policies..." value={caFilter} onChange={(e) => setCaFilter(e.target.value)} className="max-w-sm" />
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {caTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((header) => (
                          <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none whitespace-nowrap">
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
                  Showing {caTable.getState().pagination.pageIndex * caTable.getState().pagination.pageSize + (caTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)} to{" "}
                  {Math.min((caTable.getState().pagination.pageIndex + 1) * caTable.getState().pagination.pageSize, caTable.getFilteredRowModel().rows.length)} of{" "}
                  {caTable.getFilteredRowModel().rows.length}
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
