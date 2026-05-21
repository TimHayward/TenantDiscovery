import { useGetM365SecurityWithMetadata } from "@workspace/api-client-react";
import { ChecklistTable, type ChecklistGroup } from "@/components/ChecklistTable";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LabelList,
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
} from "@workspace/api-client-react";
import { getMetricDataSourceEntry } from "@workspace/permissions-manifest";

const C = {
  blue:   "#1E3D59",
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

function RiskTooltip({ active, payload, label }: any) {
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
}

function renderTable<T>(table: ReturnType<typeof useReactTable<T>>, emptyMsg = "No data.") {
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
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
          {table.getRowModel().rows.length > 0 ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={table.getAllColumns().length} className="h-16 text-center text-muted-foreground">
                {emptyMsg}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

const methodColumns: ColumnDef<MfaMethodStrengthItem>[] = [
  { accessorKey: "strengthLevel", header: "Strength", cell: ({ row }) => <StrengthBadge strength={row.original.strength} /> },
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

export function SecurityTab() {
  const { data: securityWithMetadata, isLoading, isFetching } = useGetM365SecurityWithMetadata();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const loading = isLoading || isFetching;
  const data = securityWithMetadata?.data;
  const fieldMetadata = securityWithMetadata?.fieldMetadata ?? {};

  const metricToFieldMap: Record<string, string> = {
    "security.secureScore": "secureScore",
    "security.secureScorePercent": "secureScorePercent",
    "security.mfaCoverage": "mfaEnabledUsers",
    "security.enabledCAPs": "conditionalAccessPolicies",
    "security.riskyUsers": "riskyUsersDetail",
    "security.mfaDisabledUsers": "mfaDisabledUsers",
  };

  const getMetricMeta = (metricId: string) => {
    const field = metricToFieldMap[metricId];
    return field ? fieldMetadata[field] : undefined;
  };

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

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

  const scoreBreakdown = useMemo(() => {
    if (!data) return [];
    const fmt = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));
    const overall = {
      name: "Secure Score",
      percent: data.secureScorePercent,
      label: `${data.secureScorePercent}%  (${fmt(data.secureScore)} / ${data.secureScoreMax})`,
    };
    const cats = (data.controlCategories ?? []).map((c) => {
      const pct = c.maxScore > 0 ? Math.round((c.score / c.maxScore) * 100) : 0;
      return {
        name: c.category,
        percent: pct,
        label: `${pct}%  (${fmt(c.score)} / ${c.maxScore})`,
      };
    });
    return [overall, ...cats];
  }, [data]);
  const phishingResistantCount = data?.mfaMethodsBreakdown?.find((method) => method.strength === "Phishing-resistant")?.count ?? 0;

  const getChecklistMeta = (metricId: string) => getMetricDataSourceEntry(metricId);

  const securityChecklist: ChecklistGroup[] = [
    {
      id: "6.1",
      title: "6.1 Secure Score is monitored and benchmarked",
      items: [{
        label: "Secure Score remains above minimum posture target",
        status: (data?.secureScorePercent ?? 0) >= 70 ? "pass" : (data?.secureScorePercent ?? 0) >= 50 ? "warning" : "fail",
        detail: data ? `${data.secureScorePercent}%` : undefined,
        metricId: "security.checklist.6.1.secureScore",
        evidenceStatus: getChecklistMeta("security.checklist.6.1.secureScore")?.evidenceStatus,
        confidenceLabel: getChecklistMeta("security.checklist.6.1.secureScore")?.confidenceLabel,
        sourceLabel: "Secure Score",
      }],
    },
    {
      id: "6.2",
      title: "6.2 MFA coverage for users is maintained",
      items: [{
        label: "MFA registration coverage for users is at acceptable level",
        status: (data?.mfaEnabledPercent ?? 0) >= 90 ? "pass" : (data?.mfaEnabledPercent ?? 0) >= 75 ? "warning" : "fail",
        detail: data ? `${data.mfaEnabledPercent}% coverage` : undefined,
        metricId: "security.checklist.6.2.mfaCoverage",
        evidenceStatus: getChecklistMeta("security.checklist.6.2.mfaCoverage")?.evidenceStatus,
        confidenceLabel: getChecklistMeta("security.checklist.6.2.mfaCoverage")?.confidenceLabel,
        sourceLabel: "Registration report",
      }],
    },
    {
      id: "6.3",
      title: "6.3 Conditional Access baseline policies are active",
      items: [{
        label: "Conditional Access baseline controls are enabled",
        status: (data?.enabledCAPs ?? 0) >= 3 ? "pass" : (data?.enabledCAPs ?? 0) > 0 ? "warning" : "fail",
        detail: data ? `${data.enabledCAPs} enabled policy${data.enabledCAPs === 1 ? "" : "ies"}` : undefined,
        metricId: "security.checklist.6.3.conditionalAccess",
        evidenceStatus: getChecklistMeta("security.checklist.6.3.conditionalAccess")?.evidenceStatus,
        confidenceLabel: getChecklistMeta("security.checklist.6.3.conditionalAccess")?.confidenceLabel,
        sourceLabel: "Conditional Access",
      }],
    },
    {
      id: "6.4",
      title: "6.4 Risky users are identified and remediated",
      items: [{
        label: "Risky user backlog is managed",
        status: (data?.riskyUsers ?? 0) === 0 ? "pass" : (data?.riskyUsers ?? 0) <= 5 ? "warning" : "fail",
        detail: data ? `${data.riskyUsers} risky user${data.riskyUsers === 1 ? "" : "s"}` : undefined,
        metricId: "security.checklist.6.4.riskyUsers",
        evidenceStatus: getChecklistMeta("security.checklist.6.4.riskyUsers")?.evidenceStatus,
        confidenceLabel: getChecklistMeta("security.checklist.6.4.riskyUsers")?.confidenceLabel,
        sourceLabel: "Identity Protection",
      }],
    },
    {
      id: "6.5",
      title: "6.5 Risk detections are triaged within agreed SLA",
      items: [{
        label: "SOC triage SLA for identity risk detections is evidenced",
        status: "manual",
        metricId: "security.checklist.6.5.riskDetectionResponse",
        evidenceStatus: getChecklistMeta("security.checklist.6.5.riskDetectionResponse")?.evidenceStatus,
        confidenceLabel: getChecklistMeta("security.checklist.6.5.riskDetectionResponse")?.confidenceLabel,
      }],
    },
    {
      id: "6.6",
      title: "6.6 Phishing-resistant authentication is adopted",
      items: [{
        label: "Privileged users use phishing-resistant methods",
        status: phishingResistantCount > 0 ? "warning" : "manual",
        detail: phishingResistantCount > 0 ? `${phishingResistantCount} users registered` : "Manual Check Required",
        metricId: "security.checklist.6.6.phishingResistantMfa",
        evidenceStatus: getChecklistMeta("security.checklist.6.6.phishingResistantMfa")?.evidenceStatus,
        confidenceLabel: getChecklistMeta("security.checklist.6.6.phishingResistantMfa")?.confidenceLabel,
      }],
    },
    {
      id: "6.7",
      title: "6.7 Legacy authentication paths are blocked",
      items: [{
        label: "Legacy authentication protocols are effectively blocked",
        status: "manual",
        metricId: "security.checklist.6.7.legacyAuthBlocked",
        evidenceStatus: getChecklistMeta("security.checklist.6.7.legacyAuthBlocked")?.evidenceStatus,
        confidenceLabel: getChecklistMeta("security.checklist.6.7.legacyAuthBlocked")?.confidenceLabel,
      }],
    },
    {
      id: "6.8",
      title: "6.8 Secure Score control backlog is tracked",
      items: [{
        label: "Not-configured Secure Score controls are actively reduced",
        status: notConfiguredCount === 0 ? "pass" : notConfiguredCount <= 10 ? "warning" : "fail",
        detail: `${notConfiguredCount} control${notConfiguredCount === 1 ? "" : "s"} not configured`,
        metricId: "security.checklist.6.8.controlBacklog",
        evidenceStatus: getChecklistMeta("security.checklist.6.8.controlBacklog")?.evidenceStatus,
        confidenceLabel: getChecklistMeta("security.checklist.6.8.controlBacklog")?.confidenceLabel,
      }],
    },
    {
      id: "6.9",
      title: "6.9 Incident response runbooks are validated",
      items: [{
        label: "Security incident-response runbooks are current and tested",
        status: "manual",
        metricId: "security.checklist.6.9.incidentResponse",
        evidenceStatus: getChecklistMeta("security.checklist.6.9.incidentResponse")?.evidenceStatus,
        confidenceLabel: getChecklistMeta("security.checklist.6.9.incidentResponse")?.confidenceLabel,
      }],
    },
  ];

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

  const [methodSorting, setMethodSorting] = useState<SortingState>([{ id: "strengthLevel", desc: true }]);

  const methodTable = useReactTable({
    data: data?.mfaMethodsBreakdown ?? [],
    columns: methodColumns,
    state: { sorting: methodSorting },
    onSortingChange: setMethodSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const [resetKey, setResetKey] = useState(0);

  const resetSecuritySections = () => {
    ["security-score-breakdown", "security-mfa", "security-mfa-strength", "security-ca-policies", "security-settings", "security-mfa-users", "security-risky-users", "security-risk-timeline"].forEach((key) => {
      try { localStorage.removeItem(`m365-section:${key}`); } catch {}
    });
    setResetKey((k) => k + 1);
  };

  return (
    <div key={resetKey} className="space-y-4">

      <CollapsibleSection title="Summary" description="Secure Score, MFA coverage, and Conditional Access overview" storageKey="security-summary" defaultOpen={true} density="compact" actions={<Button variant="outline" size="sm" onClick={resetSecuritySections}>Reset Sections</Button>}>
      <div className="space-y-4">
      {/* ── KPIs ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <KPICard
          title="Secure Score"
          value={data ? `${data.secureScore} / ${data.secureScoreMax}` : undefined}
          loading={loading}
          evidenceStatus={getMetricMeta("security.secureScore")?.evidenceStatus}
          confidenceLabel={getMetricMeta("security.secureScore")?.confidenceLabel}
        />
        <KPICard
          title="Score %"
          value={data ? `${data.secureScorePercent}%` : undefined}
          loading={loading}
          valueColor={data && data.secureScorePercent < 70 ? C.red : C.green}
          evidenceStatus={getMetricMeta("security.secureScorePercent")?.evidenceStatus}
          confidenceLabel={getMetricMeta("security.secureScorePercent")?.confidenceLabel}
        />
        <KPICard
          title="MFA Coverage"
          value={data ? `${data.mfaEnabledPercent}%` : undefined}
          loading={loading}
          valueColor={data && data.mfaEnabledPercent < 80 ? C.red : C.green}
          evidenceStatus={getMetricMeta("security.mfaCoverage")?.evidenceStatus}
          confidenceLabel={getMetricMeta("security.mfaCoverage")?.confidenceLabel}
        />
        <KPICard
          title="CA Policies (Active)"
          value={data?.enabledCAPs}
          loading={loading}
          valueColor={C.blue}
          evidenceStatus={getMetricMeta("security.enabledCAPs")?.evidenceStatus}
          confidenceLabel={getMetricMeta("security.enabledCAPs")?.confidenceLabel}
        />
        <KPICard
          title="Risky Users"
          value={data?.riskyUsers}
          loading={loading}
          valueColor={(data?.riskyUsers ?? 0) > 0 ? C.red : C.green}
          evidenceStatus={getMetricMeta("security.riskyUsers")?.evidenceStatus}
          confidenceLabel={getMetricMeta("security.riskyUsers")?.confidenceLabel}
        />
        <KPICard
          title="MFA Not Registered"
          value={data?.mfaDisabledUsers}
          loading={loading}
          valueColor={(data?.mfaDisabledUsers ?? 0) > 0 ? C.orange : C.green}
          evidenceStatus={getMetricMeta("security.mfaDisabledUsers")?.evidenceStatus}
          confidenceLabel={getMetricMeta("security.mfaDisabledUsers")?.confidenceLabel}
        />
        <KPICard
          title="Legacy Auth Sign-ins"
          value={data == null ? undefined : data.legacyAuthSignInCount == null ? "No access" : data.legacyAuthSignInCount > 0 ? `${data.legacyAuthSignInCount}+` : data.legacyAuthBlockedByCA ? "Blocked" : "0"}
          loading={loading}
          valueColor={
            data == null ? undefined :
            data.legacyAuthSignInCount == null ? undefined :
            data.legacyAuthSignInCount > 0 ? C.red :
            data.legacyAuthBlockedByCA ? C.green : C.orange
          }
        />
      </div>

      {/* ── Secure Score History + Control Categories ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Secure Score Trend */}
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 space-y-0">
            <CardTitle className="text-base">Secure Score Trend</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Last 30 days</p>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[200px]" /> : (
              <ResponsiveContainer width="100%" height={200} debounce={0}>
                <AreaChart data={data?.secureScoreHistory ?? []} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.blue} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={C.blue} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: tickColor }} stroke={tickColor} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: tickColor }} stroke={tickColor} domain={[0, "dataMax"]} />
                  <Tooltip isAnimationActive={false} formatter={(v: number) => [v, "Score"]} />
                  <Area type="monotone" dataKey="score" stroke={C.blue} fill="url(#scoreGradient)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Score by Category */}
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 space-y-0">
            <CardTitle className="text-base">Score by Category</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Control score distribution</p>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[200px]" /> : (
              <ResponsiveContainer width="100%" height={200} debounce={0}>
                <BarChart data={data?.controlCategories ?? []} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: tickColor }} stroke="none" width={120} />
                  <Tooltip isAnimationActive={false} />
                  <Bar dataKey="score" name="Score" fill={C.blue} fillOpacity={0.85} radius={[0, 3, 3, 0]} isAnimationActive={false} />
                  <Bar dataKey="maxScore" name="Max Score" fill={C.gray} fillOpacity={0.35} radius={[0, 3, 3, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
      </div>
      </CollapsibleSection>

      {/* ── Secure Score Breakdown ─────────────────────────────────────────── */}
      <CollapsibleSection
        title="Secure Score Breakdown"
        description={loading ? undefined : `${data?.secureScorePercent ?? 0}% overall · ${(data?.controlCategories ?? []).length} categories`}
        storageKey="security-score-breakdown"
        defaultOpen={true}
        density="compact"
      >
        {loading ? (
          <Skeleton className="w-full h-[220px]" />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, scoreBreakdown.length * 44)} debounce={0}>
            <BarChart data={scoreBreakdown} layout="vertical" margin={{ left: 0, right: 200, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 10, fill: tickColor }}
                stroke={tickColor}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12, fill: tickColor }}
                stroke="none"
                width={105}
              />
              <Tooltip
                isAnimationActive={false}
                formatter={(_v: number, _k: string, entry: { payload?: { label?: string; name?: string } }) => [
                  entry?.payload?.label ?? "—",
                  entry?.payload?.name ?? "",
                ]}
              />
              <Bar dataKey="percent" name="Score %" fill={C.blue} fillOpacity={0.85} radius={[0, 3, 3, 0]} isAnimationActive={false}>
                <LabelList dataKey="label" position="right" fill={tickColor} fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CollapsibleSection>

      {/* ── Risk Detection Timeline ─────────────────────────────────────────── */}
      {(data?.riskDetectionTimeline?.length ?? 0) > 0 && (
        <CollapsibleSection
          title="Risk Detection Timeline"
          description={`${data!.riskDetectionTimeline.length} days with detections`}
          storageKey="security-risk-timeline"
          defaultOpen={true}
          actions={<ExportBtn filename="risk-detections.csv" csvData={data?.riskDetectionTimeline ?? []} />}
        >
          {loading ? <Skeleton className="w-full h-[200px]" /> : (
            <ResponsiveContainer width="100%" height={200} debounce={0}>
              <BarChart data={data?.riskDetectionTimeline ?? []} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: tickColor }} stroke={tickColor} tickFormatter={(v) => v.slice(5)} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: tickColor }} stroke={tickColor} />
                <Tooltip isAnimationActive={false} content={<RiskTooltip />} />
                <Legend />
                <Bar dataKey="high" name="high" stackId="a" fill={C.red} isAnimationActive={false} />
                <Bar dataKey="medium" name="medium" stackId="a" fill={C.orange} isAnimationActive={false} />
                <Bar dataKey="low" name="low" stackId="a" fill={C.yellow} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CollapsibleSection>
      )}

      {/* ── Risky Users ────────────────────────────────────────────────────── */}
      {(data?.riskyUsersDetail?.length ?? 0) > 0 && (
        <CollapsibleSection
          title={<span>Risky Users <Badge className="ml-1 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 font-normal text-xs border-0">{data!.riskyUsersDetail.length}</Badge></span>}
          description="Users currently flagged as at-risk or compromised"
          storageKey="security-risky-users"
          defaultOpen={true}
          actions={<ExportBtn filename="risky-users.csv" csvData={data?.riskyUsersDetail ?? []} />}
        >
          {loading ? <Skeleton className="w-full h-32" /> : (
            <div className="space-y-3">
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
                    {(data?.riskyUsersDetail ?? []).map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <p className="font-medium text-sm">{u.displayName}</p>
                          <p className="text-xs text-muted-foreground">{u.userPrincipalName}</p>
                        </TableCell>
                        <TableCell><RiskBadge level={u.riskLevel} /></TableCell>
                        <TableCell><span className="text-sm capitalize">{u.riskState}</span></TableCell>
                        <TableCell><span className="text-xs text-muted-foreground">{u.riskLastUpdatedDateTime ? formatDate(u.riskLastUpdatedDateTime) : "—"}</span></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* ── MFA ───────────────────────────────────────────────────────────── */}
      <CollapsibleSection
        title="MFA"
        description="Multi-factor authentication method strength and user registration"
        storageKey="security-mfa"
        defaultOpen={true}
        density="compact"
      >
        <div className="space-y-3">
          <CollapsibleSection
            title="MFA Method Strength"
            description={loading ? undefined : `${data?.mfaMethodsBreakdown?.length ?? 0} authentication methods in use`}
            storageKey="security-mfa-strength"
            defaultOpen={true}
            actions={<ExportBtn filename="mfa-methods.csv" csvData={data?.mfaMethodsBreakdown ?? []} />}
          >
            {loading ? <Skeleton className="w-full h-32" /> : renderTable(methodTable, "No MFA method data available.")}
          </CollapsibleSection>

          <CollapsibleSection
            title="MFA User Registration"
            description={loading ? undefined : `${data?.mfaEnabledUsers ?? 0} registered · ${data?.mfaDisabledUsers ?? 0} not registered`}
            storageKey="security-mfa-users"
            defaultOpen={false}
            actions={<ExportBtn filename="mfa-users.csv" csvData={data?.mfaUsersList ?? []} />}
          >
            {loading ? <Skeleton className="w-full h-32" /> : (
              <div className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  <Input
                    placeholder="Filter users…"
                    value={mfaUserFilter}
                    onChange={(e) => setMfaUserFilter(e.target.value)}
                    className="h-8 w-60 text-sm"
                  />
                </div>
                {renderTable(mfaUserTable, "No users found.")}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{mfaUserTable.getFilteredRowModel().rows.length} users</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => mfaUserTable.previousPage()} disabled={!mfaUserTable.getCanPreviousPage()}>Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => mfaUserTable.nextPage()} disabled={!mfaUserTable.getCanNextPage()}>Next</Button>
                  </div>
                </div>
              </div>
            )}
          </CollapsibleSection>
        </div>
      </CollapsibleSection>

      {/* ── Conditional Access Policies ────────────────────────────────────── */}
      <CollapsibleSection
        title="Conditional Access Policies"
        description={loading ? undefined : `${data?.conditionalAccessPolicies ?? 0} total — ${data?.enabledCAPs ?? 0} enabled, ${data?.reportOnlyCAPs ?? 0} report-only, ${data?.disabledCAPs ?? 0} disabled`}
        storageKey="security-ca-policies"
        defaultOpen={true}
        actions={<ExportBtn filename="ca-policies.csv" csvData={data?.caPolicies ?? []} />}
      >
        {loading ? <Skeleton className="w-full h-32" /> : (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Input
                placeholder="Filter policies…"
                value={caFilter}
                onChange={(e) => setCaFilter(e.target.value)}
                className="h-8 w-60 text-sm"
              />
            </div>
            {renderTable(caTable, "No conditional access policies found.")}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{caTable.getFilteredRowModel().rows.length} policies</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => caTable.previousPage()} disabled={!caTable.getCanPreviousPage()}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => caTable.nextPage()} disabled={!caTable.getCanNextPage()}>Next</Button>
              </div>
            </div>
          </div>
        )}
      </CollapsibleSection>

      {/* ── Secure Score Controls ──────────────────────────────────────────── */}
      <CollapsibleSection
        title="Secure Score Controls"
        description={loading ? undefined : `${configuredCount} configured · ${partialCount} partial · ${notConfiguredCount} not configured`}
        storageKey="security-settings"
        defaultOpen={false}
        actions={<ExportBtn filename="secure-score-controls.csv" csvData={filteredControls} />}
      >
        {loading ? <Skeleton className="w-full h-32" /> : (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Input
                placeholder="Filter controls…"
                value={settingsFilter}
                onChange={(e) => setSettingsFilter(e.target.value)}
                className="h-8 w-60 text-sm"
              />
              <select
                value={settingsCategoryFilter}
                onChange={(e) => setSettingsCategoryFilter(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select
                value={settingsStatusFilter}
                onChange={(e) => setSettingsStatusFilter(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {["All", "configured", "partial", "notConfigured"].map((s) => (
                  <option key={s} value={s}>{s === "All" ? "All Statuses" : s === "notConfigured" ? "Not Configured" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            {renderTable(settingsTable, "No controls match the filters.")}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{settingsTable.getFilteredRowModel().rows.length} controls</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => settingsTable.previousPage()} disabled={!settingsTable.getCanPreviousPage()}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => settingsTable.nextPage()} disabled={!settingsTable.getCanNextPage()}>Next</Button>
              </div>
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Summary Check List" description="Security controls assessment" storageKey="security-checklist" defaultOpen={false} density="compact">
        <ChecklistTable sectionTitle="" groups={securityChecklist} loading={loading} />
      </CollapsibleSection>

    </div>
  );
}
