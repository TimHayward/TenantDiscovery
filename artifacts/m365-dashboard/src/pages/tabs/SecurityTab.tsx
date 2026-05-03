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
  const { data, isLoading, isFetching } = useGetM365Security();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const loading = isLoading || isFetching;

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

  const resetSecuritySections = () => {
    ["security-mfa-strength", "security-ca-policies", "security-settings"].forEach((key) => {
      try {
        localStorage.removeItem(`m365-section:${key}`);
      } catch {}
    });
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">Security</h2>
        </div>
        <Button variant="outline" size="sm" onClick={resetSecuritySections}>Collapse All / Expand All</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Secure Score" value={data ? `${data.secureScore} / ${data.secureScoreMax}` : undefined} loading={loading} />
        <KPICard title="Secure Score %" value={data ? `${data.secureScorePercent}%` : undefined} loading={loading} valueColor={data && data.secureScorePercent < 70 ? C.red : C.green} />
        <KPICard title="MFA Coverage" value={data ? `${data.mfaEnabledPercent}%` : undefined} loading={loading} />
        <KPICard title="CA Policies (Enabled)" value={data?.enabledCAPs} loading={loading} />
      </div>
    </div>
  );
}
