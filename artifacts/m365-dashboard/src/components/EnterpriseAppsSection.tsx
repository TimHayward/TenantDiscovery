import { useState, useMemo } from "react";
import { useGetM365Apps } from "@workspace/api-client-react";
import type { AppRegistration, AppCredential, AppPermission } from "@workspace/api-client-react";
import { ChecklistTable, type ChecklistGroup } from "@/components/ChecklistTable";
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
  Building2, Key, Lock, Globe, CheckCircle2, XCircle, AlertCircle,
  ChevronDown, ChevronUp, ShieldAlert, Info, AlertTriangle,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

// ── high-risk scopes (mirrored from backend for inline highlighting) ──────────

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

// ── status icon ───────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === "pass")    return <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />;
  if (status === "fail")    return <XCircle      className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />;
  if (status === "warning") return <AlertCircle  className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />;
  return <span className="w-3.5 h-3.5 flex-shrink-0 inline-flex items-center justify-center text-[10px] text-muted-foreground font-bold border rounded">M</span>;
}

// ── per-app expandable detail panel ──────────────────────────────────────────

function AppDetailPanel({ app, usersCanRegisterApps }: { app: AppRegistration; usersCanRegisterApps?: boolean }) {
  const dims: Array<{ id: number; title: string; status: string; detail: string }> = [
    {
      id: 1,
      title: "Permission Model Hardening",
      status: app.hasHighRiskPermissions ? "fail" : "pass",
      detail: app.hasHighRiskPermissions
        ? `High-risk scopes: ${app.highRiskScopes.slice(0, 4).join(", ")}${app.highRiskScopes.length > 4 ? "…" : ""}`
        : `${app.permissions.reduce((s, p) => s + p.scopes.length, 0)} scope(s) — no high-risk permissions`,
    },
    {
      id: 2,
      title: "Consent & Governance Controls",
      status: app.hasTenantWideAdminConsent ? "warning" : "pass",
      detail: app.hasTenantWideAdminConsent
        ? "Tenant-wide admin consent granted — review regularly"
        : "No known tenant-wide consent grants detected",
    },
    {
      id: 3,
      title: "Credential Hygiene",
      status: app.hasExpiredCredentials ? "fail" : app.hasLongLivedSecrets ? "warning" : app.credentials.length === 0 ? "pass" : "pass",
      detail: app.hasExpiredCredentials
        ? "Expired credentials still registered — remove immediately"
        : app.hasLongLivedSecrets
        ? "Secrets with lifetime >12 months — rotate and shorten validity"
        : app.credentials.length === 0
        ? "No credentials — may rely on managed identity or federated credentials"
        : `${app.credentials.length} credential(s) — no hygiene issues`,
    },
    {
      id: 4,
      title: "Ownership & Accountability",
      status: app.owners.length === 0
        ? "fail"
        : app.owners.some((o) => o.accountEnabled === false)
        ? "warning"
        : "pass",
      detail: app.owners.length === 0
        ? "No owners assigned — orphaned application"
        : app.owners.some((o) => o.accountEnabled === false)
        ? `Owner account disabled: ${app.owners.filter((o) => o.accountEnabled === false).map((o) => o.displayName).join(", ")}`
        : `${app.owners.length} owner(s): ${app.owners.map((o) => o.displayName).join(", ")}`,
    },
    {
      id: 5,
      title: "App Exposure & Audience Configuration",
      status: app.signInAudience !== "AzureADMyOrg"
        ? "warning"
        : app.hasWildcardRedirectUris
        ? "warning"
        : "pass",
      detail: app.signInAudience !== "AzureADMyOrg"
        ? `Multi-tenant audience (${app.signInAudience}) — verify this is intentional`
        : app.hasWildcardRedirectUris
        ? "Non-HTTPS or insecure redirect URIs detected"
        : `Single-tenant · ${app.redirectUris.length} redirect URI(s)`,
    },
    {
      id: 6,
      title: "Service Principal & RBAC Alignment",
      status: "manual",
      detail: "Manually check: verify no directory roles (e.g. Global Admin) are assigned to this app's service principal",
    },
    {
      id: 7,
      title: "App Lifecycle & Usage Monitoring",
      status: "manual",
      detail: app.createdDateTime
        ? `Created ${formatDate(app.createdDateTime)} — verify app is still in use and permissions remain necessary`
        : "No creation date — confirm lifecycle status",
    },
    {
      id: 8,
      title: "App Registration Creation Controls",
      status: usersCanRegisterApps ? "warning" : "pass",
      detail: usersCanRegisterApps
        ? "All users in the tenant can create app registrations — consider restricting to admins"
        : "App registration creation is restricted to privileged users",
    },
    {
      id: 9,
      title: "Token & Authentication Security",
      status: "manual",
      detail: "Manually verify: only modern OAuth 2.0 flows used; no legacy ADAL/MSAL v1 or Azure AD Graph endpoints",
    },
    {
      id: 10,
      title: "Architectural Pattern Alignment",
      status: app.credentials.length > 0 && app.credentials.every((c) => c.type === "secret")
        ? "warning"
        : "pass",
      detail: app.credentials.length > 0 && app.credentials.every((c) => c.type === "secret")
        ? "Only client secrets — consider certificates or workload identity federation for Zero Trust alignment"
        : app.credentials.some((c) => c.type === "certificate")
        ? "Uses certificates — aligned with best practice"
        : "No client secrets — likely uses managed identity or federated credentials",
    },
  ];

  return (
    <div className="px-4 py-3 bg-muted/20 border-t space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: 10 Security Dimensions */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Security Assessment (10 Dimensions)
          </p>
          <div className="space-y-2">
            {dims.map((dim) => (
              <div key={dim.id} className="flex items-start gap-2">
                <StatusIcon status={dim.status} />
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-tight">{dim.id}. {dim.title}</p>
                  <p className="text-[11px] text-muted-foreground">{dim.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Credentials, Permissions, Redirect URIs */}
        <div className="space-y-4">

          {/* Credentials */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Credentials ({app.credentials.length})
            </p>
            {app.credentials.length === 0 ? (
              <p className="text-xs text-muted-foreground">No credentials registered (managed identity or federated?)</p>
            ) : (
              <div className="space-y-1">
                {app.credentials.map((cred) => {
                  const now = Date.now();
                  const isExpired = cred.endDateTime ? new Date(cred.endDateTime).getTime() < now : false;
                  const expiresMs = cred.endDateTime ? new Date(cred.endDateTime).getTime() - now : null;
                  const expiresSoon = expiresMs !== null && expiresMs > 0 && expiresMs < 30 * 24 * 60 * 60 * 1000;
                  return (
                    <div
                      key={cred.keyId}
                      className={`flex items-center gap-2 text-xs p-1.5 rounded border ${
                        isExpired
                          ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
                          : expiresSoon
                          ? "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20"
                          : "border-border bg-background"
                      }`}
                    >
                      {cred.type === "certificate"
                        ? <Lock className="w-3 h-3 text-green-500 flex-shrink-0" />
                        : <Key className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                      <span className="font-medium truncate">
                        {cred.displayName || (cred.type === "secret" ? `Secret …${cred.hint ?? ""}` : "Certificate")}
                      </span>
                      {cred.endDateTime && (
                        <span className={`ml-auto whitespace-nowrap text-[10px] ${isExpired ? "text-red-600 dark:text-red-400 font-semibold" : expiresSoon ? "text-yellow-600 dark:text-yellow-400 font-semibold" : "text-muted-foreground"}`}>
                          {isExpired ? "Expired" : "Expires"} {formatDate(cred.endDateTime)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Permissions */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Permissions ({app.permissions.reduce((s, p) => s + p.scopes.length, 0)} scopes)
            </p>
            {app.permissions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No permissions requested in manifest</p>
            ) : (
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {app.permissions.map((perm, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge className="text-[10px] font-normal border-0 px-1.5 py-0 h-4 bg-muted text-muted-foreground">
                        {perm.type === "Role" ? "Application" : "Delegated"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">{perm.resourceName}</span>
                      {perm.isHighRisk && (
                        <Badge className="text-[10px] font-normal border-0 px-1.5 py-0 h-4 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          High Risk
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 pl-1">
                      {perm.scopes.map((s) => (
                        <code
                          key={s}
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            HIGH_RISK_SCOPES.has(s)
                              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {s}
                        </code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Redirect URIs */}
          {app.redirectUris.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                Redirect URIs ({app.redirectUris.length})
              </p>
              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                {app.redirectUris.map((uri, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <code className={`text-[10px] truncate max-w-[280px] ${uri.startsWith("http://") && !uri.includes("localhost") ? "text-yellow-700 dark:text-yellow-400" : "text-muted-foreground"}`}>
                      {uri}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── main exported section ─────────────────────────────────────────────────────

export function EnterpriseAppsSection() {
  const { data, isLoading, isFetching } = useGetM365Apps();
  const loading = isLoading || isFetching;

  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [appFilter, setAppFilter]         = useState("");
  const [appSorting, setAppSorting]       = useState<SortingState>([{ id: "riskScore", desc: true }]);
  const [riskFilter, setRiskFilter]       = useState<"all" | "high" | "medium" | "low">("all");

  const C = {
    green: "#009118", red: "#A60808", yellow: "#eab308", blue: "#0079F2",
  };

  // ── table column definitions ────────────────────────────────────────────────
  const appColumns = useMemo<ColumnDef<AppRegistration>[]>(() => [
    {
      accessorKey: "displayName",
      header: "Application",
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-sm leading-tight">{row.original.displayName}</p>
          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{row.original.appId.slice(0, 8)}…</p>
        </div>
      ),
    },
    {
      accessorKey: "createdDateTime",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.createdDateTime ? formatDate(row.original.createdDateTime) : "—"}
        </span>
      ),
    },
    {
      accessorKey: "signInAudience",
      header: "Audience",
      cell: ({ row }) => {
        const aud = row.original.signInAudience;
        const isMulti = aud !== "AzureADMyOrg";
        return (
          <Badge className={`text-xs font-normal border-0 ${isMulti ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"}`}>
            {isMulti ? "Multi-tenant" : "Single Tenant"}
          </Badge>
        );
      },
    },
    {
      accessorKey: "owners",
      header: "Owners",
      cell: ({ row }) => {
        const owners = row.original.owners;
        if (owners.length === 0) {
          return <Badge variant="destructive" className="text-xs font-normal">No Owner</Badge>;
        }
        return (
          <div>
            <p className="text-xs">{owners[0].displayName}</p>
            {owners.length > 1 && <p className="text-[10px] text-muted-foreground">+{owners.length - 1} more</p>}
          </div>
        );
      },
    },
    {
      accessorKey: "credentials",
      header: "Credentials",
      cell: ({ row }) => {
        const creds = row.original.credentials;
        const secrets = creds.filter((c: AppCredential) => c.type === "secret").length;
        const certs   = creds.filter((c: AppCredential) => c.type === "certificate").length;
        if (creds.length === 0) return <span className="text-xs text-muted-foreground">None</span>;
        const warn = row.original.hasExpiredCredentials || row.original.hasLongLivedSecrets;
        return (
          <div className="flex gap-1 flex-wrap">
            {secrets > 0 && (
              <Badge className={`text-xs font-normal border-0 ${warn ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" : "bg-muted text-muted-foreground"}`}>
                {secrets} secret{secrets !== 1 ? "s" : ""}
              </Badge>
            )}
            {certs > 0 && (
              <Badge className="text-xs font-normal border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                {certs} cert{certs !== 1 ? "s" : ""}
              </Badge>
            )}
            {row.original.hasExpiredCredentials && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
          </div>
        );
      },
    },
    {
      accessorKey: "permissions",
      header: "Permissions",
      cell: ({ row }) => {
        const perms = row.original.permissions;
        if (perms.length === 0) return <span className="text-xs text-muted-foreground">None</span>;
        const total = perms.reduce((s: number, p: AppPermission) => s + p.scopes.length, 0);
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-xs">{total} scope{total !== 1 ? "s" : ""}</span>
            {row.original.hasHighRiskPermissions && (
              <Badge className="text-xs font-normal border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                High Risk
              </Badge>
            )}
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
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={(e) => {
            e.stopPropagation();
            setExpandedAppId(expandedAppId === row.original.id ? null : row.original.id);
          }}
        >
          {expandedAppId === row.original.id
            ? <ChevronUp className="w-4 h-4" />
            : <ChevronDown className="w-4 h-4" />}
        </Button>
      ),
    },
  ], [expandedAppId]);

  // ── filtered app list ───────────────────────────────────────────────────────
  const filteredApps = useMemo(() => {
    let list = data?.apps ?? [];
    if (riskFilter !== "all") list = list.filter((a) => a.riskLevel === riskFilter);
    return list;
  }, [data, riskFilter]);

  const appTable = useReactTable({
    data: filteredApps,
    columns: appColumns,
    state: { sorting: appSorting, globalFilter: appFilter },
    onSortingChange: setAppSorting,
    onGlobalFilterChange: setAppFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
  });

  // ── enterprise apps security checklist ─────────────────────────────────────
  const appChecklist = useMemo<ChecklistGroup[]>(() => [
    { id: "EA.1", title: "EA.1 Permission Model Hardening — least privilege for all apps", items: [
      { label: "No app registrations hold high-risk Graph permissions",
        status: (data?.appsWithHighRisk ?? 0) === 0 ? "pass" : "fail",
        detail: (data?.appsWithHighRisk ?? 0) === 0
          ? "No high-risk permissions detected across app registrations"
          : `${data?.appsWithHighRisk} app(s) hold high-risk permissions (e.g. Directory.ReadWrite.All)` },
    ]},
    { id: "EA.2", title: "EA.2 Consent & Governance Controls — admin approval required", items: [
      { label: "User app registration creation is restricted or governed",
        status: data?.usersCanRegisterApps ? "warning" : "pass",
        detail: data?.usersCanRegisterApps
          ? "Default user role allows app registration — restrict to admins"
          : "App registration creation is restricted to privileged users" },
    ]},
    { id: "EA.3", title: "EA.3 Credential Hygiene — short-lived secrets and certificates", items: [
      { label: "No long-lived client secrets (>12 months)",
        status: (data?.appsWithLongLivedSecrets ?? 0) === 0 ? "pass" : "warning",
        detail: (data?.appsWithLongLivedSecrets ?? 0) === 0
          ? "All secrets are within 12-month validity"
          : `${data?.appsWithLongLivedSecrets} app(s) have secrets valid for over 12 months` },
      { label: "No expired credentials still registered",
        status: (data?.appsWithExpiredCredentials ?? 0) === 0 ? "pass" : "fail",
        detail: (data?.appsWithExpiredCredentials ?? 0) === 0
          ? "No expired credentials found"
          : `${data?.appsWithExpiredCredentials} app(s) have expired credentials — remove immediately` },
    ]},
    { id: "EA.4", title: "EA.4 Ownership & Accountability — every app has an active owner", items: [
      { label: "All app registrations have at least one assigned owner",
        status: (data?.appsWithNoOwner ?? 0) === 0 ? "pass" : "fail",
        detail: (data?.appsWithNoOwner ?? 0) === 0
          ? "All apps have owners"
          : `${data?.appsWithNoOwner} orphaned app registration(s) with no owner` },
    ]},
    { id: "EA.5", title: "EA.5 App Exposure — single-tenant unless explicitly justified", items: [
      { label: "No unjustified multi-tenant applications",
        status: (data?.multiTenantApps ?? 0) === 0 ? "pass" : "warning",
        detail: (data?.multiTenantApps ?? 0) === 0
          ? "All apps are single-tenant"
          : `${data?.multiTenantApps} multi-tenant app(s) — review audience settings` },
    ]},
    { id: "EA.6", title: "EA.6 Service Principal & RBAC Alignment — least privileged roles", items: [
      { label: "Apps do not hold directory roles or high-privilege RBAC assignments", status: "manual",
        detail: "Manually verify: no service principals are assigned Global Admin or equivalent directory roles" },
    ]},
    { id: "EA.7", title: "EA.7 App Lifecycle & Usage Monitoring — remove unused apps", items: [
      { label: "No unused or inactive applications remain in production", status: "manual",
        detail: "Review sign-in activity for each app and retire unused registrations" },
    ]},
    { id: "EA.8", title: "EA.8 App Registration Creation Controls — restricted to admins", items: [
      { label: "App registration creation restricted to privileged users only",
        status: data?.usersCanRegisterApps ? "fail" : "pass",
        detail: data?.usersCanRegisterApps
          ? "Authorization policy allows all users to create app registrations — restrict this"
          : "App registration creation is restricted" },
    ]},
    { id: "EA.9", title: "EA.9 Token & Authentication Security — modern flows only", items: [
      { label: "Only modern OAuth 2.0 flows used; no legacy authentication endpoints", status: "manual",
        detail: "Check sign-in logs for legacy authentication (Basic Auth, ADAL) and disable if found" },
    ]},
    { id: "EA.10", title: "EA.10 Architectural Pattern — certificates or federated over secrets", items: [
      { label: "Apps prefer certificates or workload identity federation over client secrets",
        status: "manual",
        detail: "Review apps using only client secrets and migrate to certificates or managed identities" },
    ]},
  ], [data]);

  // ── render ──────────────────────────────────────────────────────────────────

  if (!loading && data?.permissionError) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-500" />
          <h2 className="text-base font-semibold">Enterprise Application Registrations</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border rounded-lg">
          <ShieldAlert className="w-10 h-10 text-muted-foreground" />
          <div>
            <p className="font-medium">Additional permissions required</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              Grant{" "}
              <code className="bg-muted px-1 rounded text-xs">Application.Read.All</code> and{" "}
              <code className="bg-muted px-1 rounded text-xs">Policy.Read.All</code>{" "}
              to your Azure app registration, then refresh.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const riskCounts = {
    high:   (data?.apps ?? []).filter((a) => a.riskLevel === "high").length,
    medium: (data?.apps ?? []).filter((a) => a.riskLevel === "medium").length,
    low:    (data?.apps ?? []).filter((a) => a.riskLevel === "low").length,
  };

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <h2 className="text-base font-semibold">Enterprise Application Registrations</h2>
        {!loading && (
          <Badge variant="outline" className="font-normal text-xs">
            {data?.totalApps ?? 0} apps
          </Badge>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard title="App Registrations"  value={data?.totalApps}                    loading={loading} />
        <KPICard title="No Owner"           value={data?.appsWithNoOwner}              loading={loading} valueColor={(data?.appsWithNoOwner ?? 0) > 0 ? C.red : C.green} />
        <KPICard title="High Risk"          value={data?.appsWithHighRisk}             loading={loading} valueColor={(data?.appsWithHighRisk ?? 0) > 0 ? C.red : C.green} />
        <KPICard title="Expired Creds"      value={data?.appsWithExpiredCredentials}   loading={loading} valueColor={(data?.appsWithExpiredCredentials ?? 0) > 0 ? C.red : C.green} />
        <KPICard title="Long-lived Secrets" value={data?.appsWithLongLivedSecrets}     loading={loading} valueColor={(data?.appsWithLongLivedSecrets ?? 0) > 0 ? C.yellow : C.green} />
        <KPICard title="Multi-tenant"       value={data?.multiTenantApps}             loading={loading} valueColor={(data?.multiTenantApps ?? 0) > 0 ? C.yellow : C.green} />
      </div>

      {/* Warning: users can register apps */}
      {!loading && data?.usersCanRegisterApps && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-800 px-4 py-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
          <div className="text-sm text-yellow-800 dark:text-yellow-300">
            <span className="font-semibold">All users can register app registrations.</span>{" "}
            This is a security risk — unapproved or malicious apps can be registered without admin review.
            Restrict this in{" "}
            <span className="font-medium">Entra ID → User settings → App registrations</span>.
          </div>
        </div>
      )}

      {/* App registrations table */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0 flex-wrap gap-3">
          <div>
            <CardTitle className="text-base">App Registrations</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Click any row's expand button to see the full 10-dimension security assessment
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Risk filter pills */}
            {(["all", "high", "medium", "low"] as const).map((r) => {
              const labels = {
                all: `All (${data?.totalApps ?? 0})`,
                high: `High (${riskCounts.high})`,
                medium: `Medium (${riskCounts.medium})`,
                low: `Low (${riskCounts.low})`,
              };
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
                  {labels[r]}
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-64" />
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                placeholder="Search apps by name, appId…"
                value={appFilter}
                onChange={(e) => setAppFilter(e.target.value)}
                className="max-w-sm"
              />

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {appTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((header) => (
                          <TableHead
                            key={header.id}
                            onClick={header.column.getToggleSortingHandler()}
                            className={`whitespace-nowrap ${header.column.getCanSort() ? "cursor-pointer select-none" : ""}`}
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
                    {appTable.getRowModel().rows.length > 0 ? (
                      appTable.getRowModel().rows.map((row) => (
                        <>
                          <TableRow
                            key={row.id}
                            className={
                              row.original.riskLevel === "high"
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
                          {expandedAppId === row.original.id && (
                            <TableRow key={`${row.id}-detail`} className="hover:bg-transparent">
                              <TableCell colSpan={appColumns.length} className="p-0">
                                <AppDetailPanel
                                  app={row.original}
                                  usersCanRegisterApps={data?.usersCanRegisterApps}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={appColumns.length} className="h-24 text-center text-muted-foreground">
                          {data?.totalApps === 0 ? "No app registrations found." : "No results match the current filter."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {appTable.getFilteredRowModel().rows.length} of {data?.totalApps ?? 0} app{(data?.totalApps ?? 0) !== 1 ? "s" : ""}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => appTable.previousPage()} disabled={!appTable.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => appTable.nextPage()} disabled={!appTable.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enterprise Apps Security Checklist */}
      <ChecklistTable
        sectionTitle="Enterprise Applications (EA)"
        groups={appChecklist}
        loading={loading}
      />

    </div>
  );
}
