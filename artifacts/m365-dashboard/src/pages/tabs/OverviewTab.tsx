import {
  useGetM365OverviewWithMetadata,
  useGetM365LicensesWithMetadata,
  useGetM365ServiceHealthWithMetadata,
} from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { ConnectionTestPanel } from "@/components/ConnectionTestPanel";
import { summarizeIssues, getCollectionIssues } from "@/lib/collectionStatus";
import {
  calculateLicenseStats,
  isVisibleBillableLicense,
  LICENSES_HIDDEN_SKUS_CHANGED_EVENT,
  readHiddenLicenseSkus,
} from "@/lib/licenseFilters";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { useEffect, useMemo, useState } from "react";
import { ErrorPanel, RefreshIndicator } from "@/components/ErrorPanel";
import { ExportBtn } from "@/components/ExportBtn";
import { TableSkeleton } from "@/components/TableSkeleton";
import { useChartTheme } from "@/lib/useChartTheme";

import { chartPalette as CHART_COLORS } from "@/lib/chartPalette";

export function OverviewTab() {
  const {
    data: overviewWithMetadata,
    isLoading: isOverviewLoading,
    isFetching: isOverviewFetching,
    isError: isOverviewError,
    error: overviewError,
    refetch: refetchOverview,
  } = useGetM365OverviewWithMetadata();
  const {
    data: licensesWithMetadata,
    isLoading: isLicensesLoading,
    isFetching: isLicensesFetching,
    isError: isLicensesError,
    error: licensesError,
    refetch: refetchLicenses,
  } = useGetM365LicensesWithMetadata();
  const {
    data: healthWithMetadata,
    isLoading: isHealthLoading,
    isFetching: isHealthFetching,
    isError: isHealthError,
    error: healthError,
    refetch: refetchHealth,
  } = useGetM365ServiceHealthWithMetadata();
  const [hiddenSkus, setHiddenSkus] = useState<Set<string>>(() => readHiddenLicenseSkus());

  const isAnyLoading = isOverviewLoading || isLicensesLoading || isHealthLoading;
  const isAnyFetching = isOverviewFetching || isLicensesFetching || isHealthFetching;
  const loading = isOverviewLoading || isLicensesLoading;

  const { gridColor, tickColor } = useChartTheme();

  const overview = overviewWithMetadata?.data;
  const licenses = licensesWithMetadata?.data;
  const health = healthWithMetadata?.data;
  const overviewIssue = summarizeIssues(getCollectionIssues(overview));
  const licenseIssue = summarizeIssues(getCollectionIssues(licenses));

  useEffect(() => {
    const refreshHiddenSkus = () => setHiddenSkus(readHiddenLicenseSkus());
    window.addEventListener("storage", refreshHiddenSkus);
    window.addEventListener("focus", refreshHiddenSkus);
    window.addEventListener(LICENSES_HIDDEN_SKUS_CHANGED_EVENT, refreshHiddenSkus);
    return () => {
      window.removeEventListener("storage", refreshHiddenSkus);
      window.removeEventListener("focus", refreshHiddenSkus);
      window.removeEventListener(LICENSES_HIDDEN_SKUS_CHANGED_EVENT, refreshHiddenSkus);
    };
  }, []);

  const visibleBillableLicenses = useMemo(
    () => (licenses?.licenses ?? []).filter((lic) => isVisibleBillableLicense(lic, hiddenSkus)),
    [licenses?.licenses, hiddenSkus],
  );
  const licenseData = visibleBillableLicenses.slice(0, 5);
  const licenseStatsFromRows = useMemo(
    () => calculateLicenseStats(visibleBillableLicenses),
    [visibleBillableLicenses],
  );
  const overviewLicenseUtilizationPercent = overview && overview.totalLicenses > 0
    ? Math.round((overview.assignedLicenses / overview.totalLicenses) * 100)
    : undefined;
  const licenseUtilizationPercent = visibleBillableLicenses.length > 0 && licenseStatsFromRows.totalLicenses > 0
    ? licenseStatsFromRows.utilizationPercent
    : licenses && !licenses.partialData
      ? undefined
      : overviewLicenseUtilizationPercent;
  const licenseUtilizationIssue = licenseUtilizationPercent == null ? licenseIssue : null;

  const metricToFieldMap: Record<string, { source: "overview" | "licenses" | "health"; field: string }> = {
    "overview.totalUsers": { source: "overview", field: "totalUsers" },
    "overview.activeUsers": { source: "overview", field: "activeUsers" },
    "overview.licenseUtilization": { source: "licenses", field: "utilizationPercent" },
    "overview.secureScore": { source: "overview", field: "secureScore" },
    "overview.mfaCoverage": { source: "overview", field: "mfaEnabledPercent" },
    "overview.servicesHealthy": { source: "overview", field: "activeServices" },
  };

  const getMetricMeta = (metricId: string) => {
    const mapping = metricToFieldMap[metricId];
    if (!mapping) return undefined;
    if (mapping.source === "overview") return overviewWithMetadata?.fieldMetadata?.[mapping.field];
    if (mapping.source === "licenses") return licensesWithMetadata?.fieldMetadata?.[mapping.field];
    return healthWithMetadata?.fieldMetadata?.[mapping.field];
  };

  if (isOverviewError) {
    return <ErrorPanel title="Couldn't load the tenant overview" error={overviewError} onRetry={() => refetchOverview()} />;
  }

  return (
    <div className="relative space-y-4">
      <RefreshIndicator active={isAnyFetching && !isAnyLoading} />
      <ConnectionTestPanel />
      <CollapsibleSection title="Summary" description="Key metrics across your Microsoft 365 tenant" storageKey="overview-summary" defaultOpen={true} density="compact" issue={overviewIssue}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <KPICard
          title="Total Users"
          value={overview?.totalUsers}
          loading={loading}
          density="compact"
          evidenceStatus={getMetricMeta("overview.totalUsers")?.evidenceStatus}
          confidenceLabel={getMetricMeta("overview.totalUsers")?.confidenceLabel}
        />
        <KPICard
          title="Active Users"
          value={overview?.activeUsers}
          loading={loading}
          density="compact"
          evidenceStatus={getMetricMeta("overview.activeUsers")?.evidenceStatus}
          confidenceLabel={getMetricMeta("overview.activeUsers")?.confidenceLabel}
        />
        <KPICard
          title="License Utilization"
          value={licenseUtilizationPercent == null ? undefined : `${licenseUtilizationPercent}%`}
          loading={loading}
          density="compact"
          evidenceStatus={getMetricMeta("overview.licenseUtilization")?.evidenceStatus}
          confidenceLabel={getMetricMeta("overview.licenseUtilization")?.confidenceLabel}
          issueKind={licenseUtilizationIssue?.kind}
          issueMessage={licenseUtilizationIssue?.message}
        />
        <KPICard
          title="Secure Score"
          value={overview ? `${overview.secureScore} / ${overview.secureScoreMax}` : undefined}
          loading={loading}
          density="compact"
          evidenceStatus={getMetricMeta("overview.secureScore")?.evidenceStatus}
          confidenceLabel={getMetricMeta("overview.secureScore")?.confidenceLabel}
        />
        <KPICard
          title="MFA Coverage"
          value={overview ? `${overview.mfaEnabledPercent}%` : undefined}
          loading={loading}
          density="compact"
          valueColor={overview && overview.mfaEnabledPercent < 80 ? CHART_COLORS.red : CHART_COLORS.green}
          evidenceStatus={getMetricMeta("overview.mfaCoverage")?.evidenceStatus}
          confidenceLabel={getMetricMeta("overview.mfaCoverage")?.confidenceLabel}
        />
        <KPICard
          title="Services Healthy"
          value={overview ? `${overview.activeServices} / ${overview.totalServices}` : undefined}
          loading={loading}
          density="compact"
          valueColor={overview && overview.activeServices < overview.totalServices ? CHART_COLORS.red : CHART_COLORS.green}
          evidenceStatus={getMetricMeta("overview.servicesHealthy")?.evidenceStatus}
          confidenceLabel={getMetricMeta("overview.servicesHealthy")?.confidenceLabel}
        />
      </div>
      </CollapsibleSection>

      <CollapsibleSection title="Licensing & Service Health" description="License allocation and M365 service status" storageKey="overview-licensing-health" defaultOpen={true} density="compact">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="px-3 pt-3 pb-1.5 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Top Licenses Utilization</CardTitle>
            {!isLicensesLoading && (
              <ExportBtn data={licenseData} filename="top-licenses.csv" ariaLabel="Export chart data as CSV" />
            )}
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            {isLicensesError ? (
              <ErrorPanel title="Couldn't load licenses" error={licensesError} onRetry={() => refetchLicenses()} />
            ) : isLicensesLoading ? <Skeleton className="w-full h-[240px]" /> : (
              <ResponsiveContainer width="100%" height={240} debounce={0}>
                <BarChart data={licenseData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="displayName" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} tickFormatter={(v) => v.length > 15 ? v.substring(0, 15) + "…" : v} />
                  <YAxis tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)', stroke: 'none' }} isAnimationActive={false} />
                  <Legend />
                  <Bar dataKey="assigned" name="Assigned" fill={CHART_COLORS.blue} fillOpacity={0.8} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="available" name="Available" fill={CHART_COLORS.purple} fillOpacity={0.8} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-3 pt-3 pb-1.5 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">M365 Service Health Status</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            {isHealthError ? (
              <ErrorPanel title="Couldn't load service health" error={healthError} onRetry={() => refetchHealth()} />
            ) : isHealthLoading ? (
              <TableSkeleton rows={6} rowClassName="h-10" className="mt-2 p-0" />
            ) : (
              <div className="grid grid-cols-1 gap-2 mt-2 max-h-[240px] overflow-y-auto pr-2">
                {health?.services.map(service => {
                  const isOperational = service.status === 'serviceOperational';
                  const isDegraded = service.status === 'serviceDegradation' || service.status === 'serviceInterruption';
                  const friendlyStatus = isOperational ? 'Operational' :
                    service.status === 'serviceDegradation' ? 'Degraded' :
                    service.status === 'serviceInterruption' ? 'Interrupted' :
                    service.status === 'investigating' ? 'Investigating' :
                    service.status === 'restoringService' ? 'Restoring' :
                    service.status === 'verifyingService' ? 'Verifying' :
                    service.status === 'serviceRestored' ? 'Restored' :
                    service.status ?? 'Unknown';
                  return (
                  <div key={service.service} className="p-2.5 border rounded-md flex justify-between items-center bg-card">
                    <span className="font-medium text-sm truncate mr-2" title={service.service}>{service.service}</span>
                    <Badge className={`font-normal shrink-0 ${
                      isOperational ? 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400' :
                      isDegraded ? 'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400' :
                      'bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400'
                    }`}>
                      {friendlyStatus}
                    </Badge>
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </CollapsibleSection>
    </div>
  );
}
