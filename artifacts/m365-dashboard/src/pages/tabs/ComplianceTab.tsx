import { useGetM365ComplianceWithMetadata, useGetM365ServiceHealthWithMetadata, useGetM365DataSources } from "@workspace/api-client-react";
import { ChecklistTable, type ChecklistGroup } from "@/components/ChecklistTable";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { PermissionCodeList } from "@/components/PermissionCodeList";
import { COMPLIANCE_SENSITIVITY_LABELS_PERMISSIONS } from "@/lib/permissions";
import { AlertTriangle, CheckCircle, Info, Lock, Tag } from "lucide-react";
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
import { CSVLink } from "react-csv";
import { Download } from "lucide-react";
import type { SensitivityLabelItem } from "@workspace/api-client-react";
import type { ConfidenceLabel, EvidenceStatus } from "@workspace/permissions-manifest";

const CHART_COLORS = {
  blue: "#1E3D59",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
  yellow: "#eab308",
  gray: "#9ca3af",
};

const labelColumns: ColumnDef<SensitivityLabelItem>[] = [
  {
    accessorKey: "name",
    header: "Label Name",
    cell: ({ row }) => {
      const { color, name, tooltip, parent } = row.original;
      return (
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            {color ? (
              <span
                className="inline-block w-3 h-3 rounded-sm flex-shrink-0 border border-black/10"
                style={{ backgroundColor: color }}
              />
            ) : (
              <Tag className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            )}
            <span className="font-medium truncate">{name}</span>
            {parent && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal text-muted-foreground">sub-label</Badge>
            )}
          </div>
          {tooltip && (
            <p className="text-xs text-muted-foreground pl-5 leading-tight truncate max-w-[260px]">{tooltip}</p>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "sensitivity",
    header: "Order",
    cell: ({ row }) => (
      <span className="font-mono text-sm tabular-nums">{row.original.sensitivity}</span>
    ),
  },
  {
    accessorKey: "contentFormats",
    header: "Applies To",
    cell: ({ row }) => {
      const formats = row.original.contentFormats ?? [];
      return (
        <div className="flex flex-wrap gap-1">
          {formats.length > 0 ? formats.map((f: string) => (
            <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0 capitalize font-normal">{f}</Badge>
          )) : <span className="text-muted-foreground text-sm">—</span>}
        </div>
      );
    },
  },
  {
    accessorKey: "hasProtection",
    header: "Protection",
    cell: ({ row }) =>
      row.original.hasProtection ? (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-normal text-xs">Encrypted</Badge>
      ) : (
        <span className="text-muted-foreground text-sm">None</span>
      ),
  },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) => {
      const { isActive, isAppliable } = row.original;
      if (!isActive) return <Badge variant="outline" className="text-muted-foreground font-normal text-xs">Inactive</Badge>;
      if (!isAppliable) return <Badge variant="outline" className="font-normal text-xs">View only</Badge>;
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal text-xs">Active</Badge>;
    },
  },
];

export function ComplianceTab() {
  const { data: complianceWithMetadata, isLoading: isComplianceLoading, isFetching: isComplianceFetching } = useGetM365ComplianceWithMetadata();
  const { data: healthWithMetadata, isLoading: isHealthLoading, isFetching: isHealthFetching } = useGetM365ServiceHealthWithMetadata();
  const { data: dataSources } = useGetM365DataSources({ tab: "compliance" });

  const { theme } = useTheme();
  const isDark = theme === "dark";

  const compLoading = isComplianceLoading || isComplianceFetching;
  const healthLoading = isHealthLoading || isHealthFetching;
  const compliance = complianceWithMetadata?.data;
  const health = healthWithMetadata?.data;

  const registryItems =
    (dataSources as {
      items?: Array<{
        metricId: string;
        confidenceLabel: ConfidenceLabel;
        evidenceStatus: EvidenceStatus;
      }>;
    } | undefined)?.items ?? [];

  const getMetricMeta = (metricId: string) =>
    registryItems.find((item) => item.metricId === metricId);

  const serviceHealthMetricToFieldMap: Record<string, string> = {
    "serviceHealth.totalServices": "totalServices",
    "serviceHealth.activeIncidents": "activeIncidents",
    "serviceHealth.activeAdvisories": "activeAdvisories",
  };

  const complianceMetricToFieldMap: Record<string, string> = {
    "compliance.dlpPolicies": "dlpPolicies",
    "compliance.activeDlpPolicies": "activeDlpPolicies",
    "compliance.retentionPolicies": "retentionPolicies",
    "compliance.sensitivityLabels": "sensitivityLabels",
    "compliance.checklist.7.3.retentionPolicies": "retentionPolicies",
    "compliance.checklist.7.4.sensitivityLabels": "sensitivityLabels",
    "compliance.checklist.7.5.dlpPolicies": "dlpPolicies",
  };

  const getMetricMetaWithFieldFallback = (metricId: string) => {
    const complianceField = complianceMetricToFieldMap[metricId];
    if (complianceField) {
      const meta = complianceWithMetadata?.fieldMetadata?.[complianceField];
      if (meta) return meta;
    }

    const field = serviceHealthMetricToFieldMap[metricId];
    if (field) {
      const meta = healthWithMetadata?.fieldMetadata?.[field];
      if (meta) return meta;
    }
    return getMetricMeta(metricId);
  };

  // ── Section 7: Purview / Compliance checklist ────────────────────────────────
  const auditEnabled = (compliance?.auditLogEnabled && compliance?.unifiedAuditLogEnabled) ?? false;
  const hasLabels = (compliance?.sensitivityLabels ?? 0) > 0;
  const hasDlp = (compliance?.dlpPolicies ?? 0) > 0;
  const hasActiveDlp = (compliance?.activeDlpPolicies ?? 0) > 0;
  const hasRetention = (compliance?.retentionPolicies ?? 0) > 0;
  const complianceChecklist: ChecklistGroup[] = [
    { id: "7.1", title: "7.1 Data Backups are configured and tested", items: [
      { label: "Microsoft 365 backup or 3rd party backup solution is configured", status: "manual",
        evidenceStatus: getMetricMeta("compliance.checklist.7.1.backup")?.evidenceStatus,
        metricId: "compliance.checklist.7.1.backup",
      },
      { label: "Backup restoration has been tested", status: "manual",
        evidenceStatus: getMetricMeta("compliance.checklist.7.1.backupTest")?.evidenceStatus,
        metricId: "compliance.checklist.7.1.backupTest",
      },
    ]},
    { id: "7.2", title: "7.2 Audit Logging is enabled", items: [
      { label: "Unified Audit Log is enabled",
        status: auditEnabled ? "pass" : "fail",
        detail: auditEnabled ? "Enabled" : "Not Enabled",
        evidenceStatus: getMetricMeta("compliance.checklist.7.2.auditLogging")?.evidenceStatus,
        confidenceLabel: getMetricMetaWithFieldFallback("compliance.checklist.7.2.auditLogging")?.confidenceLabel,
        metricId: "compliance.checklist.7.2.auditLogging",
        sourceLabel: "Graph API",
      },
      { label: "Audit log data is retained for an appropriate period", status: "manual",
        evidenceStatus: getMetricMeta("compliance.checklist.7.2.auditRetention")?.evidenceStatus,
        metricId: "compliance.checklist.7.2.auditRetention",
      },
    ]},
    { id: "7.3", title: "7.3 Retention Policies are configured", items: [
      { label: "Retention policies are configured for key data sources",
        status: hasRetention ? "pass" : "fail",
        detail: hasRetention ? `${compliance?.retentionPolicies} policies configured` : "No retention policies found",
        evidenceStatus: getMetricMetaWithFieldFallback("compliance.checklist.7.3.retentionPolicies")?.evidenceStatus,
        confidenceLabel: getMetricMetaWithFieldFallback("compliance.checklist.7.3.retentionPolicies")?.confidenceLabel,
        metricId: "compliance.checklist.7.3.retentionPolicies",
        sourceLabel: "Graph API",
      },
    ]},
    { id: "7.4", title: "7.4 Sensitivity Labels are implemented", items: [
      { label: "Sensitivity labels are published for users",
        status: hasLabels ? "pass" : "fail",
        detail: hasLabels ? `${compliance?.sensitivityLabels} labels configured` : "No sensitivity labels found",
        evidenceStatus: getMetricMetaWithFieldFallback("compliance.checklist.7.4.sensitivityLabels")?.evidenceStatus,
        confidenceLabel: getMetricMetaWithFieldFallback("compliance.checklist.7.4.sensitivityLabels")?.confidenceLabel,
        metricId: "compliance.checklist.7.4.sensitivityLabels",
        sourceLabel: "Graph API",
      },
      { label: "Labels applied automatically based on content scanning", status: "manual",
        evidenceStatus: getMetricMeta("compliance.checklist.7.4.autoLabeling")?.evidenceStatus,
        metricId: "compliance.checklist.7.4.autoLabeling",
      },
    ]},
    { id: "7.5", title: "7.5 Data Loss Prevention (DLP) policies are implemented", items: [
      { label: "DLP policies exist for sensitive data types",
        status: hasDlp ? (hasActiveDlp ? "pass" : "warning") : "fail",
        detail: hasDlp ? (hasActiveDlp ? `${compliance?.activeDlpPolicies} active DLP policies` : `${compliance?.dlpPolicies} policies (none active)`) : "No DLP policies found",
        evidenceStatus: getMetricMetaWithFieldFallback("compliance.checklist.7.5.dlpPolicies")?.evidenceStatus,
        confidenceLabel: getMetricMetaWithFieldFallback("compliance.checklist.7.5.dlpPolicies")?.confidenceLabel,
        metricId: "compliance.checklist.7.5.dlpPolicies",
        sourceLabel: "Graph API",
      },
      { label: "DLP policies cover Exchange, SharePoint, Teams, and endpoints", status: "manual",
        evidenceStatus: getMetricMeta("compliance.checklist.7.5.dlpCoverage")?.evidenceStatus,
        metricId: "compliance.checklist.7.5.dlpCoverage",
      },
    ]},
  ];

  const scoreValue = compliance?.complianceScore || 0;
  const scoreMax = compliance?.complianceScoreMax || 100;
  const scorePercent = scoreMax > 0 ? (scoreValue / scoreMax) * 100 : 0;

  const gaugeData = [
    { name: "Score", value: scoreValue },
    { name: "Remaining", value: scoreMax - scoreValue },
  ];

  const [labelSorting, setLabelSorting] = useState<SortingState>([{ id: "sensitivity", desc: true }]);
  const [labelFilter, setLabelFilter] = useState("");

  const labelTable = useReactTable({
    data: compliance?.sensitivityLabelsList ?? [],
    columns: labelColumns,
    state: { sorting: labelSorting, globalFilter: labelFilter },
    onSortingChange: setLabelSorting,
    onGlobalFilterChange: setLabelFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  return (
    <div className="space-y-4">
      <CollapsibleSection title="Summary" description="Compliance policies, score, and audit status" storageKey="compliance-summary" defaultOpen={true} density="compact">
        <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="DLP Policies"
            value={compliance?.dlpPolicies}
            loading={compLoading}
            evidenceStatus={getMetricMetaWithFieldFallback("compliance.dlpPolicies")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("compliance.dlpPolicies")?.confidenceLabel}
          />
          <KPICard
            title="Active DLP"
            value={compliance?.activeDlpPolicies}
            loading={compLoading}
            valueColor={CHART_COLORS.green}
            evidenceStatus={getMetricMetaWithFieldFallback("compliance.activeDlpPolicies")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("compliance.activeDlpPolicies")?.confidenceLabel}
          />
          <KPICard
            title="Retention Policies"
            value={compliance?.retentionPolicies}
            loading={compLoading}
            evidenceStatus={getMetricMetaWithFieldFallback("compliance.retentionPolicies")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("compliance.retentionPolicies")?.confidenceLabel}
          />
          <KPICard
            title="Sensitivity Labels"
            value={compliance?.sensitivityLabels}
            loading={compLoading}
            valueColor={CHART_COLORS.blue}
            evidenceStatus={getMetricMetaWithFieldFallback("compliance.sensitivityLabels")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("compliance.sensitivityLabels")?.confidenceLabel}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-base text-center">Compliance Score</CardTitle>
            </CardHeader>
            <CardContent>
              {compLoading ? <Skeleton className="w-full h-[250px]" /> : (
                <div className="flex flex-col items-center relative">
                  <ResponsiveContainer width="100%" height={200} debounce={0}>
                    <PieChart>
                      <Pie
                        data={gaugeData}
                        cx="50%"
                        cy="100%"
                        startAngle={180}
                        endAngle={0}
                        innerRadius={70}
                        outerRadius={90}
                        paddingAngle={0}
                        dataKey="value"
                        stroke="none"
                        isAnimationActive={false}
                      >
                        <Cell fill={scorePercent >= 80 ? CHART_COLORS.green : scorePercent >= 60 ? CHART_COLORS.blue : CHART_COLORS.red} />
                        <Cell fill={isDark ? "rgba(255,255,255,0.1)" : "#f3f4f6"} />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute top-[130px] flex flex-col items-center">
                    <span className="text-3xl font-bold">{Math.round(scorePercent)}%</span>
                    <span className="text-xs text-muted-foreground">{Math.round(scoreValue)} / {Math.round(scoreMax)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-base">Auditing & eDiscovery</CardTitle>
            </CardHeader>
            <CardContent>
              {compLoading ? (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="p-4 border rounded-md flex flex-col justify-center items-center text-center bg-card">
                    <p className="text-sm text-muted-foreground font-medium mb-2">Unified Audit Log</p>
                    {compliance?.unifiedAuditLogEnabled ?
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-sm py-1 px-3">Enabled</Badge> :
                      <Badge variant="destructive" className="text-sm py-1 px-3">Disabled</Badge>
                    }
                  </div>
                  <div className="p-4 border rounded-md flex flex-col justify-center items-center text-center bg-card">
                    <p className="text-sm text-muted-foreground font-medium mb-2">Audit Log Search</p>
                    {compliance?.auditLogEnabled ?
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-sm py-1 px-3">Enabled</Badge> :
                      <Badge variant="destructive" className="text-sm py-1 px-3">Disabled</Badge>
                    }
                  </div>
                  <div className="p-4 border rounded-md flex flex-col justify-center items-center text-center bg-card">
                    <p className="text-sm text-muted-foreground font-medium mb-1">eDiscovery Cases</p>
                    <p className="text-3xl font-bold" style={{ color: CHART_COLORS.purple }}>{compliance?.eDiscoveryCases}</p>
                  </div>
                  <div className="p-4 border rounded-md flex flex-col justify-center items-center text-center bg-card">
                    <p className="text-sm text-muted-foreground font-medium mb-1">DLP Policy Matches</p>
                    <p className="text-3xl font-bold" style={{ color: CHART_COLORS.red }}>{compliance?.dlpPolicyMatches}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Sensitivity Labels"
        storageKey="compliance-sensitivity-labels"
        description={!compLoading ? `${compliance?.sensitivityLabelsList.length ?? 0} labels configured` : undefined}
        actions={compliance && compliance.sensitivityLabelsList.length > 0 ? (
            <CSVLink
              data={compliance.sensitivityLabelsList.map(l => ({
                Name: l.name,
                Tooltip: l.tooltip,
                SensitivityOrder: l.sensitivity,
                Color: l.color,
                HasProtection: l.hasProtection,
                ContentFormats: (l.contentFormats ?? []).join(", "),
                Active: l.isActive,
                Appliable: l.isAppliable,
                Type: l.parent ? "Sub-label" : "Top-level",
              }))}
              filename="sensitivity-labels.csv"
              className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80"
              style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
              aria-label="Export labels as CSV"
            >
              <Download className="w-3.5 h-3.5" />
            </CSVLink>
          ) : undefined}
      >
        {compLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : compliance?.sensitivityLabelsPermissionRequired && compliance.sensitivityLabelsList.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                <Lock className="w-10 h-10 text-muted-foreground" />
                <p className="font-medium">Additional permission required</p>
                <p className="text-sm text-muted-foreground max-w-md">
                  To display sensitivity labels, add <PermissionCodeList permissions={COMPLIANCE_SENSITIVITY_LABELS_PERMISSIONS.optionalPermissions.map((permission) => permission.name)} codeClassName="bg-muted px-1 rounded text-xs" /> application permission to your Azure app registration and grant admin consent.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : compliance?.sensitivityLabelsList.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <Tag className="w-8 h-8 text-muted-foreground" />
                <p className="text-muted-foreground">No sensitivity labels found in this tenant.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
                <Input
                  placeholder="Search labels..."
                  value={labelFilter}
                  onChange={(e) => setLabelFilter(e.target.value)}
                  className="max-w-sm"
                />
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      {labelTable.getHeaderGroups().map((hg) => (
                        <TableRow key={hg.id}>
                          {hg.headers.map((header) => (
                            <TableHead
                              key={header.id}
                              onClick={header.column.getToggleSortingHandler()}
                              className="cursor-pointer select-none"
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
                      {labelTable.getRowModel().rows.length > 0 ? (
                        labelTable.getRowModel().rows.map((row) => (
                          <TableRow key={row.id}>
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id}>
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={labelColumns.length} className="h-20 text-center text-muted-foreground">
                            No labels match the search.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Showing{" "}
                    {labelTable.getState().pagination.pageIndex * labelTable.getState().pagination.pageSize + (labelTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)}{" "}
                    to{" "}
                    {Math.min(
                      (labelTable.getState().pagination.pageIndex + 1) * labelTable.getState().pagination.pageSize,
                      labelTable.getFilteredRowModel().rows.length
                    )}{" "}
                    of {labelTable.getFilteredRowModel().rows.length}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => labelTable.previousPage()} disabled={!labelTable.getCanPreviousPage()}>Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => labelTable.nextPage()} disabled={!labelTable.getCanNextPage()}>Next</Button>
                  </div>
                </div>
              </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Service Health" description="M365 service status and incidents" storageKey="compliance-service-health-outer" defaultOpen={true} density="compact">
        <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KPICard
            title="Total Services"
            value={health?.totalServices}
            loading={healthLoading}
            evidenceStatus={getMetricMetaWithFieldFallback("serviceHealth.totalServices")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("serviceHealth.totalServices")?.confidenceLabel}
          />
          <KPICard
            title="Active Incidents"
            value={health?.activeIncidents}
            loading={healthLoading}
            valueColor={health && health.activeIncidents > 0 ? CHART_COLORS.red : CHART_COLORS.green}
            evidenceStatus={getMetricMetaWithFieldFallback("serviceHealth.activeIncidents")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("serviceHealth.activeIncidents")?.confidenceLabel}
          />
          <KPICard
            title="Active Advisories"
            value={health?.activeAdvisories}
            loading={healthLoading}
            valueColor={health && health.activeAdvisories > 0 ? CHART_COLORS.yellow : CHART_COLORS.green}
            evidenceStatus={getMetricMetaWithFieldFallback("serviceHealth.activeAdvisories")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("serviceHealth.activeAdvisories")?.confidenceLabel}
          />
        </div>

        <CollapsibleSection title="All Services Status" storageKey="compliance-service-health">
            {healthLoading ? (
              <div className="space-y-2 mt-2">
                {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : health?.services && health.services.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                {health.services.map((service) => {
                  const isHealthy = service.status === "serviceOperational";
                  const isDegraded = service.status === "serviceDegradation" || service.status === "serviceInterruption";
                  const friendlyStatus = isHealthy ? "Operational" :
                    service.status === "serviceDegradation" ? "Degraded" :
                    service.status === "serviceInterruption" ? "Interrupted" :
                    service.status === "investigating" ? "Investigating" :
                    service.status === "restoringService" ? "Restoring" :
                    service.status === "verifyingService" ? "Verifying" :
                    service.status === "serviceRestored" ? "Restored" :
                    service.status ?? "Unknown";

                  return (
                    <div key={service.service} className="p-3 border rounded-md flex items-center bg-card">
                      <div className="mr-3">
                        {isHealthy ? <CheckCircle className="w-5 h-5 text-green-500" /> :
                          isDegraded ? <AlertTriangle className="w-5 h-5 text-red-500" /> :
                            <Info className="w-5 h-5 text-yellow-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{service.service}</p>
                        <p className="text-xs text-muted-foreground truncate">{friendlyStatus}</p>
                      </div>
                      {service.hasActiveIssues && (
                        <Badge variant="outline" className="ml-2 bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900 whitespace-nowrap">
                          {service.activeIncidents > 0 ? `${service.activeIncidents} Incident(s)` : "Advisory"}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                <Lock className="w-8 h-8 text-muted-foreground" />
                <p className="font-medium text-sm">Service Health data unavailable</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Add <code className="bg-muted px-1 rounded">ServiceHealth.Read.All</code> application permission to your Azure app registration to enable this section.
                </p>
              </div>
            )}
        </CollapsibleSection>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Summary Check List" storageKey="compliance-checklist" defaultOpen={false}>
        <ChecklistTable sectionTitle="" groups={complianceChecklist} loading={compLoading} />
      </CollapsibleSection>

    </div>
  );
}
