import { useMemo } from "react";
import { useGetM365AppsWithMetadata } from "@workspace/api-client-react";
import type { AppRegistration } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer,
} from "recharts";
import {
  AppRegistrationsSection, AppRegistrationsChecklist,
} from "@/components/EnterpriseAppsSection";
import { ErrorPanel, RefreshIndicator } from "@/components/ErrorPanel";
import { summarizeIssues, getCollectionIssues, type IssueKind } from "@/lib/collectionStatus";
import { useChartTheme } from "@/lib/useChartTheme";

import { chartPalette, kpiAccent } from "@/lib/chartPalette";

const EXPIRY_COLORS: Record<string, string> = {
  Expired: chartPalette.red,
  "≤ 30 days": kpiAccent,
  "31–90 days": chartPalette.yellow,
  "> 90 days": chartPalette.green,
  "No expiry": chartPalette.gray,
};

export function AppsTab() {
  const {
    data: appsWithMeta,
    isLoading: appsLoading,
    isFetching: appsFetching,
    isError: appsError,
    error: appsErrorDetail,
    refetch: refetchApps,
  } = useGetM365AppsWithMetadata();

  const appsData = appsWithMeta?.data;
  const appsMeta = appsWithMeta?.fieldMetadata ?? {};
  const appsLoadingAny = appsLoading;

  const appsIssue = summarizeIssues(getCollectionIssues(appsData));
  const appsIssueKind: IssueKind | undefined = appsIssue?.kind;

  const apps: AppRegistration[] = appsData?.apps ?? [];

  // ── Credential expiry timeline ───────────────────────────────────────────────
  const credentialExpiry = useMemo(() => {
    const now = Date.now();
    const d30 = now + 30 * 86400_000;
    const d90 = now + 90 * 86400_000;
    const buckets: Record<string, number> = {
      Expired: 0, "≤ 30 days": 0, "31–90 days": 0, "> 90 days": 0, "No expiry": 0,
    };
    for (const app of apps) {
      for (const cred of app.credentials ?? []) {
        if (!cred.endDateTime) { buckets["No expiry"] += 1; continue; }
        const end = new Date(cred.endDateTime).getTime();
        if (Number.isNaN(end)) { buckets["No expiry"] += 1; }
        else if (end < now) buckets["Expired"] += 1;
        else if (end < d30) buckets["≤ 30 days"] += 1;
        else if (end < d90) buckets["31–90 days"] += 1;
        else buckets["> 90 days"] += 1;
      }
    }
    return Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));
  }, [apps]);

  const { gridColor, tickColor, tooltipStyle } = useChartTheme();

  if (appsError) {
    return <ErrorPanel title="Couldn't load app registrations" error={appsErrorDetail} onRetry={() => refetchApps()} />;
  }

  return (
    <div className="relative space-y-4">
      <RefreshIndicator active={appsFetching && !appsLoading} />
      {/* Risk summary */}
      <CollapsibleSection
        title="Apps & Permissions Summary"
        description="App registration inventory, credential hygiene and permission risk at a glance"
        storageKey="apps-summary"
        sectionId="apps-summary"
        defaultOpen={true}
        density="compact"
        issue={appsIssue}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <KPICard title="App Registrations" value={appsData?.totalApps} loading={appsLoadingAny} density="compact" evidenceStatus={appsMeta.totalApps?.evidenceStatus} confidenceLabel={appsMeta.totalApps?.confidenceLabel} issueKind={appsIssueKind} issueMessage={appsIssue?.message} />
          <KPICard title="Ownerless Apps" value={appsData?.appsWithNoOwner} loading={appsLoadingAny} density="compact" valueColor={chartPalette.red} evidenceStatus={appsMeta.appsWithNoOwner?.evidenceStatus} confidenceLabel={appsMeta.appsWithNoOwner?.confidenceLabel} issueKind={appsIssueKind} issueMessage={appsIssue?.message} />
          <KPICard title="High-Risk Apps" value={appsData?.appsWithHighRisk} loading={appsLoadingAny} density="compact" valueColor={chartPalette.red} evidenceStatus={appsMeta.appsWithHighRisk?.evidenceStatus} confidenceLabel={appsMeta.appsWithHighRisk?.confidenceLabel} issueKind={appsIssueKind} issueMessage={appsIssue?.message} />
          <KPICard title="Expired Credentials" value={appsData?.appsWithExpiredCredentials} loading={appsLoadingAny} density="compact" valueColor={kpiAccent} evidenceStatus={appsMeta.appsWithExpiredCredentials?.evidenceStatus} confidenceLabel={appsMeta.appsWithExpiredCredentials?.confidenceLabel} issueKind={appsIssueKind} issueMessage={appsIssue?.message} />
          <KPICard title="Multi-Tenant Apps" value={appsData?.multiTenantApps} loading={appsLoadingAny} density="compact" evidenceStatus={appsMeta.multiTenantApps?.evidenceStatus} confidenceLabel={appsMeta.multiTenantApps?.confidenceLabel} issueKind={appsIssueKind} issueMessage={appsIssue?.message} />
        </div>
      </CollapsibleSection>

      {/* App registration inventory (reuses the existing component) */}
      <CollapsibleSection
        title="App Registration Inventory"
        description="Owners, credentials, permissions and per-app security assessment"
        storageKey="apps-inventory"
        sectionId="apps-inventory"
        defaultOpen={false}
        density="compact"
      >
        <AppRegistrationsSection />
      </CollapsibleSection>

      {/* Credential expiry timeline */}
      <CollapsibleSection
        title="Credential Expiry Timeline"
        description="Upcoming secret and certificate expiry across app registrations"
        storageKey="apps-credential-expiry"
        sectionId="apps-credential-expiry"
        defaultOpen={true}
        density="compact"
        issue={appsIssue}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={credentialExpiry} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="bucket" tick={{ fill: tickColor, fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fill: tickColor, fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" name="Credentials" radius={[4, 4, 0, 0]}>
              {credentialExpiry.map((entry) => (
                <Cell key={entry.bucket} fill={EXPIRY_COLORS[entry.bucket] ?? chartPalette.blue} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CollapsibleSection>

      {/* App governance checklist (reuses the existing component) */}
      <CollapsibleSection
        title="App Governance Check List"
        description="Consent, credential hygiene and registration controls"
        storageKey="apps-checklist"
        sectionId="apps-checklist"
        defaultOpen={false}
        density="compact"
      >
        <AppRegistrationsChecklist />
      </CollapsibleSection>
    </div>
  );
}
