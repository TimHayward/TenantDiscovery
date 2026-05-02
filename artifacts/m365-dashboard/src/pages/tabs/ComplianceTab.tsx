import { useGetM365Compliance, useGetM365ServiceHealth } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, Info } from "lucide-react";

const CHART_COLORS = {
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
  yellow: "#eab308",
  gray: "#9ca3af"
};

export function ComplianceTab() {
  const { data: compliance, isLoading: isComplianceLoading, isFetching: isComplianceFetching } = useGetM365Compliance();
  const { data: health, isLoading: isHealthLoading, isFetching: isHealthFetching } = useGetM365ServiceHealth();
  
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const compLoading = isComplianceLoading || isComplianceFetching;
  const healthLoading = isHealthLoading || isHealthFetching;

  // Gauge chart data for Compliance Score
  const scoreValue = compliance?.complianceScore || 0;
  const scoreMax = compliance?.complianceScoreMax || 100;
  const scorePercent = scoreMax > 0 ? (scoreValue / scoreMax) * 100 : 0;
  
  const gaugeData = [
    { name: "Score", value: scoreValue },
    { name: "Remaining", value: scoreMax - scoreValue }
  ];

  return (
    <div className="space-y-8">
      {/* COMPLIANCE SECTION */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Compliance</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title="DLP Policies" value={compliance?.dlpPolicies} loading={compLoading} />
          <KPICard title="Active DLP" value={compliance?.activeDlpPolicies} loading={compLoading} />
          <KPICard title="Retention Policies" value={compliance?.retentionPolicies} loading={compLoading} />
          <KPICard title="Sensitivity Labels" value={compliance?.sensitivityLabels} loading={compLoading} />
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
                    <span className="text-xs text-muted-foreground">{scoreValue} / {scoreMax}</span>
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

      {/* SERVICE HEALTH SECTION */}
      <div className="space-y-4 pt-4">
        <h2 className="text-xl font-semibold border-b pb-2">Service Health Full Report</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KPICard title="Total Services" value={health?.totalServices} loading={healthLoading} />
          <KPICard title="Active Incidents" value={health?.activeIncidents} loading={healthLoading} valueColor={health && health.activeIncidents > 0 ? CHART_COLORS.red : CHART_COLORS.green} />
          <KPICard title="Active Advisories" value={health?.activeAdvisories} loading={healthLoading} valueColor={health && health.activeAdvisories > 0 ? CHART_COLORS.yellow : CHART_COLORS.green} />
        </div>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-base">All Services Status</CardTitle>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <div className="space-y-2 mt-4">
                {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                {health?.services.map(service => {
                  const isHealthy = service.status === 'Service operational';
                  const isAdvisory = service.status.toLowerCase().includes('advisory');
                  
                  return (
                    <div key={service.service} className="p-3 border rounded-md flex items-center bg-card">
                      <div className="mr-3">
                        {isHealthy ? <CheckCircle className="w-5 h-5 text-green-500" /> : 
                         isAdvisory ? <Info className="w-5 h-5 text-yellow-500" /> : 
                         <AlertTriangle className="w-5 h-5 text-red-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{service.service}</p>
                        <p className="text-xs text-muted-foreground truncate">{service.status}</p>
                      </div>
                      {service.hasActiveIssues && (
                         <Badge variant="outline" className="ml-2 bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900">
                           {service.activeIncidents > 0 ? `${service.activeIncidents} Incidents` : 'Issue'}
                         </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
