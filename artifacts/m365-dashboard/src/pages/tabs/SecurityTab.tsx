import { useGetM365Security } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CSVLink } from "react-csv";
import { Download } from "lucide-react";
import { useTheme } from "next-themes";
import { formatDate } from "@/lib/utils";

const CHART_COLORS = {
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
};
const CHART_COLOR_LIST = [CHART_COLORS.blue, CHART_COLORS.purple, CHART_COLORS.green, CHART_COLORS.red, CHART_COLORS.pink];

export function SecurityTab() {
  const { data, isLoading, isFetching } = useGetM365Security();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const loading = isLoading || isFetching;

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const mfaDonutData = data ? [
    { name: "MFA Enabled", value: data.mfaEnabledUsers },
    { name: "MFA Disabled", value: data.mfaDisabledUsers },
  ] : [];

  const caPolicyData = data ? [
    { name: "Enabled", value: data.enabledCAPs },
    { name: "Disabled", value: data.disabledCAPs },
    { name: "Report-Only", value: data.reportOnlyCAPs },
  ] : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Secure Score" value={data ? `${data.secureScore} / ${data.secureScoreMax}` : undefined} loading={loading} />
        <KPICard title="Secure Score %" value={data ? `${data.secureScorePercent}%` : undefined} loading={loading} valueColor={data && data.secureScorePercent < 70 ? CHART_COLORS.red : CHART_COLORS.green} />
        <KPICard title="MFA Coverage" value={data ? `${data.mfaEnabledPercent}%` : undefined} loading={loading} />
        <KPICard title="CA Policies (Enabled)" value={data?.enabledCAPs} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Secure Score History</CardTitle>
            {!loading && data?.secureScoreHistory && data.secureScoreHistory.length > 0 && (
              <CSVLink data={data.secureScoreHistory} filename="secure-score-history.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[300px]" /> : (
              <ResponsiveContainer width="100%" height={300} debounce={0}>
                <AreaChart data={data?.secureScoreHistory || []}>
                  <defs>
                    <linearGradient id="gradientScore" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.blue} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={CHART_COLORS.blue} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} tickFormatter={(v) => formatDate(v, "MMM d")} />
                  <YAxis tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)', stroke: 'none' }} isAnimationActive={false} />
                  <Legend />
                  <Area type="monotone" dataKey="score" name="Score" fill="url(#gradientScore)" stroke={CHART_COLORS.blue} fillOpacity={1} strokeWidth={2} activeDot={{ r: 5, fill: CHART_COLORS.blue, stroke: '#ffffff', strokeWidth: 3 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Score by Control Category</CardTitle>
            {!loading && data?.controlCategories && data.controlCategories.length > 0 && (
              <CSVLink data={data.controlCategories} filename="score-by-category.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[300px]" /> : (
              <ResponsiveContainer width="100%" height={300} debounce={0}>
                <BarChart data={data?.controlCategories || []} margin={{ left: -20, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="category" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <YAxis tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)', stroke: 'none' }} isAnimationActive={false} />
                  <Legend />
                  <Bar dataKey="score" name="Current Score" fill={CHART_COLORS.blue} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="maxScore" name="Max Score" fill={CHART_COLORS.purple} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">MFA Status</CardTitle>
            {!loading && mfaDonutData.length > 0 && (
              <CSVLink data={mfaDonutData} filename="mfa-status.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[250px]" /> : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={250} debounce={0}>
                  <PieChart>
                    <Pie data={mfaDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} cornerRadius={2} paddingAngle={2} isAnimationActive={false} stroke="none">
                      <Cell fill={CHART_COLORS.green} />
                      <Cell fill={CHART_COLORS.red} />
                    </Pie>
                    <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)', stroke: 'none' }} isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4 mt-2">
                  {mfaDonutData.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: index === 0 ? CHART_COLORS.green : CHART_COLORS.red }} />
                      <span className="text-muted-foreground">{entry.name}</span>
                      <span className="font-medium">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Conditional Access Policies</CardTitle>
            {!loading && caPolicyData.length > 0 && (
              <CSVLink data={caPolicyData} filename="ca-policies.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[250px]" /> : (
              <ResponsiveContainer width="100%" height={250} debounce={0}>
                <BarChart data={caPolicyData} layout="vertical" margin={{ left: 30, right: 20, top: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke={gridColor} />
                  <XAxis type="number" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} width={80} />
                  <Tooltip isAnimationActive={false} cursor={false} />
                  <Bar dataKey="value" fill={CHART_COLORS.blue} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[0, 2, 2, 0]}>
                    {caPolicyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLOR_LIST[index % CHART_COLOR_LIST.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
