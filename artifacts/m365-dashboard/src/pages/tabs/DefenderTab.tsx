import React, { useState, useMemo } from "react";
import { useGetM365SecurityEstate } from "@workspace/api-client-react";
import type {
  DeviceEstateItem,
  SaasAppItem,
  OAuthAppItem,
} from "@workspace/api-client-react/src/generated/api.schemas";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CSVLink } from "react-csv";
import {
  Download, Monitor, ShieldCheck, ShieldAlert, Globe, Lock, AlertTriangle, Building2,
} from "lucide-react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel, flexRender,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from "recharts";
import { useTheme } from "next-themes";
import { formatDate } from "@/lib/utils";

// ── constants ─────────────────────────────────────────────────────────────────

const C = {
  blue:   "#0079F2",
  green:  "#009118",
  red:    "#A60808",
  yellow: "#eab308",
  orange: "#f97316",
  gray:   "#9ca3af",
  purple: "#795EFF",
};

const TRUST_LABELS: Record<string, string> = {
  AzureAd:  "Azure AD Joined",
  ServerAd: "Hybrid Azure AD Joined",
  Workplace: "Azure AD Registered (BYOD)",
};

const MGMT_LABELS: Record<string, string> = {
  MDM:            "MDM / Intune",
  MicrosoftSense: "Defender for Endpoint",
  EAS:            "Exchange ActiveSync",
  ConfigurationManagerClient: "Configuration Manager",
  ConfigurationManagerClientMdm: "ConfigMgr + MDM",
};

function trustLabel(t: string | null): string {
  return t ? (TRUST_LABELS[t] ?? t) : "Unknown";
}

function mgmtLabel(t: string | null, isManaged: boolean): string {
  if (t) return MGMT_LABELS[t] ?? t;
  return isManaged ? "Managed" : "Unmanaged";
}

// ── small helpers ─────────────────────────────────────────────────────────────

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

function MgmtBadge({ managementType, isManaged }: { managementType: string | null; isManaged: boolean }) {
  if (!isManaged && !managementType) {
    return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 font-normal text-xs border-0">Unmanaged</Badge>;
  }
  if (managementType === "MicrosoftSense") {
    return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 font-normal text-xs border-0">Defender (MDE)</Badge>;
  }
  if (managementType === "MDM") {
    return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-normal text-xs border-0">MDM / Intune</Badge>;
  }
  const label = managementType ? (MGMT_LABELS[managementType] ?? managementType) : "Managed";
  return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal text-xs border-0">{label}</Badge>;
}

function TrustBadge({ trustType }: { trustType: string | null }) {
  const cls: Record<string, string> = {
    AzureAd:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    ServerAd: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
    Workplace: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  };
  return (
    <Badge className={`${cls[trustType ?? ""] ?? "bg-muted text-muted-foreground"} font-normal text-xs border-0`}>
      {trustLabel(trustType)}
    </Badge>
  );
}

function OsBadge({ os }: { os: string }) {
  const icons: Record<string, string> = { Windows: "🪟", MacMDM: "🍎", IPhone: "📱", IPad: "📱", Android: "🤖", AndroidForWork: "🤖" };
  const icon = icons[os] ?? "💻";
  return <span className="text-sm text-muted-foreground">{icon} {os}</span>;
}

function ConsentBadge({ consentType }: { consentType: string }) {
  if (consentType === "AllPrincipals") {
    return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 font-normal text-xs border-0">Org-wide</Badge>;
  }
  return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-normal text-xs border-0">User-specific</Badge>;
}

// ── column definitions ────────────────────────────────────────────────────────

const deviceColumns: ColumnDef<DeviceEstateItem>[] = [
  {
    accessorKey: "displayName",
    header: "Device Name",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <Monitor className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="font-medium text-sm">{row.original.displayName}</span>
      </div>
    ),
  },
  {
    accessorKey: "operatingSystem",
    header: "OS",
    cell: ({ row }) => <OsBadge os={row.original.operatingSystem} />,
  },
  {
    accessorKey: "trustType",
    header: "Join Type",
    cell: ({ row }) => <TrustBadge trustType={row.original.trustType} />,
  },
  {
    accessorKey: "managementType",
    header: "Management",
    cell: ({ row }) => (
      <MgmtBadge
        managementType={row.original.managementType}
        isManaged={row.original.isManaged}
      />
    ),
  },
  {
    accessorKey: "isCompliant",
    header: "Compliance",
    cell: ({ row }) => {
      const v = row.original.isCompliant;
      if (v === null || v === undefined) return <span className="text-muted-foreground text-sm">—</span>;
      return v
        ? <div className="flex items-center gap-1 text-green-600 dark:text-green-400"><ShieldCheck className="w-3.5 h-3.5" /><span className="text-xs">Compliant</span></div>
        : <div className="flex items-center gap-1 text-red-600 dark:text-red-400"><ShieldAlert className="w-3.5 h-3.5" /><span className="text-xs">Non-compliant</span></div>;
    },
  },
  {
    accessorKey: "approximateLastSignInDateTime",
    header: "Last Sign-in",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.approximateLastSignInDateTime ? formatDate(row.original.approximateLastSignInDateTime) : "—"}
      </span>
    ),
  },
];

const saasColumns: ColumnDef<SaasAppItem>[] = [
  {
    accessorKey: "displayName",
    header: "Application",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <Globe className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="font-medium text-sm">{row.original.displayName}</span>
      </div>
    ),
  },
  {
    accessorKey: "publisherName",
    header: "Publisher",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.publisherName ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "isFirstParty",
    header: "Type",
    cell: ({ row }) =>
      row.original.isFirstParty ? (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-normal text-xs border-0">
          Microsoft
        </Badge>
      ) : (
        <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 font-normal text-xs border-0">
          Third-party
        </Badge>
      ),
  },
  {
    accessorKey: "createdDateTime",
    header: "Added",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.createdDateTime ? formatDate(row.original.createdDateTime) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "tags",
    header: "Tags",
    cell: ({ row }) => {
      const HIDE_TAGS = new Set([
        "WindowsAzureActiveDirectoryIntegratedApp",
        "WindowsAzureActiveDirectoryGalleryApp",
        "disableRequestingTenantedPassthroughTokens",
        "disableAcceptingTenantedPassthroughTokens",
        "HideApp",
      ]);
      const tags = (row.original.tags ?? []).filter((t: string) => !HIDE_TAGS.has(t));
      if (!tags.length) return <span className="text-muted-foreground text-sm">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map((t: string) => (
            <Badge key={t} variant="outline" className="text-xs font-normal">{t}</Badge>
          ))}
        </div>
      );
    },
  },
];

const oauthColumns: ColumnDef<OAuthAppItem>[] = [
  {
    accessorKey: "displayName",
    header: "Application",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        {row.original.isOrgWide
          ? <Globe className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
          : <Lock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        }
        <span className="font-medium text-sm">{row.original.displayName}</span>
      </div>
    ),
  },
  {
    accessorKey: "consentType",
    header: "Consent",
    cell: ({ row }) => <ConsentBadge consentType={row.original.consentType} />,
  },
  {
    accessorKey: "scopes",
    header: "Delegated Permissions",
    cell: ({ row }) => {
      const scopes = row.original.scopes ?? [];
      const HIGH_RISK = ["Mail.ReadWrite", "Mail.Send", "Files.ReadWrite.All", "Contacts.ReadWrite", "Directory.ReadWrite.All", "User.ReadWrite.All"];
      return (
        <div className="flex flex-wrap gap-1">
          {scopes.filter((s: string) => !["openid", "offline_access", "profile"].includes(s)).map((s: string) => (
            <Badge
              key={s}
              variant="outline"
              className={`text-xs font-normal ${HIGH_RISK.includes(s) ? "border-red-300 text-red-700 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20" : ""}`}
            >
              {s}
            </Badge>
          ))}
        </div>
      );
    },
  },
];

// ── main component ────────────────────────────────────────────────────────────

export function DefenderTab() {
  const { data, isLoading, isFetching } = useGetM365SecurityEstate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const loading = isLoading || isFetching;
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  // ── device table state ──
  const [deviceFilter, setDeviceFilter] = useState("");
  const [deviceSorting, setDeviceSorting] = useState<SortingState>([]);
  const [showUnmanagedOnly, setShowUnmanagedOnly] = useState(false);

  const filteredDevices = useMemo(() => {
    let devs = data?.deviceList ?? [];
    if (showUnmanagedOnly) devs = devs.filter((d) => !d.isManaged && !d.managementType);
    return devs;
  }, [data?.deviceList, showUnmanagedOnly]);

  const deviceTable = useReactTable({
    data: filteredDevices,
    columns: deviceColumns,
    state: { sorting: deviceSorting, globalFilter: deviceFilter },
    onSortingChange: setDeviceSorting,
    onGlobalFilterChange: setDeviceFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });

  // ── SaaS app table state ──
  const [saasFilter, setSaasFilter] = useState("");
  const [saasShowThirdParty, setSaasShowThirdParty] = useState(false);
  const [saasSorting, setSaasSorting] = useState<SortingState>([{ id: "isFirstParty", desc: false }]);

  const filteredSaas = useMemo(() => {
    let apps = data?.saasApps ?? [];
    if (saasShowThirdParty) apps = apps.filter((a) => !a.isFirstParty);
    return apps;
  }, [data?.saasApps, saasShowThirdParty]);

  const saasTable = useReactTable({
    data: filteredSaas,
    columns: saasColumns,
    state: { sorting: saasSorting, globalFilter: saasFilter },
    onSortingChange: setSaasSorting,
    onGlobalFilterChange: setSaasFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });

  // ── OAuth table state ──
  const [oauthFilter, setOauthFilter] = useState("");
  const [oauthSorting, setOauthSorting] = useState<SortingState>([{ id: "consentType", desc: false }]);

  const oauthTable = useReactTable({
    data: data?.oauthApps ?? [],
    columns: oauthColumns,
    state: { sorting: oauthSorting, globalFilter: oauthFilter },
    onSortingChange: setOauthSorting,
    onGlobalFilterChange: setOauthFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });

  // ── derived chart data ──
  const trustChartData = useMemo(() => {
    const s = data?.deviceSummary;
    if (!s) return [];
    return [
      { name: "Azure AD Joined", value: s.azureAdJoined, color: C.blue },
      { name: "Hybrid Joined", value: s.hybridJoined, color: C.purple },
      { name: "BYOD/Registered", value: s.registered, color: C.orange },
      { name: "Unknown", value: s.unknown, color: C.gray },
    ].filter((d) => d.value > 0);
  }, [data]);

  const osChartData = useMemo(() => {
    const byOs = data?.deviceSummary.byOs ?? {};
    return Object.entries(byOs).map(([os, count]) => ({ name: os, value: count }))
      .sort((a, b) => b.value - a.value);
  }, [data]);

  const thirdPartyApps = (data?.saasApps ?? []).filter((a) => !a.isFirstParty).length;
  const orgWideOauth   = (data?.oauthApps ?? []).filter((a) => a.isOrgWide).length;

  return (
    <div className="space-y-4">

      {/* ── Device Estate KPIs ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Total Devices" value={data?.deviceSummary.total} loading={loading} />
        <KPICard title="Managed" value={data?.deviceSummary.managed} loading={loading} valueColor={C.green} />
        <KPICard
          title="Unmanaged / Unknown"
          value={data?.deviceSummary.unmanaged}
          loading={loading}
          valueColor={(data?.deviceSummary.unmanaged ?? 0) > 0 ? C.red : C.green}
        />
        <KPICard title="Defender for Endpoint" value={data?.deviceSummary.mde} loading={loading} valueColor={C.purple} />
      </div>

      {/* ── Device Breakdown Charts ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* By Join Type */}
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Device Join Type</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Azure AD registration method</p>
            </div>
            <ExportBtn filename="device-join-types.csv" csvData={trustChartData} />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[220px]" /> : (
              <div className="space-y-3">
                <ResponsiveContainer width="100%" height={160} debounce={0}>
                  <BarChart data={trustChartData} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: tickColor }} stroke="none" width={140} />
                    <Tooltip isAnimationActive={false} />
                    <Bar dataKey="value" name="Devices" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                      {trustChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                {/* Summary grid */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Azure AD Joined", count: data?.deviceSummary.azureAdJoined ?? 0, note: "Cloud-only, fully managed", color: C.blue },
                    { label: "Hybrid Joined", count: data?.deviceSummary.hybridJoined ?? 0, note: "On-prem + cloud", color: C.purple },
                    { label: "BYOD / Registered", count: data?.deviceSummary.registered ?? 0, note: "Personal devices", color: C.orange },
                    { label: "Unknown", count: data?.deviceSummary.unknown ?? 0, note: "No join record", color: C.gray },
                  ].map((item) => (
                    <div key={item.label} className="flex items-start gap-2 p-2 rounded border bg-muted/20">
                      <span className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <div>
                        <p className="text-sm font-semibold">{item.count}</p>
                        <p className="text-xs font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.note}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* By OS */}
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Devices by OS Platform</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Operating system distribution across the estate</p>
            </div>
            <ExportBtn filename="devices-by-os.csv" csvData={osChartData} />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[220px]" /> : (
              <div className="space-y-3">
                <ResponsiveContainer width="100%" height={160} debounce={0}>
                  <BarChart data={osChartData} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} stroke={tickColor} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: tickColor }} stroke="none" width={120} />
                    <Tooltip isAnimationActive={false} />
                    <Bar dataKey="value" name="Devices" fill={C.blue} fillOpacity={0.85} radius={[0, 3, 3, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                {/* Unmanaged alert */}
                {(data?.deviceSummary.unmanaged ?? 0) > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-sm">
                    <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-red-700 dark:text-red-400">
                        {data!.deviceSummary.unmanaged} unmanaged {data!.deviceSummary.unmanaged === 1 ? "device" : "devices"} detected
                      </p>
                      <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-0.5">
                        These devices are registered in Azure AD but have no MDM or Defender enrollment.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Device List Table ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Device Inventory</CardTitle>
            {!loading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data?.deviceSummary.total ?? 0} devices registered in Azure AD
              </p>
            )}
          </div>
          <ExportBtn
            filename="device-inventory.csv"
            csvData={(data?.deviceList ?? []).map((d) => ({
              Name: d.displayName, OS: d.operatingSystem, "Join Type": trustLabel(d.trustType),
              Management: mgmtLabel(d.managementType, d.isManaged),
              Compliant: d.isCompliant === null ? "N/A" : d.isCompliant ? "Yes" : "No",
              "Last Sign-in": d.approximateLastSignInDateTime ?? "",
            }))}
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-64" />
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Input
                  placeholder="Filter devices…"
                  value={deviceFilter}
                  onChange={(e) => setDeviceFilter(e.target.value)}
                  className="max-w-xs"
                />
                <div className="flex gap-2 text-sm">
                  <button
                    onClick={() => setShowUnmanagedOnly(false)}
                    className={`px-2 py-1 rounded text-xs ${!showUnmanagedOnly ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    All devices
                  </button>
                  <button
                    onClick={() => setShowUnmanagedOnly(true)}
                    className={`px-2 py-1 rounded text-xs ${showUnmanagedOnly ? "bg-red-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Unmanaged only ({(data?.deviceList ?? []).filter(d => !d.isManaged && !d.managementType).length})
                  </button>
                </div>
              </div>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {deviceTable.getHeaderGroups().map((hg) => (
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
                    {deviceTable.getRowModel().rows.length > 0 ? (
                      deviceTable.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className={!row.original.isManaged && !row.original.managementType ? "bg-red-50/40 dark:bg-red-950/10" : ""}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id} className="py-2">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={deviceColumns.length} className="h-16 text-center text-muted-foreground">
                          No devices match the filter.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {deviceTable.getFilteredRowModel().rows.length} device{deviceTable.getFilteredRowModel().rows.length !== 1 ? "s" : ""}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => deviceTable.previousPage()} disabled={!deviceTable.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => deviceTable.nextPage()} disabled={!deviceTable.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── SaaS Apps ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Enterprise Applications (SaaS)</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Service principals registered in the tenant — {thirdPartyApps} third-party, {(data?.saasApps.length ?? 0) - thirdPartyApps} Microsoft
            </p>
          </div>
          <ExportBtn
            filename="saas-apps.csv"
            csvData={(data?.saasApps ?? []).map((a) => ({
              Name: a.displayName,
              Publisher: a.publisherName ?? "",
              Type: a.isFirstParty ? "Microsoft" : "Third-party",
              Created: a.createdDateTime ?? "",
            }))}
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-64" />
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Summary tiles */}
              <div className="grid grid-cols-3 gap-3 mb-2">
                {[
                  { label: "Total Applications", count: data?.saasApps.length ?? 0, icon: Building2, color: "text-foreground" },
                  { label: "Third-party / SaaS", count: thirdPartyApps, icon: Globe, color: "text-orange-600 dark:text-orange-400" },
                  { label: "Microsoft First-party", count: (data?.saasApps.length ?? 0) - thirdPartyApps, icon: ShieldCheck, color: "text-blue-600 dark:text-blue-400" },
                ].map((item) => (
                  <div key={item.label} className="p-3 rounded-md border bg-muted/20 flex items-center gap-3">
                    <item.icon className={`w-5 h-5 flex-shrink-0 ${item.color}`} />
                    <div>
                      <p className="text-lg font-bold">{item.count}</p>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <Input
                  placeholder="Search applications…"
                  value={saasFilter}
                  onChange={(e) => setSaasFilter(e.target.value)}
                  className="max-w-xs"
                />
                <div className="flex gap-2 text-sm">
                  <button
                    onClick={() => setSaasShowThirdParty(false)}
                    className={`px-2 py-1 rounded text-xs ${!saasShowThirdParty ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setSaasShowThirdParty(true)}
                    className={`px-2 py-1 rounded text-xs ${saasShowThirdParty ? "bg-orange-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Third-party only ({thirdPartyApps})
                  </button>
                </div>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {saasTable.getHeaderGroups().map((hg) => (
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
                    {saasTable.getRowModel().rows.length > 0 ? (
                      saasTable.getRowModel().rows.map((row) => (
                        <TableRow key={row.id} className={!row.original.isFirstParty ? "bg-orange-50/20 dark:bg-orange-950/10" : ""}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id} className="py-2 align-top">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={saasColumns.length} className="h-16 text-center text-muted-foreground">
                          No applications match the filter.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{saasTable.getFilteredRowModel().rows.length} applications</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => saasTable.previousPage()} disabled={!saasTable.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => saasTable.nextPage()} disabled={!saasTable.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── OAuth Apps ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">OAuth Applications</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Apps with delegated permissions granted by users or admins
            </p>
          </div>
          <ExportBtn
            filename="oauth-apps.csv"
            csvData={(data?.oauthApps ?? []).map((a) => ({
              App: a.displayName,
              "Consent Type": a.consentType,
              "Org-wide": a.isOrgWide ? "Yes" : "No",
              Scopes: a.scopes.join(" "),
            }))}
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-64" />
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Summary + risk notice */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-md border bg-muted/20 flex items-center gap-3">
                  <Lock className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-lg font-bold">{data?.oauthApps.length ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Apps with OAuth grants</p>
                  </div>
                </div>
                <div className={`p-3 rounded-md border flex items-center gap-3 ${orgWideOauth > 0 ? "bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40" : "bg-muted/20"}`}>
                  <Globe className={`w-5 h-5 ${orgWideOauth > 0 ? "text-red-500" : "text-muted-foreground"}`} />
                  <div>
                    <p className={`text-lg font-bold ${orgWideOauth > 0 ? "text-red-700 dark:text-red-400" : ""}`}>{orgWideOauth}</p>
                    <p className="text-xs text-muted-foreground">Org-wide consented (admin consent)</p>
                  </div>
                </div>
              </div>

              {orgWideOauth > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    <span className="font-medium">{orgWideOauth} app{orgWideOauth !== 1 ? "s have" : " has"} org-wide admin consent.</span>{" "}
                    Review these carefully — org-wide grants apply to every user in the tenant. High-risk scopes (Mail, Files, Directory write) are highlighted in red.
                  </p>
                </div>
              )}

              <Input
                placeholder="Search OAuth apps…"
                value={oauthFilter}
                onChange={(e) => setOauthFilter(e.target.value)}
                className="max-w-xs"
              />

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {oauthTable.getHeaderGroups().map((hg) => (
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
                    {oauthTable.getRowModel().rows.length > 0 ? (
                      oauthTable.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className={row.original.isOrgWide ? "bg-red-50/30 dark:bg-red-950/10" : ""}
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
                        <TableCell colSpan={oauthColumns.length} className="h-16 text-center text-muted-foreground">
                          No OAuth grants found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{oauthTable.getFilteredRowModel().rows.length} applications</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => oauthTable.previousPage()} disabled={!oauthTable.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => oauthTable.nextPage()} disabled={!oauthTable.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
