import { useGetM365AdminExposure, useGetM365UsersWithMetadata, useGetM365Security } from "@workspace/api-client-react";
import { EnterpriseAppsSection } from "@/components/EnterpriseAppsSection";
import { ChecklistTable, type ChecklistGroup } from "@/components/ChecklistTable";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { CSVLink } from "react-csv";
import {
  Download, AlertTriangle, Clock, UserX, ShieldOff,
  ClipboardList, ChevronDown, ChevronUp,
} from "lucide-react";
import { useTheme } from "next-themes";
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
import { formatDate } from "@/lib/utils";
import type { UserItem } from "@workspace/api-client-react";
import type { AdminExposureUserItem } from "@workspace/api-client-react";

// ── palette ───────────────────────────────────────────────────────────────────

const C = {
  blue:   "#1E3D59",
  purple: "#795EFF",
  green:  "#009118",
  red:    "#A60808",
  pink:   "#ec4899",
  yellow: "#eab308",
  orange: "#f97316",
};
const PALETTE = [C.blue, C.purple, C.green, C.red, C.pink];

// ── staleness helpers ─────────────────────────────────────────────────────────

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

type StaleBucket = "30-60" | "60-90" | "90+" | "never";

function staleBucket(days: number | null): StaleBucket | null {
  if (days === null) return "never";
  if (days < 30)   return null;        // active
  if (days < 60)   return "30-60";
  if (days < 90)   return "60-90";
  return "90+";
}

const BUCKET_META: Record<StaleBucket, { label: string; color: string; severity: string; bg: string }> = {
  "30-60": { label: "30–60 days",  color: C.yellow, severity: "At Risk",      bg: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  "60-90": { label: "60–90 days",  color: C.orange, severity: "Stale",        bg: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
  "90+":   { label: "90+ days",    color: C.red,    severity: "Very Stale",   bg: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  "never": { label: "Never",       color: C.purple, severity: "Never Signed In", bg: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
};

// Remediation suggestions per bucket
const REMEDIATION: Record<StaleBucket, { icon: React.ComponentType<{ className?: string }>; action: string; detail: string }[]> = {
  "30-60": [
    { icon: Clock,       action: "Send reminder",       detail: "Notify the user and their manager to sign in and verify account access." },
    { icon: ClipboardList, action: "Review account",    detail: "Confirm the account is still needed — check with HR for active employment." },
  ],
  "60-90": [
    { icon: ShieldOff,   action: "Disable sign-in",     detail: "Block sign-in to prevent unauthorised access while retaining mailbox data." },
    { icon: ClipboardList, action: "Remove licenses",   detail: "Reclaim assigned M365 licenses to reduce cost." },
    { icon: AlertTriangle, action: "Notify manager",    detail: "Escalate to the user's manager for confirmation of employment status." },
  ],
  "90+": [
    { icon: UserX,       action: "Disable account",     detail: "Immediately disable sign-in; schedule deletion after a 30-day hold period." },
    { icon: ClipboardList, action: "Remove all licenses", detail: "Remove all assigned licenses to avoid unnecessary spend." },
    { icon: ShieldOff,   action: "Revoke sessions",     detail: "Revoke all active tokens and sessions to prevent residual access." },
    { icon: AlertTriangle, action: "Audit group memberships", detail: "Review and remove from security groups, teams, and distribution lists." },
  ],
  "never": [
    { icon: Clock,       action: "Verify provisioning", detail: "Confirm the account was intentionally created — could be an orphaned or test account." },
    { icon: UserX,       action: "Delete if unused",    detail: "If the account has no mailbox data or group memberships, delete it." },
    { icon: ClipboardList, action: "Remove licenses",   detail: "Reclaim licenses if the user never onboarded." },
  ],
};

// ── stale user table columns ──────────────────────────────────────────────────

type StaleUser = UserItem & { daysInactive: number | null; bucket: StaleBucket };

const staleColumns: ColumnDef<StaleUser>[] = [
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
    accessorKey: "bucket",
    header: "Staleness",
    cell: ({ row }) => {
      const meta = BUCKET_META[row.original.bucket];
      return <Badge className={`${meta.bg} font-normal text-xs border-0`}>{meta.severity}</Badge>;
    },
  },
  {
    accessorKey: "daysInactive",
    header: "Days Inactive",
    cell: ({ row }) => {
      const d = row.original.daysInactive;
      if (d === null) return <span className="text-muted-foreground text-sm">Never</span>;
      return <span className="font-semibold text-sm">{d}</span>;
    },
  },
  {
    accessorKey: "lastSignIn",
    header: "Last Sign-In",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{formatDate(row.original.lastSignIn) || "Never"}</span>
    ),
  },
  {
    accessorKey: "accountEnabled",
    header: "Status",
    cell: ({ row }) =>
      row.original.accountEnabled
        ? <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-normal text-xs border-0">Active</Badge>
        : <Badge variant="outline" className="text-muted-foreground font-normal text-xs">Disabled</Badge>,
  },
  {
    accessorKey: "userType",
    header: "Type",
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.userType}</span>,
  },
  {
    accessorKey: "assignedLicenses",
    header: "Licenses",
    cell: ({ row }) => <span className="text-sm">{row.original.assignedLicenses}</span>,
  },
  {
    accessorKey: "department",
    header: "Department",
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.department || "—"}</span>,
  },
];

// ── all-users table columns ───────────────────────────────────────────────────

const allColumns: ColumnDef<UserItem>[] = [
  {
    accessorKey: "displayName",
    header: "Display Name",
    cell: ({ row }) => <span className="font-medium text-sm">{row.original.displayName}</span>,
  },
  {
    accessorKey: "userPrincipalName",
    header: "UPN",
    cell: ({ row }) => <span className="text-muted-foreground text-sm">{row.original.userPrincipalName}</span>,
  },
  {
    accessorKey: "userType",
    header: "Type",
    cell: ({ row }) => <span className="text-sm">{row.original.userType}</span>,
  },
  {
    accessorKey: "mfaEnabled",
    header: "MFA",
    cell: ({ row }) =>
      row.original.mfaEnabled
        ? <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal text-xs border-0">Enabled</Badge>
        : <Badge variant="outline" className="text-muted-foreground font-normal text-xs">Disabled</Badge>,
  },
  {
    accessorKey: "assignedLicenses",
    header: "Licenses",
    cell: ({ row }) => <span className="text-sm">{row.original.assignedLicenses}</span>,
  },
  {
    accessorKey: "department",
    header: "Department",
    cell: ({ row }) => <span className="text-sm">{row.original.department || "—"}</span>,
  },
  {
    accessorKey: "lastSignIn",
    header: "Last Sign-In",
    cell: ({ row }) => <span className="text-sm">{formatDate(row.original.lastSignIn) || "Never"}</span>,
  },
  {
    accessorKey: "accountEnabled",
    header: "Status",
    cell: ({ row }) =>
      row.original.accountEnabled
        ? <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-normal text-xs border-0">Active</Badge>
        : <Badge variant="destructive" className="font-normal text-xs">Disabled</Badge>,
  },
];

const adminExposureColumns: ColumnDef<AdminExposureUserItem>[] = [
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
    accessorKey: "roles",
    header: "Roles",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.roles.join(", ") || "—"}</span>
    ),
  },
  {
    accessorKey: "accountEnabled",
    header: "Status",
    cell: ({ row }) =>
      row.original.accountEnabled ? (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-normal text-xs border-0">Active</Badge>
      ) : (
        <Badge variant="destructive" className="font-normal text-xs">Disabled</Badge>
      ),
  },
  {
    accessorKey: "hasProductivityLicense",
    header: "Productivity",
    cell: ({ row }) =>
      row.original.hasProductivityLicense ? (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal text-xs border-0">Enabled</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground font-normal text-xs">Not Enabled</Badge>
      ),
  },
];

function AdminExposureTableSection({
  title,
  storageKey,
  rows,
  loading,
}: {
  title: string;
  storageKey: string;
  rows: AdminExposureUserItem[];
  loading: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");

  const table = useReactTable({
    data: rows,
    columns: adminExposureColumns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  return (
    <CollapsibleSection
      title={`${title} (${rows.length})`}
      storageKey={storageKey}
      density="compact"
      contentClassName="px-4 pb-3"
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            placeholder="Search users…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-sm"
          />
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((header) => (
                      <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none whitespace-nowrap h-8 py-1">
                        <div className="flex items-center gap-2">
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
                        <TableCell key={cell.id} className="py-1.5 align-top">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={adminExposureColumns.length} className="h-16 text-center text-muted-foreground">
                      No results found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing{" "}
              {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + (table.getFilteredRowModel().rows.length > 0 ? 1 : 0)}{" "}
              –{" "}
              {Math.min(
                (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                table.getFilteredRowModel().rows.length
              )}{" "}
              of {table.getFilteredRowModel().rows.length}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
            </div>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export function UsersTab() {
  const { data: usersWithMetadata, isLoading, isFetching } = useGetM365UsersWithMetadata();
  const {
    data: adminExposure,
    isLoading: isAdminExposureLoading,
    isFetching: isAdminExposureFetching,
  } = useGetM365AdminExposure();
  const { data: sec } = useGetM365Security();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const loading = isLoading || isFetching;

  const data = usersWithMetadata?.data;
  const fieldMetadata = usersWithMetadata?.fieldMetadata ?? {};
  const adminExposureLoading = isAdminExposureLoading || isAdminExposureFetching;

  const getFieldMeta = (field: string) => fieldMetadata[field];

  const CHECKLIST_FIELD_MAP: Record<string, string> = {
    "users.checklist.1.1.mfaAllUsers": "mfaEnabled",
    "users.checklist.1.2.mfaAdmins": "mfaEnabled",
    "users.checklist.1.12.staleAccounts": "neverSignedIn",
    "users.checklist.2.1.globalAdminCount": "memberUsers",
    "users.checklist.2.2.globalAdminCloudOnly": "memberUsers",
    "users.checklist.1.4.breakGlassUsers": "users",
  };

  const getChecklistMeta = (metricId: string) => {
    const field = CHECKLIST_FIELD_MAP[metricId];
    return field ? getFieldMeta(field) : undefined;
  };

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  // ── stale account computation ──────────────────────────────────────────────
  const staleUsers = useMemo<StaleUser[]>(() => {
    if (!data?.users) return [];
    return data.users
      .map((u) => {
        const d = daysSince(u.lastSignIn);
        const bucket = staleBucket(d);
        if (!bucket) return null;
        return { ...u, daysInactive: d, bucket } as StaleUser;
      })
      .filter((u): u is StaleUser => u !== null)
      .sort((a, b) => (b.daysInactive ?? Infinity) - (a.daysInactive ?? Infinity));
  }, [data]);

  const staleCounts = useMemo(() => ({
    "30-60": staleUsers.filter((u) => u.bucket === "30-60").length,
    "60-90": staleUsers.filter((u) => u.bucket === "60-90").length,
    "90+":   staleUsers.filter((u) => u.bucket === "90+").length,
    "never": staleUsers.filter((u) => u.bucket === "never").length,
  }), [staleUsers]);

  const staleChartData = useMemo(() => (
    (["30-60", "60-90", "90+", "never"] as StaleBucket[])
      .map((b) => ({ name: BUCKET_META[b].label, count: staleCounts[b], color: BUCKET_META[b].color }))
      .filter((d) => d.count > 0)
  ), [staleCounts]);

  // ── stale table state ──────────────────────────────────────────────────────
  const [staleBucketFilter, setStaleBucketFilter] = useState<StaleBucket | "all">("all");
  const [staleFilter, setStaleFilter] = useState("");
  const [staleSorting, setStaleSorting] = useState<SortingState>([{ id: "daysInactive", desc: true }]);
  const [selectedStaleUser, setSelectedStaleUser] = useState<StaleUser | null>(null);

  const staleRemediationBuckets = useMemo(() => {
    const bucketOrder = ["90+", "60-90", "30-60", "never"] as StaleBucket[];
    if (selectedStaleUser) {
      return [selectedStaleUser.bucket];
    }
    return bucketOrder.filter((bucket) => staleCounts[bucket] > 0);
  }, [selectedStaleUser, staleCounts]);

  const filteredStaleUsers = useMemo(() => (
    staleBucketFilter === "all" ? staleUsers : staleUsers.filter((u) => u.bucket === staleBucketFilter)
  ), [staleUsers, staleBucketFilter]);

  const staleTable = useReactTable({
    data: filteredStaleUsers,
    columns: staleColumns,
    state: { sorting: staleSorting, globalFilter: staleFilter },
    onSortingChange: setStaleSorting,
    onGlobalFilterChange: setStaleFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
  });

  // ── all-users table state ──────────────────────────────────────────────────
  const [allSorting, setAllSorting] = useState<SortingState>([]);
  const [allFilter, setAllFilter] = useState("");

  const allTable = useReactTable({
    data: data?.users ?? [],
    columns: allColumns,
    state: { sorting: allSorting, globalFilter: allFilter },
    onSortingChange: setAllSorting,
    onGlobalFilterChange: setAllFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  // ── donuts ─────────────────────────────────────────────────────────────────
  const typeDonut = data
    ? [
        { name: "Members",  value: data.memberUsers },
        { name: "Guests",   value: data.guestUsers },
        { name: "Disabled", value: data.disabledUsers },
      ].filter((d) => d.value > 0)
    : [];

  const exportBtn = (filename: string, csvData: object[]) =>
    !loading && csvData.length > 0 ? (
      <CSVLink
        data={csvData} filename={filename}
        className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80"
        style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
        aria-label="Export CSV"
      >
        <Download className="w-3.5 h-3.5" />
      </CSVLink>
    ) : null;

  // ── Section 1: Entra ID security checklist ─────────────────────────────────
  const section1Groups = useMemo<ChecklistGroup[]>(() => {
    const caps: Array<{ displayName?: string; state?: string; targetUsers?: string; authStrength?: string }> =
      (sec as { caPolicies?: Array<{ displayName?: string; state?: string; targetUsers?: string; authStrength?: string }> })?.caPolicies ?? [];
    const capEnabled = (kw: string) => caps.some(p => p.displayName?.toLowerCase().includes(kw.toLowerCase()) && p.state === "enabled");
    const capAny    = (kw: string) => caps.some(p => p.displayName?.toLowerCase().includes(kw.toLowerCase()));
    const hasMFAAllUsersEnabled = caps.some(p =>
      (p.targetUsers?.includes("All Users") || p.displayName?.toLowerCase().includes("base protection")) &&
      p.displayName?.toLowerCase().includes("mfa") && p.state === "enabled");
    const hasMFAAdminsEnabled = caps.some(p =>
      p.displayName?.toLowerCase().includes("admin") && p.displayName?.toLowerCase().includes("mfa") && p.state === "enabled");
    const hasAzureMgmtMFA = capAny("privileged systems");
    const hasLegacyAuthPolicy = capAny("other clients") || capAny("active sync");
    const hasLegacyAuthEnabled = capEnabled("other clients") || capEnabled("active sync");
    const breakGlassPresent = (sec as { mfaUsersList?: Array<{ displayName?: string }> })?.mfaUsersList?.some(
      u => u.displayName?.toLowerCase().includes("break glass")) ?? false;
    const mfaDisabledCount = sec?.mfaDisabledUsers ?? data?.mfaDisabled ?? 0;
    const allUsersMFA = mfaDisabledCount === 0;
    const adminsWithoutMfa = sec?.adminsWithoutMfa ?? 0;
    const hasBrowserSessionPolicy = capAny("browser session") || capAny("sign-in frequency");
    const hasHighRiskBlock = capAny("high sign-in risk") || capAny("high user risk");
    const hasCompliantDevicePolicy = capAny("trusted device") || capAny("compliant");
    const hasPhishingResistantAdmin = caps.some(p =>
      p.displayName?.toLowerCase().includes("admin") && p.authStrength?.toLowerCase().includes("phishing") && p.state === "enabled");
    const neverSignedIn = data?.neverSignedIn ?? 0;
    return [
      { id: "1.1", title: "1.1 Multi-factor authentication is enforced for all users", items: [
        { label: "MFA is enforced for all users", status: hasMFAAllUsersEnabled ? "pass" : allUsersMFA ? "warning" : "fail",
          detail: hasMFAAllUsersEnabled ? "Enforced" : allUsersMFA ? "Policy exists but verify enforcement" : `${mfaDisabledCount} user${mfaDisabledCount !== 1 ? "s" : ""} not enrolled`,
          evidenceStatus: getChecklistMeta("users.checklist.1.1.mfaAllUsers")?.evidenceStatus,
          confidenceLabel: getChecklistMeta("users.checklist.1.1.mfaAllUsers")?.confidenceLabel,
          metricId: "users.checklist.1.1.mfaAllUsers",
          sourceLabel: "Conditional Access",
          notes: "This result is API-backed and retrieved directly from the environment.",
        },
        { label: "MFA is enforced for Azure Management", status: hasAzureMgmtMFA ? "warning" : "manual",
          detail: hasAzureMgmtMFA ? "Report Only – not yet enforced" : "Manual Check Required",
          evidenceStatus: getChecklistMeta("users.checklist.1.1.azureMgmtMFA")?.evidenceStatus,
          metricId: "users.checklist.1.1.azureMgmtMFA",
        },
        { label: "Users are enrolled in MFA and covered by a policy", status: allUsersMFA ? "pass" : "fail",
          detail: allUsersMFA ? "All users enrolled" : `${mfaDisabledCount} user${mfaDisabledCount !== 1 ? "s" : ""} not enrolled`,
          evidenceStatus: getChecklistMeta("users.checklist.1.1.mfaEnrollment")?.evidenceStatus,
          confidenceLabel: "high",
          metricId: "users.checklist.1.1.mfaEnrollment",
          sourceLabel: "Graph API",
        },
      ]},
      { id: "1.2", title: "1.2 MFA is required for all Admins", items: [
        { label: "MFA is enforced on accounts with highly privileged roles",
          status: hasMFAAdminsEnabled && adminsWithoutMfa === 0 ? "pass" : hasMFAAdminsEnabled ? "warning" : "fail",
          detail: hasMFAAdminsEnabled && adminsWithoutMfa === 0 ? "Enforced" : hasMFAAdminsEnabled ? `${adminsWithoutMfa} admin${adminsWithoutMfa !== 1 ? "s" : ""} not registered` : "Not Enforced",
          evidenceStatus: getChecklistMeta("users.checklist.1.2.mfaAdmins")?.evidenceStatus,
          confidenceLabel: getChecklistMeta("users.checklist.1.2.mfaAdmins")?.confidenceLabel,
          metricId: "users.checklist.1.2.mfaAdmins",
          sourceLabel: "Conditional Access",
        },
      ]},
      { id: "1.3", title: "1.3 Legacy Authentication is blocked", items: [
        { label: "Legacy Authentication shall be blocked",
          status: hasLegacyAuthEnabled ? "pass" : hasLegacyAuthPolicy ? "warning" : "fail",
          detail: hasLegacyAuthEnabled ? "Enforced" : hasLegacyAuthPolicy ? "Report Only – not yet enforced" : "Not Configured",
          evidenceStatus: getChecklistMeta("users.checklist.1.3.legacyAuth")?.evidenceStatus,
          metricId: "users.checklist.1.3.legacyAuth",
          sourceLabel: "Conditional Access",
        },
      ]},
      { id: "1.4", title: "1.4 Break Glass users are created for emergency access", items: [
        { label: "Break Glass users are created for emergency access",
          status: breakGlassPresent ? "pass" : "fail", detail: breakGlassPresent ? "Present" : "Not Found",
          evidenceStatus: getChecklistMeta("users.checklist.1.4.breakGlassUsers")?.evidenceStatus,
          confidenceLabel: getChecklistMeta("users.checklist.1.4.breakGlassUsers")?.confidenceLabel,
          metricId: "users.checklist.1.4.breakGlassUsers",
          sourceLabel: "Heuristic",
          notes: "Detected by naming pattern; manual verification recommended.",
        },
      ]},
      { id: "1.5", title: "1.5 Ensure that between two and four global admins are designated", items: [
        { label: "Between 2 and 4 global admins designated", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.2.1.globalAdminCount")?.evidenceStatus,
          confidenceLabel: getChecklistMeta("users.checklist.2.1.globalAdminCount")?.confidenceLabel,
          metricId: "users.checklist.2.1.globalAdminCount",
          sourceLabel: "Directory Roles",
        },
      ]},
      { id: "1.6", title: "1.6 Highly privileged accounts shall be cloud-only", items: [
        { label: "All Global Admins are cloud-only accounts", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.2.2.globalAdminCloudOnly")?.evidenceStatus,
          confidenceLabel: getChecklistMeta("users.checklist.2.2.globalAdminCloudOnly")?.confidenceLabel,
          metricId: "users.checklist.2.2.globalAdminCloudOnly",
          sourceLabel: "Directory Roles",
        },
      ]},
      { id: "1.7", title: "1.7 Non-admin users shall be prevented from providing consent to 3rd party applications", items: [
        { label: "Only Admins shall be allowed to register 3rd party applications", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.7.appRegistrationPolicy")?.evidenceStatus,
          metricId: "users.checklist.1.7.appRegistrationPolicy",
        },
        { label: "Non-admin users prevented from providing consent to 3rd party applications", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.7.consentPolicy")?.evidenceStatus,
          metricId: "users.checklist.1.7.consentPolicy",
        },
      ]},
      { id: "1.8", title: "1.8 Guest users have limited access to properties and memberships of directory objects", items: [
        { label: "Guest user access restricted to limited directory properties", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.8.guestAccess")?.evidenceStatus,
          metricId: "users.checklist.1.8.guestAccess",
        },
      ]},
      { id: "1.9", title: "1.9 Passwords shall not expire", items: [
        { label: "Password expiration policy is disabled (passwords do not expire)", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.9.passwordPolicy")?.evidenceStatus,
          metricId: "users.checklist.1.9.passwordPolicy",
        },
      ]},
      { id: "1.10", title: "1.10 MFA shall be required to enrol devices to Azure AD", items: [
        { label: "MFA required for device enrollment", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.10.deviceEnrollmentMfa")?.evidenceStatus,
          metricId: "users.checklist.1.10.deviceEnrollmentMfa",
        },
      ]},
      { id: "1.11", title: "1.11 Local Administrator settings are configured for device joins", items: [
        { label: "Local administrator settings configured for device joins", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.11.localAdminSettings")?.evidenceStatus,
          metricId: "users.checklist.1.11.localAdminSettings",
        },
      ]},
      { id: "1.12", title: "1.12 Dormant Accounts are disabled with 45 days of inactivity", items: [
        { label: "Accounts without sign-in for 45+ days are disabled",
          status: neverSignedIn === 0 ? "pass" : "warning",
          detail: neverSignedIn === 0 ? "No stale accounts detected" : `${neverSignedIn} account${neverSignedIn !== 1 ? "s" : ""} never signed in`,
          evidenceStatus: getChecklistMeta("users.checklist.1.12.staleAccounts")?.evidenceStatus,
          confidenceLabel: getChecklistMeta("users.checklist.1.12.staleAccounts")?.confidenceLabel,
          metricId: "users.checklist.1.12.staleAccounts",
          sourceLabel: "Graph API",
        },
      ]},
      { id: "1.13", title: "1.13 Browser Sessions are limited for Privileged Users", items: [
        { label: "Browser session persistence limited for privileged users",
          status: hasBrowserSessionPolicy ? "warning" : "manual",
          detail: hasBrowserSessionPolicy ? "Report Only – not yet enforced" : "Manual Check Required",
          evidenceStatus: getChecklistMeta("users.checklist.1.13.browserSession")?.evidenceStatus,
          metricId: "users.checklist.1.13.browserSession",
          sourceLabel: "Conditional Access",
        },
      ]},
      { id: "1.14", title: "1.14 Devices shall be deleted that haven't checked in for over 30 days", items: [
        { label: "Stale devices automatically removed or flagged after 30 days", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.14.staleDevices")?.evidenceStatus,
          metricId: "users.checklist.1.14.staleDevices",
        },
      ]},
      { id: "1.15", title: "1.15 All corporate approved applications are catalogued and periodically reviewed", items: [
        { label: "Enterprise applications catalogued and periodically reviewed", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.15.appCatalog")?.evidenceStatus,
          metricId: "users.checklist.1.15.appCatalog",
        },
      ]},
      { id: "1.16", title: "1.16 Dynamic Groups are leveraged for automated group management", items: [
        { label: "Dynamic groups configured for automated user assignment", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.16.dynamicGroups")?.evidenceStatus,
          metricId: "users.checklist.1.16.dynamicGroups",
        },
      ]},
      { id: "1.17", title: "1.17 MFA shall be required for Intune Enrolment", items: [
        { label: "MFA required for Intune device enrollment", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.17.intuneEnrollmentMfa")?.evidenceStatus,
          metricId: "users.checklist.1.17.intuneEnrollmentMfa",
        },
      ]},
      { id: "1.18", title: "1.18 Require Managed Devices for Sign in", items: [
        { label: "Managed device required for sign-in",
          status: hasCompliantDevicePolicy ? "warning" : "manual",
          detail: hasCompliantDevicePolicy ? "Report Only – not yet enforced" : "Manual Check Required",
          evidenceStatus: getChecklistMeta("users.checklist.1.18.managedDevice")?.evidenceStatus,
          metricId: "users.checklist.1.18.managedDevice",
          sourceLabel: "Conditional Access",
        },
      ]},
      { id: "1.19", title: "1.19 Device Compliance is required for access to resources", items: [
        { label: "Device compliance required for resource access",
          status: hasCompliantDevicePolicy ? "warning" : "manual",
          detail: hasCompliantDevicePolicy ? "Report Only – not yet enforced" : "Manual Check Required",
          evidenceStatus: getChecklistMeta("users.checklist.1.19.deviceCompliance")?.evidenceStatus,
          metricId: "users.checklist.1.19.deviceCompliance",
          sourceLabel: "Conditional Access",
        },
      ]},
      { id: "1.20", title: "1.20 Require Phishing Resistant MFA for Admins", items: [
        { label: "Phishing-resistant MFA required for admins",
          status: hasPhishingResistantAdmin ? "pass" : "fail",
          detail: hasPhishingResistantAdmin ? "Enforced" : "Not Configured",
          evidenceStatus: getChecklistMeta("users.checklist.1.20.phishingResistantMfa")?.evidenceStatus,
          confidenceLabel: "high",
          metricId: "users.checklist.1.20.phishingResistantMfa",
          sourceLabel: "Conditional Access",
        },
      ]},
      { id: "1.21", title: "1.21 High risk users and signins are blocked", items: [
        { label: "High risk sign-ins blocked by Conditional Access",
          status: hasHighRiskBlock ? "warning" : "manual",
          detail: hasHighRiskBlock ? "Report Only – not yet enforced" : "Manual Check Required",
          evidenceStatus: getChecklistMeta("users.checklist.1.21.riskBlock")?.evidenceStatus,
          metricId: "users.checklist.1.21.riskBlock",
          sourceLabel: "Conditional Access",
        },
      ]},
      { id: "1.22", title: "1.22 Privileged Identity Management (PIM) is configured for JIT access", items: [
        { label: "PIM used to manage privileged roles", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.22.pim")?.evidenceStatus,
          metricId: "users.checklist.1.22.pim",
        },
        { label: "Approval required for Global Administrator activation", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.22.pimApproval")?.evidenceStatus,
          metricId: "users.checklist.1.22.pimApproval",
        },
      ]},
      { id: "1.23", title: "1.23 Microsoft Sentinel is configured to ingest logs from Entra and Defender", items: [
        { label: "Microsoft Sentinel ingesting logs from Entra ID and Microsoft Defender", status: "manual",
          evidenceStatus: getChecklistMeta("users.checklist.1.23.sentinel")?.evidenceStatus,
          metricId: "users.checklist.1.23.sentinel",
        },
      ]},
    ];
  }, [sec, data]);

  return (
    <div className="space-y-4">

      {/* ── SUMMARY ──────────────────────────────────────────────────────────── */}
      <CollapsibleSection title="Summary" description="KPI overview and user distribution" storageKey="users-summary" defaultOpen={true} density="compact">
      <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <KPICard
          title="Total Users"
          value={data?.totalUsers}
          loading={loading}
          density="compact"
          evidenceStatus={getFieldMeta("totalUsers")?.evidenceStatus}
          confidenceLabel={getFieldMeta("totalUsers")?.confidenceLabel}
        />
        <KPICard
          title="Active Users"
          value={data?.activeUsers}
          loading={loading}
          density="compact"
          evidenceStatus={getFieldMeta("activeUsers")?.evidenceStatus}
          confidenceLabel={getFieldMeta("activeUsers")?.confidenceLabel}
        />
        <KPICard
          title="Disabled Users"
          value={data?.disabledUsers}
          loading={loading}
          density="compact"
          evidenceStatus={getFieldMeta("disabledUsers")?.evidenceStatus}
          confidenceLabel={getFieldMeta("disabledUsers")?.confidenceLabel}
        />
        <KPICard
          title="Guest Users"
          value={data?.guestUsers}
          loading={loading}
          density="compact"
          evidenceStatus={getFieldMeta("guestUsers")?.evidenceStatus}
          confidenceLabel={getFieldMeta("guestUsers")?.confidenceLabel}
        />
        <KPICard
          title="MFA Enabled"
          value={data ? `${Math.round((data.mfaEnabled / (data.totalUsers || 1)) * 100)}%` : undefined}
          loading={loading}
          density="compact"
          evidenceStatus={getFieldMeta("mfaEnabled")?.evidenceStatus}
          confidenceLabel={getFieldMeta("mfaEnabled")?.confidenceLabel}
        />
      </div>

      {/* ── Type donut + Dept bar ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-1">
          <CardHeader className="px-3 pt-3 pb-1.5 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">User Types</CardTitle>
            {exportBtn("user-types.csv", typeDonut)}
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            {loading ? <Skeleton className="w-full h-[220px]" /> : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220} debounce={0}>
                  <PieChart>
                    <Pie data={typeDonut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} cornerRadius={2} paddingAngle={2} isAnimationActive={false} stroke="none">
                      {typeDonut.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4 mt-2">
                  {typeDonut.map((entry, i) => (
                    <div key={entry.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                      <span className="text-muted-foreground">{entry.name}</span>
                      <span className="font-medium">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="px-3 pt-3 pb-1.5 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Users by Department</CardTitle>
            {exportBtn("users-by-department.csv", data?.usersByDepartment ?? [])}
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            {loading ? <Skeleton className="w-full h-[240px]" /> : (
              <ResponsiveContainer width="100%" height={240} debounce={0}>
                <BarChart data={data?.usersByDepartment ?? []} layout="vertical" margin={{ left: 40, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} stroke={gridColor} />
                  <XAxis type="number" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <YAxis type="category" dataKey="department" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} width={100} />
                  <Tooltip isAnimationActive={false} cursor={false} />
                  <Bar dataKey="count" name="Users" fill={C.blue} fillOpacity={0.8} isAnimationActive={false} radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      </div>
      </CollapsibleSection>

      {/* ── STALE ACCOUNTS ───────────────────────────────────────────────────── */}
      <CollapsibleSection title="Stale Accounts" description="Accounts with no sign-in activity — potential security and licensing risk" storageKey="users-stale-section" defaultOpen={true} density="compact">
        <div className="space-y-3">

        {/* Stale KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(["30-60", "60-90", "90+", "never"] as StaleBucket[]).map((b) => {
            const meta = BUCKET_META[b];
            return (
              <button
                key={b}
                onClick={() => setStaleBucketFilter((prev) => prev === b ? "all" : b)}
                className={`text-left rounded-lg border p-3 transition-all hover:shadow-sm ${staleBucketFilter === b ? "ring-2 ring-offset-1" : ""}`}
                style={{ '--tw-ring-color': meta.color } as React.CSSProperties}
              >
                {loading ? (
                  <Skeleton className="h-10 w-16" />
                ) : (
                  <>
                    <p className="text-[11px] text-muted-foreground font-medium mb-1">{meta.label} inactive</p>
                    <p className="text-2xl font-bold leading-none" style={{ color: meta.color }}>{staleCounts[b]}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{meta.severity}</p>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Stale chart + remediation guidance */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Bar chart */}
          <Card className="lg:col-span-1">
            <CardHeader className="px-3 pt-3 pb-1.5 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Stale by Category</CardTitle>
              {exportBtn("stale-by-category.csv", staleChartData)}
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0">
              {loading ? <Skeleton className="w-full h-[180px]" /> : staleChartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[180px] gap-2 text-center">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <span className="text-green-600 dark:text-green-400 text-xl">✓</span>
                  </div>
                  <p className="text-sm font-medium text-green-600 dark:text-green-400">All accounts are active</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={180} debounce={0}>
                  <BarChart data={staleChartData} margin={{ left: -20, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <Tooltip isAnimationActive={false} />
                    <Bar dataKey="count" name="Users" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {staleChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Remediation guidance */}
          <Card className="lg:col-span-2">
            <CardHeader className="px-3 pt-3 pb-1.5">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-muted-foreground" />
                Remediation Guidance
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {selectedStaleUser
                  ? `Actions for ${selectedStaleUser.displayName} (${BUCKET_META[selectedStaleUser.bucket].label} inactive)`
                  : "Click a stale user row for targeted actions"}
              </p>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0">
              {loading ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-[170px] w-full" />)}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {staleRemediationBuckets.length > 0 && (
                    <div className={`grid gap-2 ${selectedStaleUser ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"}`}>
                      {staleRemediationBuckets.map((bucket) => {
                        const actions = REMEDIATION[bucket];
                        const meta = BUCKET_META[bucket];
                        return (
                          <div key={bucket} className="rounded-md border bg-muted/10 p-2">
                            <div className="mb-2 flex items-center gap-2 border-b pb-1.5">
                              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {meta.label} — {meta.severity} ({staleCounts[bucket]})
                              </span>
                            </div>
                            <div className="space-y-1.5">
                              {actions.map(({ icon: Icon, action, detail }) => (
                                <div key={action} className="flex items-start gap-2 rounded-md border bg-background p-2">
                                  <div
                                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
                                    style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
                                  >
                                    <Icon className="h-3 w-3" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="mb-0.5 text-xs font-medium leading-none">{action}</p>
                                    <p className="text-[11px] leading-snug text-muted-foreground">{detail}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!loading && staleUsers.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">No stale accounts found — great hygiene!</p>
                    </div>
                  )}

                  {selectedStaleUser && (
                    <button
                      onClick={() => setSelectedStaleUser(null)}
                      className="text-xs text-muted-foreground underline hover:text-foreground transition-colors mt-1"
                    >
                      ← Back to all recommendations
                    </button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Stale accounts table */}
        <CollapsibleSection
          title={<><AlertTriangle className="w-4 h-4 text-amber-500" /> Stale Account Details{!loading && <Badge variant="outline" className="font-normal text-xs ml-1">{staleUsers.length} accounts</Badge>}</>}
          storageKey="users-stale-accounts"
          density="compact"
          description={!loading && staleBucketFilter !== "all" ? `Filtered: ${BUCKET_META[staleBucketFilter].label} inactive (${filteredStaleUsers.length} users)` : undefined}
          actions={exportBtn("stale-accounts.csv", filteredStaleUsers.map((u) => ({
              Name: u.displayName,
              UPN: u.userPrincipalName,
              Staleness: BUCKET_META[u.bucket].severity,
              "Days Inactive": u.daysInactive ?? "Never",
              "Last Sign-In": u.lastSignIn ?? "Never",
              "Account Enabled": u.accountEnabled,
              Type: u.userType,
              Licenses: u.assignedLicenses,
              Department: u.department ?? "",
            })))}
          contentClassName="px-4 pb-3"
        >
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-64" />
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : staleUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-2">
                  <span className="text-green-600 dark:text-green-400 text-2xl">✓</span>
                </div>
                <p className="font-medium">No stale accounts found</p>
                <p className="text-sm text-muted-foreground">All users have signed in within the last 30 days.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Filter row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <Input
                    placeholder="Search stale accounts…"
                    value={staleFilter}
                    onChange={(e) => setStaleFilter(e.target.value)}
                    className="max-w-xs"
                  />
                  {/* Bucket filter chips */}
                  <div className="flex gap-2 flex-wrap">
                    {(["all", "30-60", "60-90", "90+", "never"] as const).map((b) => {
                      const active = staleBucketFilter === b;
                      const meta = b !== "all" ? BUCKET_META[b] : null;
                      return (
                        <button
                          key={b}
                          onClick={() => setStaleBucketFilter(b)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active ? "text-white border-transparent" : "bg-background hover:bg-muted border-border text-muted-foreground"}`}
                          style={active && meta ? { backgroundColor: meta.color, borderColor: meta.color } : active ? { backgroundColor: "#6b7280" } : {}}
                        >
                          {b === "all" ? `All (${staleUsers.length})` : `${BUCKET_META[b].label} (${staleCounts[b]})`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      {staleTable.getHeaderGroups().map((hg) => (
                        <TableRow key={hg.id}>
                          {hg.headers.map((header) => (
                            <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none whitespace-nowrap h-8 py-1">
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
                      {staleTable.getRowModel().rows.length > 0 ? (
                        staleTable.getRowModel().rows.map((row) => {
                          const isSelected = selectedStaleUser?.id === row.original.id;
                          const rowColor = BUCKET_META[row.original.bucket].color;
                          return (
                            <TableRow
                              key={row.id}
                              onClick={() => setSelectedStaleUser(isSelected ? null : row.original)}
                              className="cursor-pointer transition-colors"
                              style={isSelected ? { backgroundColor: `${rowColor}15` } : {}}
                            >
                              {row.getVisibleCells().map((cell) => (
                                <TableCell key={cell.id} className="py-2 align-top">
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={staleColumns.length} className="h-14 text-center text-muted-foreground">
                            No accounts match the filter.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Showing{" "}
                    {staleTable.getState().pagination.pageIndex * staleTable.getState().pagination.pageSize + (staleTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)}{" "}
                    –{" "}
                    {Math.min(
                      (staleTable.getState().pagination.pageIndex + 1) * staleTable.getState().pagination.pageSize,
                      staleTable.getFilteredRowModel().rows.length
                    )}{" "}
                    of {staleTable.getFilteredRowModel().rows.length}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => staleTable.previousPage()} disabled={!staleTable.getCanPreviousPage()}>Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => staleTable.nextPage()} disabled={!staleTable.getCanNextPage()}>Next</Button>
                  </div>
                </div>

                {!selectedStaleUser && staleUsers.length > 0 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    Click any row to see targeted remediation recommendations
                  </p>
                )}
              </div>
            )}
        </CollapsibleSection>

      {/* ── All Users table ──────────────────────────────────────────────────── */}
      <CollapsibleSection
        title={`All Users Directory (${data?.totalUsers ?? "…"} users)`}
        storageKey="users-all-users"
        density="compact"
        actions={exportBtn("all-users.csv", (data?.users ?? []).map((u) => ({
            Name: u.displayName, UPN: u.userPrincipalName, Type: u.userType,
            MFA: u.mfaEnabled, Licenses: u.assignedLicenses, Department: u.department ?? "",
            "Last Sign-In": u.lastSignIn ?? "Never", Enabled: u.accountEnabled,
          })))}
        contentClassName="px-4 pb-3"
      >
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  placeholder="Search users…"
                  value={allFilter}
                  onChange={(e) => setAllFilter(e.target.value)}
                  className="max-w-sm"
                />
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      {allTable.getHeaderGroups().map((hg) => (
                        <TableRow key={hg.id}>
                          {hg.headers.map((header) => (
                            <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none whitespace-nowrap h-8 py-1">
                              <div className="flex items-center gap-2">
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? null}
                              </div>
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {allTable.getRowModel().rows.length > 0 ? (
                        allTable.getRowModel().rows.map((row) => (
                          <TableRow key={row.id}>
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id} className="py-1.5">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={allColumns.length} className="h-16 text-center text-muted-foreground">
                            No results found.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Showing{" "}
                    {allTable.getState().pagination.pageIndex * allTable.getState().pagination.pageSize + (allTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)}{" "}
                    –{" "}
                    {Math.min(
                      (allTable.getState().pagination.pageIndex + 1) * allTable.getState().pagination.pageSize,
                      allTable.getFilteredRowModel().rows.length
                    )}{" "}
                    of {allTable.getFilteredRowModel().rows.length}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => allTable.previousPage()} disabled={!allTable.getCanPreviousPage()}>Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => allTable.nextPage()} disabled={!allTable.getCanNextPage()}>Next</Button>
                  </div>
                </div>
              </div>
            )}
      </CollapsibleSection>
      </div>
      </CollapsibleSection>

      {/* ── ADMINISTRATOR EXPOSURE ───────────────────────────────────────────── */}
      <CollapsibleSection title="Administrator Exposure" description="Overview of users with administrative rights over the tenant" storageKey="users-admin-exposure-section" defaultOpen={false} density="compact">
        <div className="space-y-3">

        {adminExposure?.permissionError && (
          <div className="rounded-md border border-amber-300/60 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-300">
            Administrator role data is partially unavailable due to Graph permission constraints (RoleManagement.Read.Directory).
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Permanent assignments (not using PIM)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard title="Users permanently assigned Global Admin (not using PIM)" value={adminExposure?.permanentGlobalAdminsCount} loading={adminExposureLoading} density="compact" />
            <KPICard title="Permanent Global Admins with productivity features enabled" value={adminExposure?.permanentGlobalAdminsWithProductivityCount} loading={adminExposureLoading} density="compact" />
            <KPICard title="Users permanently assigned admin roles (not using PIM)" value={adminExposure?.permanentAdminsCount} loading={adminExposureLoading} density="compact" />
            <KPICard title="Permanent admins with productivity features enabled" value={adminExposure?.permanentAdminsWithProductivityCount} loading={adminExposureLoading} density="compact" />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Eligible assignments (using PIM)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard title="Users eligible for Global Admin (using PIM)" value={adminExposure?.eligibleGlobalAdminsCount} loading={adminExposureLoading} density="compact" />
            <KPICard title="Eligible Global Admins with productivity features enabled" value={adminExposure?.eligibleGlobalAdminsWithProductivityCount} loading={adminExposureLoading} density="compact" />
            <KPICard title="Users eligible for admin roles (using PIM)" value={adminExposure?.eligibleAdminsCount} loading={adminExposureLoading} density="compact" />
            <KPICard title="Eligible admins with productivity features enabled" value={adminExposure?.eligibleAdminsWithProductivityCount} loading={adminExposureLoading} density="compact" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
            <KPICard
              title="Total eligible role assignments"
              value={adminExposure?.eligibleAssignmentCount}
              loading={adminExposureLoading}
              density="compact"
            />
            <KPICard
              title="Dormant PIM eligibilities (never activated)"
              value={adminExposure?.dormantEligibleCount}
              loading={adminExposureLoading}
              density="compact"
              valueColor={(adminExposure?.dormantEligibleCount ?? 0) > 0 ? "#d97706" : undefined}
            />
          </div>
        </div>

        <AdminExposureTableSection
          title="Users with permanently assigned Global Admin (not using PIM)"
          storageKey="users-admin-exposure-permanent-global"
          rows={adminExposure?.permanentGlobalAdmins ?? []}
          loading={adminExposureLoading}
        />
        <AdminExposureTableSection
          title="Users with permanently assigned Global Admin (not using PIM) with productivity features enabled"
          storageKey="users-admin-exposure-permanent-global-productivity"
          rows={adminExposure?.permanentGlobalAdminsWithProductivity ?? []}
          loading={adminExposureLoading}
        />
        <AdminExposureTableSection
          title="Users with permanently assigned admin roles (not using PIM)"
          storageKey="users-admin-exposure-permanent-admin"
          rows={adminExposure?.permanentAdmins ?? []}
          loading={adminExposureLoading}
        />
        <AdminExposureTableSection
          title="Users with permanently assigned admin roles (not using PIM) with productivity features enabled"
          storageKey="users-admin-exposure-permanent-admin-productivity"
          rows={adminExposure?.permanentAdminsWithProductivity ?? []}
          loading={adminExposureLoading}
        />
        <AdminExposureTableSection
          title="Users eligible for Global Admin (using PIM)"
          storageKey="users-admin-exposure-eligible-global"
          rows={adminExposure?.eligibleGlobalAdmins ?? []}
          loading={adminExposureLoading}
        />
        <AdminExposureTableSection
          title="Users eligible for Global Admin (using PIM) with productivity features enabled"
          storageKey="users-admin-exposure-eligible-global-productivity"
          rows={adminExposure?.eligibleGlobalAdminsWithProductivity ?? []}
          loading={adminExposureLoading}
        />
        <AdminExposureTableSection
          title="Users eligible for admin roles (using PIM)"
          storageKey="users-admin-exposure-eligible-admin"
          rows={adminExposure?.eligibleAdmins ?? []}
          loading={adminExposureLoading}
        />
        <AdminExposureTableSection
          title="Users eligible for admin roles (using PIM) with productivity features enabled"
          storageKey="users-admin-exposure-eligible-admin-productivity"
          rows={adminExposure?.eligibleAdminsWithProductivity ?? []}
          loading={adminExposureLoading}
        />
      </div>
      </CollapsibleSection>

      {/* ── ENTERPRISE APPLICATIONS ──────────────────────────────────────────── */}
      <CollapsibleSection title="Enterprise Applications" description="App registrations, credentials, and high-risk permissions" storageKey="users-enterprise-apps-section" defaultOpen={false} density="compact" className="shadow-none">
        <EnterpriseAppsSection />
      </CollapsibleSection>

      {/* ── SUMMARY CHECK LIST ───────────────────────────────────────────────── */}
      <CollapsibleSection title="Summary Check List" description="Entra ID security controls assessment" storageKey="users-checklist-section" defaultOpen={false} density="compact">
        <ChecklistTable sectionTitle="" groups={section1Groups} loading={loading} density="compact" />
      </CollapsibleSection>

    </div>
  );
}
