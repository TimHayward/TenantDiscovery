import { useGetM365ComplianceWithMetadata, useGetM365ServiceHealthWithMetadata, useGetM365DataSources } from "@workspace/api-client-react";
import { ChecklistTable, type ChecklistGroup } from "@/components/ChecklistTable";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui-kit/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@workspace/ui-kit/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { ErrorPanel, RefreshIndicator } from "@/components/ErrorPanel";
import { TableSkeleton } from "@/components/TableSkeleton";
import { getCollectionIssues, summarizeIssues } from "@/lib/collectionStatus";
import { useChartTheme } from "@/lib/useChartTheme";
import { PermissionCodeList } from "@/components/PermissionCodeList";
import { COMPLIANCE_SENSITIVITY_LABELS_PERMISSIONS } from "@/lib/permissions";
import { AlertTriangle, CheckCircle, Info, Lock, Tag } from "lucide-react";
import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Input } from "@workspace/ui-kit/input";
import { ExportBtn } from "@/components/ExportBtn";
import { DataTable } from "@/components/DataTable";
import type { SensitivityLabelItem } from "@workspace/api-client-react";
import type { ConfidenceLabel, EvidenceStatus } from "@workspace/permissions-manifest";

import { chartPalette as CHART_COLORS } from "@/lib/chartPalette";

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
  const {
    data: complianceWithMetadata,
    isLoading: isComplianceLoading,
    isFetching: isComplianceFetching,
    isError: isComplianceError,
    error: complianceError,
    refetch: refetchCompliance,
  } = useGetM365ComplianceWithMetadata();
  const {
    data: healthWithMetadata,
    isLoading: isHealthLoading,
    isFetching: isHealthFetching,
    isError: isHealthError,
    error: healthError,
    refetch: refetchHealth,
  } = useGetM365ServiceHealthWithMetadata();
  const { data: dataSources } = useGetM365DataSources({ tab: "compliance" });

  const { isDark } = useChartTheme();

  const compLoading = isComplianceLoading;
  const healthLoading = isHealthLoading;
  const compliance = complianceWithMetadata?.data;
  const health = healthWithMetadata?.data;
  const complianceIssue = summarizeIssues(getCollectionIssues(compliance));
  const healthIssue = summarizeIssues(getCollectionIssues(health));

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
  // Retention is API-backed only when the retention labels endpoint responded; otherwise it is a manual check.
  const retentionApiBacked = compliance?.retentionEvidence === "apiBacked" && compliance?.retentionLabelCount != null;
  const retentionCount = compliance?.retentionLabelCount ?? 0;
  const hasRetention = retentionApiBacked && retentionCount > 0;
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
      { label: "Retention labels are published for key data sources",
        status: retentionApiBacked ? (hasRetention ? "pass" : "fail") : "manual",
        detail: retentionApiBacked
          ? (hasRetention ? `${retentionCount} retention labels published` : "No retention labels found")
          : undefined,
        evidenceStatus: getMetricMetaWithFieldFallback("compliance.checklist.7.3.retentionPolicies")?.evidenceStatus,
        confidenceLabel: getMetricMetaWithFieldFallback("compliance.checklist.7.3.retentionPolicies")?.confidenceLabel,
        metricId: "compliance.checklist.7.3.retentionPolicies",
        sourceLabel: retentionApiBacked ? "Graph API" : undefined,
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

  const [labelFilter, setLabelFilter] = useState("");

  if (isComplianceError) {
    return <ErrorPanel title="Couldn't load compliance data" error={complianceError} onRetry={() => refetchCompliance()} />;
  }

  return (
    <div className="relative space-y-4">
      <RefreshIndicator active={(isComplianceFetching || isHealthFetching) && !(isComplianceLoading || isHealthLoading)} />
      <CollapsibleSection title="Summary" description="Compliance policies, score, and audit status" storageKey="compliance-summary" defaultOpen={true} density="compact" issue={complianceIssue}>
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
            title="Retention Labels"
            value={retentionApiBacked ? retentionCount : "Manual check"}
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
        {(compliance?.collectionNotes ?? []).map((note) => (
          <p key={note} className="text-[11px] text-muted-foreground">{note}</p>
        ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Sensitivity Labels"
        storageKey="compliance-sensitivity-labels"
        description={!compLoading ? `${compliance?.sensitivityLabelsList.length ?? 0} labels configured` : undefined}
        actions={
          <ExportBtn
            filename="sensitivity-labels.csv"
            ariaLabel="Export labels as CSV"
            data={(compliance?.sensitivityLabelsList ?? []).map((l) => ({
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
          />
        }
      >
        {compLoading ? (
          <TableSkeleton rows={4} rowClassName="h-12" className="p-0" />
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
                  placeholder="Search labels…"
                  value={labelFilter}
                  onChange={(e) => setLabelFilter(e.target.value)}
                  className="max-w-sm"
                />
                <DataTable
                  columns={labelColumns}
                  data={compliance?.sensitivityLabelsList ?? []}
                  globalFilter={labelFilter}
                  initialSorting={[{ id: "sensitivity", desc: true }]}
                  pageSize={10}
                  rowNoun="labels"
                  emptyMessage="No labels match the search."
                />
              </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Service Health" description="M365 service status and incidents" storageKey="compliance-service-health-outer" defaultOpen={true} density="compact" issue={healthIssue}>
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
            {isHealthError ? (
              <ErrorPanel title="Couldn't load service health" error={healthError} onRetry={() => refetchHealth()} />
            ) : healthLoading ? (
              <TableSkeleton rows={8} rowClassName="h-14" className="mt-2 p-0" />
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
