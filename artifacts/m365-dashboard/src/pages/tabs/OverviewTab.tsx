import {
  useGetM365OverviewWithMetadata,
  useGetM365LicensesWithMetadata,
  useGetM365ServiceHealthWithMetadata,
} from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CSVLink } from "react-csv";
import { Download } from "lucide-react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";

const CHART_COLORS = {
  blue: "#1E3D59",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
};

export function OverviewTab() {
  const { data: overviewWithMetadata, isLoading: isOverviewLoading, isFetching: isOverviewFetching } = useGetM365OverviewWithMetadata();
  const { data: licensesWithMetadata, isLoading: isLicensesLoading, isFetching: isLicensesFetching } = useGetM365LicensesWithMetadata();
  const { data: healthWithMetadata, isLoading: isHealthLoading, isFetching: isHealthFetching } = useGetM365ServiceHealthWithMetadata();
  
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const loading = isOverviewLoading || isOverviewFetching || isLicensesLoading || isLicensesFetching || isHealthLoading || isHealthFetching;

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const overview = overviewWithMetadata?.data;
  const licenses = licensesWithMetadata?.data;
  const health = healthWithMetadata?.data;

  const licenseData = licenses?.licenses.slice(0, 5) || [];

  const metricToFieldMap: Record<string, { source: "overview" | "licenses" | "health"; field: string }> = {
    "overview.totalUsers": { source: "overview", field: "totalUsers" },
    "overview.activeUsers": { source: "overview", field: "activeUsers" },
    "overview.licenseUtilization": { source: "overview", field: "assignedLicenses" },
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

  return (
    <div className="space-y-4">
      <CollapsibleSection title="Summary" description="Key metrics across your Microsoft 365 tenant" storageKey="overview-summary" defaultOpen={true} density="compact">
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
          value={overview ? `${overview.totalLicenses > 0 ? Math.round((overview.assignedLicenses / overview.totalLicenses) * 100) : 0}%` : undefined}
          loading={loading}
          density="compact"
          evidenceStatus={getMetricMeta("overview.licenseUtilization")?.evidenceStatus}
          confidenceLabel={getMetricMeta("overview.licenseUtilization")?.confidenceLabel}
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
            {!loading && licenseData.length > 0 && (
              <CSVLink data={licenseData} filename="top-licenses.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            {loading ? <Skeleton className="w-full h-[240px]" /> : (
              <ResponsiveContainer width="100%" height={240} debounce={0}>
                <BarChart data={licenseData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="displayName" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} tickFormatter={(v) => v.length > 15 ? v.substring(0, 15) + "..." : v} />
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
            {loading ? (
              <div className="space-y-2 mt-2">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-h-[240px] overflow-y-auto pr-2">
                {health?.services.map(service => (
                  <div key={service.service} className="p-2.5 border rounded-md flex justify-between items-center bg-card">
                    <span className="font-medium text-sm truncate mr-2" title={service.service}>{service.service}</span>
                    <Badge className={`font-normal shrink-0 ${
                      service.status === 'Service operational' ? 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400' :
                      service.status.includes('advisory') ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400' :
                      'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {service.status === 'Service operational' ? 'Healthy' : service.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </CollapsibleSection>
    </div>
  );
}
