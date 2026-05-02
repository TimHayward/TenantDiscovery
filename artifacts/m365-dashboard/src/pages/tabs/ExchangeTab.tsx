import { useGetM365Exchange } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { CSVLink } from "react-csv";
import { Download } from "lucide-react";
import { useTheme } from "next-themes";
import { formatCompact } from "@/lib/utils";

const CHART_COLORS = {
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
};
const CHART_COLOR_LIST = [CHART_COLORS.blue, CHART_COLORS.purple, CHART_COLORS.green, CHART_COLORS.red, CHART_COLORS.pink];

export function ExchangeTab() {
  const { data, isLoading, isFetching } = useGetM365Exchange();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const loading = isLoading || isFetching;

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const emailActivityData = data ? [
    { name: "Sent", value: data.emailActivityLast30Days.sent },
    { name: "Received", value: data.emailActivityLast30Days.received },
    { name: "Read", value: data.emailActivityLast30Days.read },
  ] : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard title="Total Mailboxes" value={data?.totalMailboxes} loading={loading} />
        <KPICard title="Active" value={data?.activeMailboxes} loading={loading} />
        <KPICard title="Shared" value={data?.sharedMailboxes} loading={loading} />
        <KPICard title="Room" value={data?.roomMailboxes} loading={loading} />
        <KPICard title="Storage Used (GB)" value={data ? formatCompact(data.totalStorageUsedGB) : undefined} loading={loading} />
        <KPICard title="Storage %" value={data ? `${data.storageUtilizationPercent}%` : undefined} loading={loading} valueColor={data && data.storageUtilizationPercent > 85 ? CHART_COLORS.red : CHART_COLORS.blue} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Mailbox Size Distribution</CardTitle>
            {!loading && data?.mailboxSizeDistribution && data.mailboxSizeDistribution.length > 0 && (
              <CSVLink data={data.mailboxSizeDistribution} filename="mailbox-size-distribution.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[300px]" /> : (
              <ResponsiveContainer width="100%" height={300} debounce={0}>
                <BarChart data={data?.mailboxSizeDistribution || []} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="range" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <YAxis tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)', stroke: 'none' }} isAnimationActive={false} />
                  <Bar dataKey="count" name="Mailboxes" fill={CHART_COLORS.blue} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Email Activity (Last 30 Days)</CardTitle>
            {!loading && emailActivityData.length > 0 && (
              <CSVLink data={emailActivityData} filename="email-activity.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[300px]" /> : (
              <ResponsiveContainer width="100%" height={300} debounce={0}>
                <BarChart data={emailActivityData} margin={{ top: 20, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <YAxis tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} tickFormatter={(v) => formatCompact(v)} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)', stroke: 'none' }} isAnimationActive={false} />
                  <Bar dataKey="value" name="Count" fill={CHART_COLORS.purple} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]}>
                    {emailActivityData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLOR_LIST[index % CHART_COLOR_LIST.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-base">Threat Protection (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
               <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
               </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div className="p-6 border rounded-md flex flex-col items-center justify-center text-center bg-card">
                  <p className="text-sm text-muted-foreground font-medium mb-2">Spam Filtered</p>
                  <p className="text-3xl font-bold" style={{ color: CHART_COLORS.blue }}>{formatCompact(data?.spamFiltered || 0)}</p>
                </div>
                <div className="p-6 border rounded-md flex flex-col items-center justify-center text-center bg-card">
                  <p className="text-sm text-muted-foreground font-medium mb-2">Malware Detected</p>
                  <p className="text-3xl font-bold" style={{ color: CHART_COLORS.red }}>{formatCompact(data?.malwareDetected || 0)}</p>
                </div>
                <div className="p-6 border rounded-md flex flex-col items-center justify-center text-center bg-card">
                  <p className="text-sm text-muted-foreground font-medium mb-2">Quarantined</p>
                  <p className="text-3xl font-bold" style={{ color: CHART_COLORS.purple }}>{formatCompact(data?.quarantinedMessages || 0)}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
