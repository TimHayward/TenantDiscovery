import React, { useState, useMemo } from "react";
import { useGetM365ServicePrincipals } from "@workspace/api-client-react";
import type { ServicePrincipalItem, SpConsentGrant } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel, flexRender,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import {
  Building2, ShieldAlert, CheckCircle2, XCircle, AlertCircle,
  ChevronDown, ChevronUp, Globe, Users, Clock, Shield, Layers,
  ExternalLink,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

// ── helpers ───────────────────────────────────────────────────────────────────

const HIGH_RISK_SCOPES = new Set([
  "Directory.ReadWrite.All", "Directory.Read.All",
  "User.ReadWrite.All", "User.ManageIdentities.All",
  "Group.ReadWrite.All", "Mail.ReadWrite", "Mail.ReadWrite.Shared",
  "MailboxSettings.ReadWrite", "Files.ReadWrite.All", "Calendars.ReadWrite",
  "RoleManagement.ReadWrite.Directory", "RoleManagement.Read.Directory",
  "Application.ReadWrite.All", "Application.ReadWrite.OwnedBy",
  "Policy.ReadWrite.All", "Policy.ReadWrite.ConditionalAccess",
  "PrivilegedAccess.ReadWrite.AzureAD", "PrivilegedAccess.Read.AzureAD",
  "Sites.FullControl.All", "Sites.Manage.All", "Sites.ReadWrite.All",
  "Exchange.ManageAsApp", "AuditLog.Read.All", "Organization.ReadWrite.All",
  "DeviceManagementConfiguration.ReadWrite.All",
]);

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function StatusDot({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
    : <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />;
}

// ── SP type badge ─────────────────────────────────────────────────────────────

function SpTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    Application:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    ManagedIdentity: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    Legacy:          "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    SocialIdp:       "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  };
  const cls = map[type] ?? "bg-muted text-muted-foreground";
  return <Badge className={`text-xs font-normal border-0 ${cls}`}>{type}</Badge>;
}

// ── detail panel ──────────────────────────────────────────────────────────────

function SpDetailPanel({ sp }: { sp: ServicePrincipalItem }) {
  const d = daysSince(sp.lastSignInDateTime);
  const stale = d !== null && d > 90;

  return (
    <div className="px-4 py-3 bg-muted/20 border-t space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: key details + risk summary */}
        <div className="space-y-4">

          {/* Basic info */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Details</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">App ID</dt>
              <dd className="font-mono">{sp.appId}</dd>
              <dt className="text-muted-foreground">Object ID</dt>
              <dd className="font-mono">{sp.id}</dd>
              <dt className="text-muted-foreground">Publisher</dt>
              <dd>{sp.publisherName || "—"}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd><SpTypeBadge type={sp.servicePrincipalType} /></dd>
              <dt className="text-muted-foreground">Account</dt>
              <dd className="flex items-center gap-1">
                <StatusDot ok={sp.accountEnabled} />
                {sp.accountEnabled ? "Enabled" : "Disabled"}
              </dd>
              {sp.homepage && (
                <>
                  <dt className="text-muted-foreground">Homepage</dt>
                  <dd className="flex items-center gap-1 truncate">
                    <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <a href={sp.homepage} target="_blank" rel="noopener noreferrer"
                       className="text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[220px]">
                      {sp.homepage}
                    </a>
                    <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Last Sign-in</dt>
              <dd className={stale ? "text-yellow-600 dark:text-yellow-400 font-medium" : ""}>
                {sp.lastSignInDateTime
                  ? `${formatDate(sp.lastSignInDateTime)} (${d}d ago)`
                  : "Never / unknown"}
                {stale && " ⚠ >90 days"}
              </dd>
              <dt className="text-muted-foreground">Assigned Users</dt>
              <dd>{sp.assignedUserCount > 0 ? `${sp.assignedUserCount} user(s)` : "None"}</dd>
              <dt className="text-muted-foreground">Assigned Groups</dt>
              <dd>{sp.assignedGroupCount > 0 ? `${sp.assignedGroupCount} group(s)` : "None"}</dd>
            </dl>
          </div>

          {/* Risk factors */}
          {sp.riskFactors.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Risk Factors</p>
              <div className="space-y-1">
                {sp.riskFactors.map((f, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {sp.tags.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1">
                {sp.tags.map((t) => (
                  <code key={t} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{t}</code>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: consent grants */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Consent Grants ({sp.consentGrants.length})
          </p>
          {sp.consentGrants.length === 0 ? (
            <p className="text-xs text-muted-foreground">No delegated consent grants found</p>
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {sp.consentGrants.map((grant: SpConsentGrant, i: number) => (
                <div key={i} className={`border rounded p-2 space-y-1.5 ${grant.isHighRisk ? "border-red-200 bg-red-50/30 dark:border-red-800 dark:bg-red-950/10" : "border-border bg-background"}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={`text-[10px] font-normal border-0 px-1.5 py-0 h-4 ${
                      grant.consentType === "AllPrincipals"
                        ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                    }`}>
                      {grant.consentType === "AllPrincipals" ? "Tenant-wide" : "User-specific"}
                    </Badge>
                    <span className="text-xs font-medium">{grant.resourceName}</span>
                    {grant.isHighRisk && (
                      <Badge className="text-[10px] font-normal border-0 px-1.5 py-0 h-4 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        High Risk
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 pl-1">
                    {grant.scopes.map((s: string) => (
                      <code key={s} className={`text-[10px] px-1.5 py-0.5 rounded ${
                        HIGH_RISK_SCOPES.has(s)
                          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {s}
                      </code>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── main tab component ────────────────────────────────────────────────────────

type ViewFilter = "all" | "thirdParty" | "microsoft" | "managedIdentity";
type RiskFilter = "all" | "high" | "medium" | "low";

export function ServicePrincipalsTab() {
  const { data, isLoading, isFetching } = useGetM365ServicePrincipals();
  const loading = isLoading || isFetching;

  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting]           = useState<SortingState>([{ id: "riskScore", desc: true }]);
  const [viewFilter, setViewFilter]     = useState<ViewFilter>("thirdParty");
  const [riskFilter, setRiskFilter]     = useState<RiskFilter>("all");

  const C = { green: "#009118", red: "#A60808", yellow: "#eab308", blue: "#0079F2" };

  // ── filtered dataset ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = data?.servicePrincipals ?? [];
    if (viewFilter === "thirdParty")     list = list.filter((sp) => !sp.isFirstParty && sp.servicePrincipalType === "Application");
    if (viewFilter === "microsoft")      list = list.filter((sp) => sp.isFirstParty);
    if (viewFilter === "managedIdentity") list = list.filter((sp) => sp.servicePrincipalType === "ManagedIdentity");
    if (riskFilter !== "all")            list = list.filter((sp) => sp.riskLevel === riskFilter);
    return list;
  }, [data, viewFilter, riskFilter]);

  // ── column definitions ──────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<ServicePrincipalItem>[]>(() => [
    {
      accessorKey: "displayName",
      header: "Application",
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-sm leading-tight">{row.original.displayName}</p>
          {row.original.publisherName && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{row.original.publisherName}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "servicePrincipalType",
      header: "Type",
      cell: ({ row }) => (
        <div className="space-y-1">
          <SpTypeBadge type={row.original.servicePrincipalType} />
          {row.original.isFirstParty && (
            <Badge className="text-[10px] font-normal border-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 block w-fit">
              Microsoft
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "accountEnabled",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 text-xs">
          <StatusDot ok={row.original.accountEnabled} />
          {row.original.accountEnabled ? "Enabled" : "Disabled"}
        </div>
      ),
    },
    {
      accessorKey: "consentGrants",
      header: "Consent Grants",
      cell: ({ row }) => {
        const grants = row.original.consentGrants;
        const adminConsented = row.original.isAdminConsented;
        if (grants.length === 0) return <span className="text-xs text-muted-foreground">None</span>;
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs">{grants.length} grant{grants.length !== 1 ? "s" : ""}</span>
              {row.original.hasHighRiskGrants && (
                <Badge className="text-[10px] font-normal border-0 px-1.5 py-0 h-4 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                  High Risk
                </Badge>
              )}
            </div>
            {adminConsented && (
              <Badge className="text-[10px] font-normal border-0 px-1.5 py-0 h-4 bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                Tenant-wide
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "assignedUserCount",
      header: "Assigned",
      cell: ({ row }) => {
        const users  = row.original.assignedUserCount;
        const groups = row.original.assignedGroupCount;
        if (users === 0 && groups === 0) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="text-xs space-y-0.5">
            {users  > 0 && <div className="flex items-center gap-1"><Users className="w-3 h-3 text-muted-foreground" />{users} user{users !== 1 ? "s" : ""}</div>}
            {groups > 0 && <div className="flex items-center gap-1"><Layers className="w-3 h-3 text-muted-foreground" />{groups} group{groups !== 1 ? "s" : ""}</div>}
          </div>
        );
      },
    },
    {
      accessorKey: "lastSignInDateTime",
      header: "Last Sign-in",
      cell: ({ row }) => {
        const d = daysSince(row.original.lastSignInDateTime);
        const stale = d !== null && d > 90;
        if (!row.original.lastSignInDateTime) return <span className="text-xs text-muted-foreground">Unknown</span>;
        return (
          <div>
            <p className={`text-xs ${stale ? "text-yellow-600 dark:text-yellow-400 font-medium" : ""}`}>
              {formatDate(row.original.lastSignInDateTime)}
            </p>
            <p className="text-[10px] text-muted-foreground">{d}d ago{stale ? " ⚠" : ""}</p>
          </div>
        );
      },
    },
    {
      accessorKey: "riskScore",
      header: "Risk",
      cell: ({ row }) => {
        const level = row.original.riskLevel as "high" | "medium" | "low";
        const map: Record<"high" | "medium" | "low", string> = {
          high:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
          medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
          low:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
        };
        return (
          <div>
            <Badge className={`text-xs font-normal border-0 capitalize ${map[level]}`}>{level}</Badge>
            {row.original.riskScore > 0 && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{row.original.riskScore} factor{row.original.riskScore !== 1 ? "s" : ""}</p>
            )}
          </div>
        );
      },
    },
    {
      id: "expand",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <Button
          variant="ghost" size="sm" className="h-7 w-7 p-0"
          onClick={(e) => {
            e.stopPropagation();
            setExpandedId(expandedId === row.original.id ? null : row.original.id);
          }}
        >
          {expandedId === row.original.id
            ? <ChevronUp className="w-4 h-4" />
            : <ChevronDown className="w-4 h-4" />}
        </Button>
      ),
    },
  ], [expandedId]);

  // ── table ───────────────────────────────────────────────────────────────────
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });

  // ── derived counts for view filter pills ────────────────────────────────────
  const counts = useMemo(() => {
    const sps = data?.servicePrincipals ?? [];
    return {
      thirdParty:     sps.filter((sp) => !sp.isFirstParty && sp.servicePrincipalType === "Application").length,
      microsoft:      sps.filter((sp) => sp.isFirstParty).length,
      managedIdentity: sps.filter((sp) => sp.servicePrincipalType === "ManagedIdentity").length,
    };
  }, [data]);

  const riskCounts = useMemo(() => {
    const sps = data?.servicePrincipals ?? [];
    return {
      high:   sps.filter((sp) => sp.riskLevel === "high").length,
      medium: sps.filter((sp) => sp.riskLevel === "medium").length,
      low:    sps.filter((sp) => sp.riskLevel === "low").length,
    };
  }, [data]);

  // ── permission error ────────────────────────────────────────────────────────
  if (!loading && data?.permissionError) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-500" />
          <h2 className="text-base font-semibold">Service Principals (Enterprise Apps)</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border rounded-lg">
          <ShieldAlert className="w-10 h-10 text-muted-foreground" />
          <div>
            <p className="font-medium">Additional permissions required</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              Grant{" "}
              <code className="bg-muted px-1 rounded text-xs">Application.Read.All</code>{" "}
              and optionally{" "}
              <code className="bg-muted px-1 rounded text-xs">AuditLog.Read.All</code>{" "}
              (for sign-in activity) to your Azure app registration.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <h2 className="text-base font-semibold">Service Principals (Enterprise Apps)</h2>
        {!loading && (
          <Badge variant="outline" className="font-normal text-xs">{data?.total ?? 0} total</Badge>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard title="Total SPs"          value={data?.total}               loading={loading} />
        <KPICard title="Third-party Apps"   value={data?.thirdPartyCount}     loading={loading} valueColor={C.blue} />
        <KPICard title="Managed Identities" value={data?.managedIdentityCount} loading={loading} valueColor={C.blue} />
        <KPICard title="Microsoft-owned"    value={data?.microsoftOwnedCount} loading={loading} />
        <KPICard title="Disabled"           value={data?.disabledCount}       loading={loading} valueColor={(data?.disabledCount ?? 0) > 0 ? C.yellow : C.green} />
        <KPICard title="High-risk Grants"   value={data?.withHighRiskGrants}  loading={loading} valueColor={(data?.withHighRiskGrants ?? 0) > 0 ? C.red : C.green} />
      </div>

      {/* Main table card */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-start justify-between space-y-0 flex-wrap gap-3">
          <div>
            <CardTitle className="text-base">Enterprise Apps & Service Principals</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Consent grants, assigned users, and sign-in activity for all service principals.
              Click expand for details.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {/* View filter pills */}
            <div className="flex gap-1.5 flex-wrap">
              {(
                [
                  { key: "thirdParty",      label: `Third-party (${counts.thirdParty})` },
                  { key: "microsoft",       label: `Microsoft (${counts.microsoft})` },
                  { key: "managedIdentity", label: `Managed Identities (${counts.managedIdentity})` },
                  { key: "all",             label: `All (${data?.total ?? 0})` },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setViewFilter(key)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    viewFilter === key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted border-border text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Risk filter pills */}
            <div className="flex gap-1 flex-wrap">
              {(["all", "high", "medium", "low"] as const).map((r) => {
                const rLabel = { all: "All Risk", high: `High (${riskCounts.high})`, medium: `Med (${riskCounts.medium})`, low: `Low (${riskCounts.low})` };
                return (
                  <button
                    key={r}
                    onClick={() => setRiskFilter(r)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      riskFilter === r
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted border-border text-muted-foreground"
                    }`}
                  >
                    {rLabel[r]}
                  </button>
                );
              })}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-64" />
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                placeholder="Search by name, publisher, app ID…"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="max-w-sm"
              />

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((h) => (
                          <TableHead
                            key={h.id}
                            onClick={h.column.getToggleSortingHandler()}
                            className={`whitespace-nowrap ${h.column.getCanSort() ? "cursor-pointer select-none" : ""}`}
                          >
                            <div className="flex items-center gap-1">
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ?? null}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.length > 0 ? (
                      table.getRowModel().rows.map((row) => (
                        <React.Fragment key={row.id}>
                          <TableRow
                            className={
                              row.original.riskLevel === "high" && !row.original.isFirstParty
                                ? "bg-red-50/40 dark:bg-red-950/10"
                                : ""
                            }
                          >
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id} className="py-2 align-top">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </TableCell>
                            ))}
                          </TableRow>
                          {expandedId === row.original.id && (
                            <TableRow key={`${row.id}-detail`} className="hover:bg-transparent">
                              <TableCell colSpan={columns.length} className="p-0">
                                <SpDetailPanel sp={row.original} />
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                          No service principals match the current filter.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {table.getFilteredRowModel().rows.length} of {filtered.length} service principal{filtered.length !== 1 ? "s" : ""}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Consent & security summary cards */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-red-500" />
                High-risk Third-party Apps
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {(data?.servicePrincipals ?? [])
                .filter((sp) => sp.hasHighRiskGrants && !sp.isFirstParty)
                .slice(0, 6)
                .map((sp) => (
                  <div key={sp.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-xs">
                    <span className="font-medium truncate max-w-[160px]">{sp.displayName}</span>
                    <Badge className="text-[10px] font-normal border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 ml-2 flex-shrink-0">
                      {sp.consentGrants.filter((g: SpConsentGrant) => g.isHighRisk).length} high-risk
                    </Badge>
                  </div>
                ))}
              {(data?.servicePrincipals ?? []).filter((sp) => sp.hasHighRiskGrants && !sp.isFirstParty).length === 0 && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  No high-risk grants found
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-yellow-500" />
                {"Stale Apps (No sign-in >90 days)"}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {(data?.servicePrincipals ?? [])
                .filter((sp) => !sp.isFirstParty && sp.servicePrincipalType === "Application" && sp.lastSignInDateTime && daysSince(sp.lastSignInDateTime)! > 90)
                .slice(0, 6)
                .map((sp) => (
                  <div key={sp.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-xs">
                    <span className="font-medium truncate max-w-[160px]">{sp.displayName}</span>
                    <span className="text-muted-foreground ml-2 flex-shrink-0">{daysSince(sp.lastSignInDateTime)}d</span>
                  </div>
                ))}
              {(data?.servicePrincipals ?? []).filter((sp) => !sp.isFirstParty && sp.servicePrincipalType === "Application" && sp.lastSignInDateTime && daysSince(sp.lastSignInDateTime)! > 90).length === 0 && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  No stale apps detected
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-500" />
                Most Widely Used Apps
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {(data?.servicePrincipals ?? [])
                .filter((sp) => !sp.isFirstParty && sp.servicePrincipalType === "Application" && sp.assignedUserCount > 0)
                .sort((a, b) => b.assignedUserCount - a.assignedUserCount)
                .slice(0, 6)
                .map((sp) => (
                  <div key={sp.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-xs">
                    <span className="font-medium truncate max-w-[160px]">{sp.displayName}</span>
                    <span className="text-muted-foreground ml-2 flex-shrink-0">{sp.assignedUserCount} user{sp.assignedUserCount !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              {(data?.servicePrincipals ?? []).filter((sp) => !sp.isFirstParty && sp.assignedUserCount > 0).length === 0 && (
                <p className="text-xs text-muted-foreground">No user assignments tracked yet</p>
              )}
            </CardContent>
          </Card>

        </div>
      )}

    </div>
  );
}
