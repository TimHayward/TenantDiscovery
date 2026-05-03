import { useGetM365Security } from "@workspace/api-client-react";
import { ChecklistTable, type ChecklistGroup } from "@/components/ChecklistTable";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { CSVLink } from "react-csv";
import {
  Download, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, ShieldCheck, ShieldAlert, AlertTriangle,
  Settings2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { formatDate } from "@/lib/utils";
import { useState, useMemo } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel, flexRender,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  ConditionalAccessPolicyItem,
  MfaUserItem,
  MfaMethodStrengthItem,
  SecureScoreControl,
} from "@workspace/api-client-react/src/generated/api.schemas";

// ── constants ─────────────────────────────────────────────────────────────────

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

// ── small helpers ─────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: string }) {
  if (state === "enabled")
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal text-xs border-0">Enabled</Badge>;
  if (state === "disabled")
    return <Badge variant="outline" className="text-muted-foreground font-normal text-xs">Disabled</Badge>;
  if (state === "enabledForReportingButNotEnforced")
    return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 font-normal text-xs border-0">Report Only</Badge>;
  return <Badge variant="outline" className="font-normal text-xs">{state}</Badge>;
}

function StrengthBadge({ strength }: { strength: string }) {
  const color = STRENGTH_COLOR[strength] ?? C.gray;
  const cls: Record<string, string> = {
    "Phishing-resistant": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    "Strong":             "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    "Medium":             "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    "Weak":               "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <Badge className={`${cls[strength] ?? ""} font-normal text-xs border-0`}>{strength}</Badge>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const cls: Record<string, string> = {
    high:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    medium: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    low:    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    none:   "bg-muted text-muted-foreground",
  };
  return <Badge className={`${cls[level] ?? ""} font-normal text-xs capitalize border-0`}>{level}</Badge>;
}

function ExportBtn({ filename, csvData }: { filename: string; csvData: object[] }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  if (!csvData.length) return null;
  return (
    <CSVLink
      data={csvData} filename={filename}
      className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80"
      style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
      aria-label="Export CSV"
    >
      <Download className="w-3.5 h-3.5" />
    </CSVLink>
  );
}

// ── table column definitions ──────────────────────────────────────────────────

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
    header: "Methods",
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
      row.original.isPasswordlessCapable
        ? <ShieldCheck className="w-4 h-4 text-green-500" />
        : <span className="text-muted-foreground text-sm">—</span>,
  },
  {
    accessorKey: "accountEnabled",
    header: "Account",
    cell: ({ row }) =>
      row.original.accountEnabled
        ? <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal text-xs border-0">Active</Badge>
        : <Badge variant="outline" className="text-muted-foreground font-normal text-xs">Disabled</Badge>,
  },
  {
    accessorKey: "userType",
    header: "Type",
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.userType}</span>,
  },
];

const SETTING_STATUS_COLORS: Record<string, string> = {
  configured:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  partial:       "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  notConfigured: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function SettingStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { configured: "Configured", partial: "Partial", notConfigured: "Not Configured" };
  return (
    <Badge className={`${SETTING_STATUS_COLORS[status] ?? ""} font-normal text-xs border-0`}>
      {labels[status] ?? status}
    </Badge>
  );
}

function ScoreBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "#009118" : pct > 0 ? "#eab308" : "#A60808";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 rounded-full bg-muted overflow-hidden flex-shrink-0">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{Math.round(pct)}%</span>
    </div>
  );
}

const secureScoreControlColumns: ColumnDef<SecureScoreControl>[] = [
  {
    accessorKey: "controlName",
    header: "Control",
    cell: ({ row }) => <span className="font-medium text-sm">{row.original.controlName}</span>,
  },
  {
    accessorKey: "controlCategory",
    header: "Category",
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.controlCategory}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <SettingStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "scoreInPercentage",
    header: "Score",
    cell: ({ row }) => <ScoreBar pct={row.original.scoreInPercentage} />,
  },
  {
    accessorKey: "implementationStatus",
    header: "Details",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground line-clamp-2 max-w-xs">{row.original.implementationStatus || "—"}</span>
    ),
  },
  {
    accessorKey: "lastSynced",
    header: "Last Synced",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.lastSynced ? formatDate(row.original.lastSynced) : "—"}</span>
    ),
  },
];

const methodColumns: ColumnDef<MfaMethodStrengthItem>[] = [
  {
    accessorKey: "strengthLevel",
    header: "Strength",
    cell: ({ row }) => <StrengthBadge strength={row.original.strength} />,
  },
  { accessorKey: "displayName", header: "Method", cell: ({ row }) => <span className="font-medium text-sm">{row.original.displayName}</span> },
  { accessorKey: "count", header: "Users", cell: ({ row }) => <span className="font-semibold text-sm">{row.original.count}</span> },
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

// ── main component ────────────────────────────────────────────────────────────

export function SecurityTab() {
  const { data, isLoading, isFetching } = useGetM365Security();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const loading = isLoading || isFetching;

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  // ── Section 6: Defender / Security checklist ────────────────────────────────
  const caps: Array<{ displayName?: string; state?: string }> =
    (data as { caPolicies?: Array<{ displayName?: string; state?: string }> })?.caPolicies ?? [];
  const hasMCASpolicies = caps.some(p => p.displayName?.toLowerCase().includes("mcas") || p.displayName?.toLowerCase().includes("cloud app"));
  const hasHighRiskBlock = caps.some(p => p.displayName?.toLowerCase().includes("high sign-in risk") || p.displayName?.toLowerCase().includes("high user risk"));
  const secureScorePercent = data?.secureScorePercent ?? 0;
  const securityChecklist: ChecklistGroup[] = [
    { id: "6.1", title: "6.1 Security awareness training is provided to all users", items: [
      { label: "Attack Simulation Training configured and active", status: "manual" },
      { label: "Phishing simulation campaigns running", status: "manual" },
    ]},
    { id: "6.2", title: "6.2 Antivirus is deployed to all endpoints", items: [
      { label: "Microsoft Defender Antivirus deployed to all Windows devices", status: "manual" },
      { label: "Antivirus signatures are kept up to date", status: "manual" },
    ]},
    { id: "6.3", title: "6.3 Endpoint Detection and Response (EDR) is deployed", items: [
      { label: "Microsoft Defender for Endpoint EDR configured", status: "manual" },
    ]},
    { id: "6.4", title: "6.4 Microsoft Secure Score is monitored and improvement actions addressed", items: [
      { label: "Secure Score is actively monitored",
        status: secureScorePercent >= 70 ? "pass" : secureScorePercent >= 40 ? "warning" : "fail",
        detail: secureScorePercent > 0 ? `${secureScorePercent}% Secure Score` : "Manual Check Required" },
    ]},
    { id: "6.5", title: "6.5 Microsoft Defender XDR is configured", items: [
      { label: "Microsoft Defender XDR (formerly M365 Defender) is enabled and configured", status: "manual" },
    ]},
    { id: "6.6", title: "6.6 Vulnerability Management is configured", items: [
      { label: "Defender Vulnerability Management scanning enabled", status: "manual" },
    ]},
    { id: "6.7", title: "6.7 Email and collaboration protection is enabled", items: [
      { label: "Defender for Office 365 Plan 1 or Plan 2 enabled", status: "manual" },
      { label: "Safe Links and Safe Attachments policies are active", status: "manual" },
    ]},
    { id: "6.8", title: "6.8 High risk sign-ins are blocked", items: [
      { label: "High risk sign-in risk policy configured",
        status: hasHighRiskBlock ? "warning" : "fail",
        detail: hasHighRiskBlock ? "Report Only – not yet enforced" : "Not Configured" },
    ]},
    { id: "6.9", title: "6.9 Microsoft Defender for Cloud Apps (MCAS) is configured", items: [
      { label: "Cloud App Security / MCAS policies are active",
        status: hasMCASpolicies ? "warning" : "manual",
        detail: hasMCASpolicies ? "Report Only policies detected" : "Manual Check Required" },
    ]},
  ];

  // ── derived chart data ──
  const mfaDonutData = data
    ? [{ name: "MFA Enabled", value: data.mfaEnabledUsers }, { name: "MFA Disabled", value: data.mfaDisabledUsers }]
    : [];

  const caPolicyData = data
    ? [{ name: "Enabled", value: data.enabledCAPs }, { name: "Disabled", value: data.disabledCAPs }, { name: "Report-Only", value: data.reportOnlyCAPs }]
    : [];

  const methodChartData = useMemo(
    () => [...(data?.mfaMethodsBreakdown ?? [])].sort((a, b) => b.strengthLevel - a.strengthLevel || b.count - a.count),
    [data]
  );

  const riskTimeline = data?.riskDetectionTimeline ?? [];
  const hasRiskData = riskTimeline.some((d) => d.total > 0);

  // ── MFA user panel state ──
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

  // ── Security Settings (Secure Score Controls) state ──
  const [settingsFilter, setSettingsFilter] = useState("");
  const [settingsSorting, setSettingsSorting] = useState<SortingState>([{ id: "scoreInPercentage", desc: false }]);
  const [settingsCategoryFilter, setSettingsCategoryFilter] = useState("All");
  const [settingsStatusFilter, setSettingsStatusFilter] = useState("All");

  const controls = data?.secureScoreControls ?? [];
  const categories = useMemo(() => ["All", ...Array.from(new Set(controls.map((c) => c.controlCategory))).sort()], [controls]);

  const filteredControls = useMemo(() => {
    let c = controls;
    if (settingsCategoryFilter !== "All") c = c.filter((x) => x.controlCategory === settingsCategoryFilter);
    if (settingsStatusFilter !== "All") c = c.filter((x) => x.status === settingsStatusFilter);
    return c;
  }, [controls, settingsCategoryFilter, settingsStatusFilter]);

  const settingsTable = useReactTable({
    data: filteredControls,
    columns: secureScoreControlColumns,
    state: { sorting: settingsSorting, globalFilter: settingsFilter },
    onSortingChange: setSettingsSorting,
    onGlobalFilterChange: setSettingsFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });

  const configuredCount   = controls.filter((c) => c.status === "configured").length;
  const partialCount      = controls.filter((c) => c.status === "partial").length;
  const notConfiguredCount = controls.filter((c) => c.status === "notConfigured").length;

  // ── CA policy table state ──
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

  // ── MFA method table state ──
  const [methodSorting, setMethodSorting] = useState<SortingState>([{ id: "strengthLevel", desc: true }]);

  const methodTable = useReactTable({
    data: data?.mfaMethodsBreakdown ?? [],
    columns: methodColumns,
    state: { sorting: methodSorting },
    onSortingChange: setMethodSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // ── custom risk tooltip ──
  const RiskTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border bg-popover p-3 shadow-md text-sm space-y-1">
        <p className="font-medium mb-1">{label}</p>
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground capitalize">{p.name}:</span>
            <span className="font-semibold">{p.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">

      {/* ── KPIs ──────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Secure Score" value={data ? `${data.secureScore} / ${data.secureScoreMax}` : undefined} loading={loading} />
        <KPICard title="Secure Score %" value={data ? `${data.secureScorePercent}%` : undefined} loading={loading} valueColor={data && data.secureScorePercent < 70 ? C.red : C.green} />
        <KPICard title="MFA Coverage" value={data ? `${data.mfaEnabledPercent}%` : undefined} loading={loading} />
        <KPICard title="CA Policies (Enabled)" value={data?.enabledCAPs} loading={loading} />
      </div>

      {/* ── Score history + Score by category ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Secure Score History</CardTitle>
            <ExportBtn filename="secure-score-history.csv" csvData={data?.secureScoreHistory ?? []} />
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
            <ExportBtn filename="score-by-category.csv" csvData={data?.controlCategories ?? []} />
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

      {/* ── MFA donut + CA donut ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* MFA donut WITH collapsible user table inside */}
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">MFA Registration Status</CardTitle>
            <ExportBtn filename="mfa-status.csv" csvData={mfaDonutData} />
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? <Skeleton className="w-full h-[220px]" /> : (
              <>
                {/* Donut + legend */}
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

                {/* Expand / collapse user details */}
                <button
                  onClick={() => setMfaUsersOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md border text-sm font-medium transition-colors hover:bg-muted/50"
                >
                  <span>View user-level MFA details ({data?.mfaUsersList?.length ?? 0} users)</span>
                  {mfaUsersOpen
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>

                {/* User table — only rendered when open */}
                {mfaUsersOpen && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Input
                        placeholder="Filter by name or email…"
                        value={mfaUserFilter}
                        onChange={(e) => setMfaUserFilter(e.target.value)}
                        className="max-w-xs"
                      />
                      <div className="flex gap-2 text-sm text-muted-foreground">
                        <button onClick={() => setMfaUserFilter("")} className="underline hover:text-foreground transition-colors">All</button>
                        <span>·</span>
                        <button
                          onClick={() => { setMfaUserFilter(""); setMfaUserSorting([{ id: "isMfaRegistered", desc: false }]); }}
                          className="underline hover:text-foreground transition-colors"
                        >
                          Not Registered First
                        </button>
                      </div>
                      <ExportBtn
                        filename="mfa-users.csv"
                        csvData={(data?.mfaUsersList ?? []).map((u) => ({
                          Name: u.displayName, UPN: u.userPrincipalName,
                          MFARegistered: u.isMfaRegistered, Methods: u.methodsRegistered.join(", "),
                          Passwordless: u.isPasswordlessCapable, AccountEnabled: u.accountEnabled, Type: u.userType,
                        }))}
                      />
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
                              <TableRow
                                key={row.id}
                                className={!row.original.isMfaRegistered ? "bg-red-50/40 dark:bg-red-950/10" : ""}
                              >
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
                        Showing{" "}
                        {mfaUserTable.getState().pagination.pageIndex * mfaUserTable.getState().pagination.pageSize + (mfaUserTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)}{" "}
                        –{" "}
                        {Math.min(
                          (mfaUserTable.getState().pagination.pageIndex + 1) * mfaUserTable.getState().pagination.pageSize,
                          mfaUserTable.getFilteredRowModel().rows.length
                        )}{" "}
                        of {mfaUserTable.getFilteredRowModel().rows.length}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => mfaUserTable.previousPage()} disabled={!mfaUserTable.getCanPreviousPage()}>Previous</Button>
                        <Button variant="outline" size="sm" onClick={() => mfaUserTable.nextPage()} disabled={!mfaUserTable.getCanNextPage()}>Next</Button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* CA donut */}
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">CA Policies by State</CardTitle>
            <ExportBtn filename="ca-policies-summary.csv" csvData={caPolicyData} />
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

      {/* ── Sign-in Risk Timeline ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Sign-in Risk Timeline</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Risk detections from Identity Protection, by level</p>
          </div>
          <ExportBtn
            filename="risk-timeline.csv"
            csvData={riskTimeline.map((d) => ({ Date: d.date, High: d.high, Medium: d.medium, Low: d.low, Total: d.total }))}
          />
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="w-full h-[260px]" /> : !hasRiskData ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <ShieldCheck className="w-10 h-10 text-green-500" />
              <p className="font-medium text-sm">No risk detections found</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                No risky sign-in events were detected in your tenant. This may also indicate the
                <code className="bg-muted px-1 rounded mx-1">IdentityRiskEvent.Read.All</code>
                permission has not been granted.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* KPI strip */}
              <div className="grid grid-cols-3 gap-3">
                {(["high", "medium", "low"] as const).map((level) => {
                  const total = riskTimeline.reduce((s, d) => s + d[level], 0);
                  const color = level === "high" ? C.red : level === "medium" ? C.orange : C.yellow;
                  return (
                    <div key={level} className="p-3 rounded-md border flex flex-col items-center gap-1">
                      <p className="text-xs text-muted-foreground capitalize">{level} Risk</p>
                      <p className="text-2xl font-bold" style={{ color }}>{total}</p>
                    </div>
                  );
                })}
              </div>

              {/* Stacked area chart */}
              <ResponsiveContainer width="100%" height={240} debounce={0}>
                <AreaChart data={riskTimeline} margin={{ left: -20, right: 10, top: 4, bottom: 0 }}>
                  <defs>
                    {[
                      { id: "gradHigh",   color: C.red },
                      { id: "gradMedium", color: C.orange },
                      { id: "gradLow",    color: C.yellow },
                    ].map(({ id, color }) => (
                      <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.6} />
                        <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} tickFormatter={(v) => formatDate(v, "MMM d")} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                  <Tooltip content={<RiskTooltip />} isAnimationActive={false} />
                  <Legend />
                  <Area type="monotone" dataKey="high"   name="High"   stackId="1" fill="url(#gradHigh)"   stroke={C.red}    strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" dataKey="medium" name="Medium" stackId="1" fill="url(#gradMedium)" stroke={C.orange} strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" dataKey="low"    name="Low"    stackId="1" fill="url(#gradLow)"    stroke={C.yellow} strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>

              {/* Risky users still at risk */}
              {(data?.riskyUsersDetail?.length ?? 0) > 0 && (
                <div className="space-y-2 pt-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    Users currently at risk ({data!.riskyUsersDetail!.length})
                  </p>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Risk Level</TableHead>
                          <TableHead>Risk State</TableHead>
                          <TableHead>Last Updated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data!.riskyUsersDetail!.map((u) => (
                          <TableRow key={u.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-sm">{u.displayName}</p>
                                <p className="text-xs text-muted-foreground">{u.userPrincipalName}</p>
                              </div>
                            </TableCell>
                            <TableCell><RiskBadge level={u.riskLevel} /></TableCell>
                            <TableCell><span className="text-sm capitalize text-muted-foreground">{u.riskState}</span></TableCell>
                            <TableCell><span className="text-xs text-muted-foreground">{formatDate(u.riskLastUpdatedDateTime)}</span></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── MFA Method Strength ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">MFA Method Strength</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Ranked by Microsoft's authentication strength guidance</p>
          </div>
          <ExportBtn
            filename="mfa-methods.csv"
            csvData={(data?.mfaMethodsBreakdown ?? []).map((m) => ({
              Method: m.displayName, Strength: m.strength, Users: m.count, "% of Users": m.percentOfUsers,
            }))}
          />
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
            <div className="space-y-5">
              {/* Strength legend */}
              <div className="flex flex-wrap gap-3">
                {STRENGTH_ORDER.filter((s) => (data?.mfaMethodsBreakdown ?? []).some((m) => m.strength === s)).map((s) => (
                  <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STRENGTH_COLOR[s] }} />
                    {s}
                  </div>
                ))}
              </div>

              {/* Horizontal bar chart */}
              <ResponsiveContainer width="100%" height={methodChartData.length * 36 + 20} debounce={0}>
                <BarChart data={methodChartData} layout="vertical" margin={{ left: 8, right: 50, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} allowDecimals={false} />
                  <YAxis type="category" dataKey="displayName" tick={{ fontSize: 11, fill: tickColor }} stroke="none" width={190} />
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

      {/* ── CA Policy detail table ────────────────────────────────────────────── */}
      <CollapsibleSection
        title="Conditional Access Policies"
        description={!loading && data?.caPolicies ? `${data.caPolicies.length} policies total` : undefined}
        actions={<ExportBtn
            filename="conditional-access-policies.csv"
            csvData={(data?.caPolicies ?? []).map((p) => ({
              Name: p.displayName, State: p.state, "Target Users": p.targetUsers,
              "Target Apps": p.targetApps, "Auth Requirement": p.authStrength,
              "Last Modified": p.modifiedDateTime ?? "",
            }))}
          />}
      >
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-64" />
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              <Input placeholder="Search policies…" value={caFilter} onChange={(e) => setCaFilter(e.target.value)} className="max-w-sm" />
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
                  Showing{" "}
                  {caTable.getState().pagination.pageIndex * caTable.getState().pagination.pageSize + (caTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)}{" "}
                  –{" "}
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
      </CollapsibleSection>

      {/* ── Security Settings (Secure Score Controls) ───────────────────────── */}
      <CollapsibleSection
        title={<><Settings2 className="w-4 h-4 text-muted-foreground" /> Security Settings</>}
        description={controls.length > 0 ? `${controls.length} Secure Score controls evaluated by Microsoft` : "Secure Score control data"}
        actions={<ExportBtn
            filename="security-settings.csv"
            csvData={controls.map((c) => ({
              Control: c.controlName,
              Category: c.controlCategory,
              Status: c.status,
              "Score %": c.scoreInPercentage,
              Details: c.implementationStatus,
              "Last Synced": c.lastSynced ?? "",
            }))}
          />}
      >
          {loading ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-3">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : controls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <ShieldAlert className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No Secure Score control data available.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Status KPIs */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Configured", count: configuredCount, statusKey: "configured", color: "#009118" },
                  { label: "Partial", count: partialCount, statusKey: "partial", color: "#eab308" },
                  { label: "Not Configured", count: notConfiguredCount, statusKey: "notConfigured", color: "#A60808" },
                ].map((item) => (
                  <button
                    key={item.statusKey}
                    onClick={() => setSettingsStatusFilter(settingsStatusFilter === item.statusKey ? "All" : item.statusKey)}
                    className={`p-3 rounded-md border text-left transition-all ${
                      settingsStatusFilter === item.statusKey
                        ? "ring-2 ring-primary border-primary"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <p className="text-2xl font-bold" style={{ color: item.color }}>{item.count}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.label}</p>
                    <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${controls.length > 0 ? (item.count / controls.length) * 100 : 0}%`, backgroundColor: item.color }}
                      />
                    </div>
                  </button>
                ))}
              </div>

              {/* Filters */}
              <div className="flex items-center gap-3 flex-wrap">
                <Input
                  placeholder="Search controls…"
                  value={settingsFilter}
                  onChange={(e) => setSettingsFilter(e.target.value)}
                  className="max-w-xs"
                />
                <select
                  value={settingsCategoryFilter}
                  onChange={(e) => setSettingsCategoryFilter(e.target.value)}
                  className="text-sm border rounded px-2 py-1.5 bg-background text-foreground"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                {(settingsStatusFilter !== "All" || settingsCategoryFilter !== "All" || settingsFilter) && (
                  <button
                    onClick={() => { setSettingsStatusFilter("All"); setSettingsCategoryFilter("All"); setSettingsFilter(""); }}
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    Clear filters
                  </button>
                )}
              </div>

              {/* Table */}
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {settingsTable.getHeaderGroups().map((hg) => (
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
                    {settingsTable.getRowModel().rows.length > 0 ? (
                      settingsTable.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className={
                            row.original.status === "notConfigured"
                              ? "bg-red-50/30 dark:bg-red-950/10"
                              : row.original.status === "partial"
                              ? "bg-yellow-50/20 dark:bg-yellow-950/10"
                              : ""
                          }
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id} className="py-2 align-top">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={secureScoreControlColumns.length} className="h-16 text-center text-muted-foreground">
                          No controls match the filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {settingsTable.getFilteredRowModel().rows.length} of {controls.length} controls
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => settingsTable.previousPage()} disabled={!settingsTable.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => settingsTable.nextPage()} disabled={!settingsTable.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
      </CollapsibleSection>

      {/* SECTION 6 — MICROSOFT DEFENDER / SECURITY CHECKLIST */}
      <ChecklistTable sectionTitle="Microsoft Defender" groups={securityChecklist} loading={loading} />

    </div>
  );
}
