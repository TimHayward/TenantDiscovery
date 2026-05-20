import { useGetM365ExchangeWithMetadata, useGetM365DataSources } from "@workspace/api-client-react";
import { ChecklistTable, type ChecklistGroup } from "@/components/ChecklistTable";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { CSVLink } from "react-csv";
import { Download } from "lucide-react";
import { useTheme } from "next-themes";
import { formatCompact } from "@/lib/utils";
import type { ConfidenceLabel, EvidenceStatus } from "@workspace/permissions-manifest";

const CHART_COLORS = {
  blue: "#1E3D59",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
};
const CHART_COLOR_LIST = [CHART_COLORS.blue, CHART_COLORS.purple, CHART_COLORS.green, CHART_COLORS.red, CHART_COLORS.pink];

export function ExchangeTab() {
  const { data: exchangeWithMetadata, isLoading, isFetching } = useGetM365ExchangeWithMetadata();
  const { data: dataSources } = useGetM365DataSources({ tab: "exchange" });
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const loading = isLoading || isFetching;
  const data = exchangeWithMetadata?.data;
  const fieldMetadata = exchangeWithMetadata?.fieldMetadata ?? {};

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

  const metricToFieldMap: Record<string, string> = {
    "exchange.totalMailboxes": "totalMailboxes",
    "exchange.activeMailboxes": "activeMailboxes",
    "exchange.sharedMailboxes": "sharedMailboxes",
    "exchange.roomMailboxes": "roomMailboxes",
    "exchange.storageUsedGB": "totalStorageUsedGB",
    "exchange.storageUtilizationPercent": "storageUtilizationPercent",
  };

  const getMetricMetaWithFieldFallback = (metricId: string) => {
    const field = metricToFieldMap[metricId];
    if (field) {
      const meta = fieldMetadata[field];
      if (meta) return meta;
    }
    return getMetricMeta(metricId);
  };

  const exchangeChecklist: ChecklistGroup[] = [
    { id: "2.1", title: "2.1 SPF, DKIM and DMARC records are set up for every domain", items: [
      { label: "Ensure SPF records are published for all Exchange domains", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.1.spfDkim")?.evidenceStatus,
        confidenceLabel: getMetricMeta("exchange.checklist.2.1.spfDkim")?.confidenceLabel,
        metricId: "exchange.checklist.2.1.spfDkim",
      },
      { label: "Ensure DMARC records are published", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.1.dmarc")?.evidenceStatus,
        metricId: "exchange.checklist.2.1.dmarc",
      },
      { label: "Ensure DKIM is enabled for Exchange Online domains", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.1.dkim")?.evidenceStatus,
        metricId: "exchange.checklist.2.1.dkim",
      },
    ]},
    { id: "2.2", title: "2.2 Anti-spam policies are configured", items: [
      { label: "Inbound anti-spam protections are enabled", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.2.antiSpam")?.evidenceStatus,
        confidenceLabel: getMetricMeta("exchange.checklist.2.2.antiSpam")?.confidenceLabel,
        metricId: "exchange.checklist.2.2.antiSpam",
        sourceLabel: "Exchange Admin Center",
      },
    ]},
    { id: "2.3", title: "2.3 Anti-phishing policies are configured", items: [
      { label: "Anti-phishing policy exists and is active", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.3.antiPhishing")?.evidenceStatus,
        confidenceLabel: getMetricMeta("exchange.checklist.2.3.antiPhishing")?.confidenceLabel,
        metricId: "exchange.checklist.2.3.antiPhishing",
      },
    ]},
    { id: "2.4", title: "2.4 Anti-malware policies are configured", items: [
      { label: "Zero-hour auto purge (ZAP) enabled", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.4.antiMalware")?.evidenceStatus,
        metricId: "exchange.checklist.2.4.zap",
      },
      { label: "Common Attachment Type Filter enabled", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.4.attachmentFilter")?.evidenceStatus,
        metricId: "exchange.checklist.2.4.attachmentFilter",
      },
    ]},
    { id: "2.5", title: "2.5 Automatic forwarding to external domains SHALL be disabled", items: [
      { label: "Automatic forwarding to external domains is blocked", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.5.autoForwarding")?.evidenceStatus,
        metricId: "exchange.checklist.2.5.autoForwarding",
        sourceLabel: "Transport Rules",
      },
    ]},
    { id: "2.6", title: "2.6 Mailbox Auditing SHALL be Enabled", items: [
      { label: "Mailbox logging is enabled", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.6.mailboxAuditing")?.evidenceStatus,
        metricId: "exchange.checklist.2.6.mailboxAuditing",
      },
    ]},
    { id: "2.7", title: "2.7 Calendar and Contact Sharing Shall Be Restricted", items: [
      { label: "External sharing of calendars is restricted", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.7.calendarSharing")?.evidenceStatus,
        metricId: "exchange.checklist.2.7.calendarSharing",
      },
    ]},
    { id: "2.8", title: "2.8 External Sender Warnings are implemented", items: [
      { label: "Email from external senders is visually identified", status: "manual",
        evidenceStatus: getMetricMeta("exchange.checklist.2.8.externalSenderWarnings")?.evidenceStatus,
        metricId: "exchange.checklist.2.8.externalSenderWarnings",
      },
    ]},
  ];

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const emailActivityData = data ? [
    { name: "Sent", value: data.emailActivityLast30Days.sent },
    { name: "Received", value: data.emailActivityLast30Days.received },
    { name: "Read", value: data.emailActivityLast30Days.read },
  ] : [];

  return (
    <div className="space-y-4">
      <CollapsibleSection title="Summary" description="Mailbox counts and storage overview" storageKey="exchange-summary" defaultOpen={true} density="compact">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPICard
          title="Total Mailboxes"
          value={data?.totalMailboxes}
          loading={loading}
          density="compact"
          evidenceStatus={getMetricMetaWithFieldFallback("exchange.totalMailboxes")?.evidenceStatus}
          confidenceLabel={getMetricMetaWithFieldFallback("exchange.totalMailboxes")?.confidenceLabel}
        />
        <KPICard
          title="Active"
          value={data?.activeMailboxes}
          loading={loading}
          density="compact"
          evidenceStatus={getMetricMetaWithFieldFallback("exchange.activeMailboxes")?.evidenceStatus}
          confidenceLabel={getMetricMetaWithFieldFallback("exchange.activeMailboxes")?.confidenceLabel}
        />
        <KPICard
          title="Shared"
          value={data?.sharedMailboxes}
          loading={loading}
          density="compact"
          evidenceStatus={getMetricMetaWithFieldFallback("exchange.sharedMailboxes")?.evidenceStatus}
          confidenceLabel={getMetricMetaWithFieldFallback("exchange.sharedMailboxes")?.confidenceLabel}
        />
        <KPICard
          title="Room"
          value={data?.roomMailboxes}
          loading={loading}
          density="compact"
          evidenceStatus={getMetricMetaWithFieldFallback("exchange.roomMailboxes")?.evidenceStatus}
          confidenceLabel={getMetricMetaWithFieldFallback("exchange.roomMailboxes")?.confidenceLabel}
        />
        <KPICard
          title="Storage Used (GB)"
          value={data ? formatCompact(data.totalStorageUsedGB) : undefined}
          loading={loading}
          density="compact"
          evidenceStatus={getMetricMetaWithFieldFallback("exchange.storageUsedGB")?.evidenceStatus}
          confidenceLabel={getMetricMetaWithFieldFallback("exchange.storageUsedGB")?.confidenceLabel}
        />
        <KPICard
          title="Storage %"
          value={data ? `${data.storageUtilizationPercent}%` : undefined}
          loading={loading}
          density="compact"
          valueColor={data && data.storageUtilizationPercent > 85 ? CHART_COLORS.red : CHART_COLORS.blue}
          evidenceStatus={getMetricMetaWithFieldFallback("exchange.storageUtilizationPercent")?.evidenceStatus}
          confidenceLabel={getMetricMetaWithFieldFallback("exchange.storageUtilizationPercent")?.confidenceLabel}
        />
      </div>
      </CollapsibleSection>

      <CollapsibleSection title="Mail Flow Analysis" description="Mailbox size distribution, email activity, and threat protection" storageKey="exchange-mail-flow" defaultOpen={true} density="compact">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="px-3 pt-3 pb-1.5 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Mailbox Size Distribution</CardTitle>
            {!loading && data?.mailboxSizeDistribution && data.mailboxSizeDistribution.length > 0 && (
              <CSVLink data={data.mailboxSizeDistribution} filename="mailbox-size-distribution.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            {loading ? <Skeleton className="w-full h-[240px]" /> : (
              <ResponsiveContainer width="100%" height={240} debounce={0}>
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
          <CardHeader className="px-3 pt-3 pb-1.5 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Email Activity (Last 30 Days)</CardTitle>
            {!loading && emailActivityData.length > 0 && (
              <CSVLink data={emailActivityData} filename="email-activity.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            {loading ? <Skeleton className="w-full h-[240px]" /> : (
              <ResponsiveContainer width="100%" height={240} debounce={0}>
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
          <CardHeader className="px-3 pt-3 pb-1.5">
            <CardTitle className="text-base">Threat Protection (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
            {loading ? (
               <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
               </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                <div className="p-4 border rounded-md flex flex-col items-center justify-center text-center bg-card">
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">Spam Filtered</p>
                  <p className="text-2xl font-bold" style={{ color: CHART_COLORS.blue }}>{formatCompact(data?.spamFiltered || 0)}</p>
                </div>
                <div className="p-4 border rounded-md flex flex-col items-center justify-center text-center bg-card">
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">Malware Detected</p>
                  <p className="text-2xl font-bold" style={{ color: CHART_COLORS.red }}>{formatCompact(data?.malwareDetected || 0)}</p>
                </div>
                <div className="p-4 border rounded-md flex flex-col items-center justify-center text-center bg-card">
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">Quarantined</p>
                  <p className="text-2xl font-bold" style={{ color: CHART_COLORS.purple }}>{formatCompact(data?.quarantinedMessages || 0)}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      </CollapsibleSection>

      <CollapsibleSection title="Summary Check List" description="Exchange Online security controls assessment" storageKey="exchange-checklist" defaultOpen={false} density="compact">
        <ChecklistTable sectionTitle="" groups={exchangeChecklist} loading={loading} density="compact" />
      </CollapsibleSection>

    </div>
  );
}
