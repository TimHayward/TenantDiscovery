import {
  useGetM365TeamsWithMetadata,
  useGetM365SharePointWithMetadata,
  useGetM365DataSources,
  useGetM365SharePointPoliciesWithMetadata,
  useGetM365SharePointSharingSummary,
} from "@workspace/api-client-react";
import { ChecklistTable, type ChecklistGroup } from "@/components/ChecklistTable";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { ExportBtn } from "@/components/ExportBtn";
import { DataTable } from "@/components/DataTable";
import { ErrorPanel, RefreshIndicator } from "@/components/ErrorPanel";
import { TableSkeleton } from "@/components/TableSkeleton";
import { getCollectionIssues, summarizeIssues } from "@/lib/collectionStatus";
import { useChartTheme } from "@/lib/useChartTheme";
import { formatCompact, formatDate, formatNumber } from "@/lib/utils";
import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { SharePointSiteItem, TeamsTeamActivityItem } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import type { ConfidenceLabel, EvidenceStatus } from "@workspace/permissions-manifest";

import { chartPalette as CHART_COLORS } from "@/lib/chartPalette";

const topTeamsColumns: ColumnDef<TeamsTeamActivityItem>[] = [
  {
    accessorKey: "teamName",
    header: "Team Name",
    cell: ({ row }) => <span className="font-medium">{row.original.teamName}</span>,
  },
  {
    accessorKey: "messages",
    header: "Messages",
    cell: ({ row }) => <span>{formatNumber(row.original.messages)}</span>,
  },
  {
    accessorKey: "activeUsers",
    header: "Active Users",
    cell: ({ row }) => <span>{formatNumber(row.original.activeUsers)}</span>,
  },
  {
    accessorKey: "activeChannels",
    header: "Active Channels",
    cell: ({ row }) => <span>{formatNumber(row.original.activeChannels)}</span>,
  },
  {
    accessorKey: "meetingsOrganized",
    header: "Meetings",
    cell: ({ row }) => <span>{formatNumber(row.original.meetingsOrganized)}</span>,
  },
  {
    accessorKey: "reactions",
    header: "Reactions",
    cell: ({ row }) => <span>{formatNumber(row.original.reactions)}</span>,
  },
  {
    accessorKey: "lastActivityDate",
    header: "Last Activity",
    cell: ({ row }) => <span>{formatDate(row.original.lastActivityDate)}</span>,
  },
];

const spColumns: ColumnDef<SharePointSiteItem>[] = [
  {
    accessorKey: "name",
    header: "Site Name",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "url",
    header: "URL",
    cell: ({ row }) => <a href={row.original.url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline truncate max-w-[200px] block" title={row.original.url}>{row.original.url}</a>,
  },
  {
    accessorKey: "storageUsedGB",
    header: "Storage (GB)",
    cell: ({ row }) => <span>{row.original.storageUsedGB.toFixed(2)}</span>,
  },
  {
    accessorKey: "filesCount",
    header: "Files",
    cell: ({ row }) => <span>{formatNumber(row.original.filesCount)}</span>,
  },
  {
    accessorKey: "pageViews",
    header: "Page Views",
    cell: ({ row }) => <span>{formatNumber(row.original.pageViews)}</span>,
  },
  {
    accessorKey: "lastActivityDate",
    header: "Last Activity",
    cell: ({ row }) => <span>{formatDate(row.original.lastActivityDate)}</span>,
  },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) => (
      row.original.isActive ? 
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal">Active</Badge> : 
        <Badge variant="outline" className="text-muted-foreground font-normal">Inactive</Badge>
    ),
  },
  {
    accessorKey: "assignedTeamName",
    header: "Assigned to Team",
    cell: ({ row }) => row.original.assignedTeamName
      ? <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-normal">{row.original.assignedTeamName}</Badge>
      : <span className="text-muted-foreground">—</span>,
  },
];

export function TeamsSharePointTab() {
  const {
    data: teamsWithMetadata,
    isLoading: isTeamsLoading,
    isFetching: isTeamsFetching,
    isError: isTeamsError,
    error: teamsError,
    refetch: refetchTeams,
  } = useGetM365TeamsWithMetadata();
  const {
    data: spWithMetadata,
    isLoading: isSpLoading,
    isFetching: isSpFetching,
    isError: isSpError,
    error: spError,
    refetch: refetchSp,
  } = useGetM365SharePointWithMetadata();
  const { data: dataSources } = useGetM365DataSources({ tab: "teams-sharepoint" });
  const {
    data: sharePointPoliciesWithMetadata,
    isLoading: isSharePointPoliciesLoading,
    isFetching: isSharePointPoliciesFetching,
  } = useGetM365SharePointPoliciesWithMetadata();

  const {
    data: sharingSummaryData,
    isLoading: isSharingSummaryLoading,
    isFetching: isSharingSummaryFetching,
  } = useGetM365SharePointSharingSummary();

  const teamsLoading = isTeamsLoading;
  const spLoading = isSpLoading;
  const spPoliciesLoading = isSharePointPoliciesLoading;
  const sharingSummaryLoading = isSharingSummaryLoading;
  const anyFetching = isTeamsFetching || isSpFetching || isSharePointPoliciesFetching || isSharingSummaryFetching;
  const anyLoading = isTeamsLoading || isSpLoading || isSharePointPoliciesLoading || isSharingSummaryLoading;
  const teamsData = teamsWithMetadata?.data;
  const spData = spWithMetadata?.data;
  const sharePointPolicies = sharePointPoliciesWithMetadata?.data;
  const sharingData = sharingSummaryData?.data;
  const teamsIssue = summarizeIssues(getCollectionIssues(teamsData));
  const spIssue = summarizeIssues(getCollectionIssues(spData));

  const teamsBySizeBreakdown = useMemo(() => (teamsData?.teamsBySize ?? []).map((item) => {
    const breakdown = item as typeof item & {
      totalTeamSize?: number;
      owners?: number;
      members?: number;
      guests?: number;
    };

    return {
      range: item.range,
      totalTeamSize: breakdown.totalTeamSize ?? 0,
      owners: breakdown.owners ?? 0,
      members: breakdown.members ?? 0,
      guests: breakdown.guests ?? 0,
      count: item.count,
    };
  }), [teamsData]);

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

  const teamsMetricToFieldMap: Record<string, string> = {
    "teams.totalTeams": "totalTeams",
    "teams.activeTeams": "activeTeams",
    "teams.privateTeams": "privateTeams",
    "teams.publicTeams": "publicTeams",
    "teams.archivedTeams": "archivedTeams",
    "teams-sharepoint.checklist.3.1.externalAccess": "externalAccessEnabled",
    "teams-sharepoint.checklist.5.1.guestSharing": "guestAccessEnabled",
  };

  const sharePointMetricToFieldMap: Record<string, string> = {
    "sharepoint.totalSites": "totalSites",
    "sharepoint.activeSites": "activeSites",
    "sharepoint.totalStorageUsedGB": "totalStorageUsedGB",
    "sharepoint.totalFiles": "totalFiles",
  };

  const getMetricMetaWithFieldFallback = (metricId: string) => {
    const field = teamsMetricToFieldMap[metricId];
    if (field) {
      const meta = teamsWithMetadata?.fieldMetadata?.[field];
      if (meta) return meta;
    }
    return getMetricMeta(metricId);
  };

  const getSharePointMetricMetaWithFieldFallback = (metricId: string) => {
    const field = sharePointMetricToFieldMap[metricId];
    if (field) {
      const meta = spWithMetadata?.fieldMetadata?.[field];
      if (meta) return meta;
    }
    return getMetricMeta(metricId);
  };

  const externalAccessEnabled = teamsData?.externalAccessEnabled ?? null;
  const guestAccessEnabled = teamsData?.guestAccessEnabled ?? null;

  const sharingCapability = sharePointPolicies?.sharingCapability ?? null;
  const oneDriveSharingCapability = sharePointPolicies?.oneDriveSharingCapability ?? null;
  const sharingDomainRestrictionMode = sharePointPolicies?.sharingDomainRestrictionMode ?? null;
  const sharingAllowedDomainCount = sharePointPolicies?.sharingAllowedDomainCount ?? 0;
  const sharingBlockedDomainCount = sharePointPolicies?.sharingBlockedDomainCount ?? 0;
  const defaultSharingLinkType = sharePointPolicies?.defaultSharingLinkType ?? null;
  const defaultLinkPermission = sharePointPolicies?.defaultLinkPermission ?? null;
  const anyoneLinkExpirationInDays = sharePointPolicies?.anyoneLinkExpirationInDays ?? null;

  const isRestrictedSharingCapability = (value: string | null) =>
    value === "disabled" || value === "existingExternalUserSharingOnly";
  const isModerateSharingCapability = (value: string | null) =>
    value === "externalUserSharingOnly";
  const isRestrictedLinkType = (value: string | null) =>
    value === "direct" || value === "internal";

  const sharingCapabilityStatus: "pass" | "warning" | "fail" | "manual" =
    sharingCapability === null
      ? "manual"
      : isRestrictedSharingCapability(sharingCapability)
      ? "pass"
      : isModerateSharingCapability(sharingCapability)
      ? "warning"
      : "fail";

  const oneDriveSharingCapabilityStatus: "pass" | "warning" | "fail" | "manual" =
    oneDriveSharingCapability === null
      ? "manual"
      : isRestrictedSharingCapability(oneDriveSharingCapability)
      ? "pass"
      : isModerateSharingCapability(oneDriveSharingCapability)
      ? "warning"
      : "fail";

  const domainRestrictionStatus: "pass" | "fail" | "manual" =
    sharingDomainRestrictionMode === null
      ? "manual"
      : sharingDomainRestrictionMode === "allowList" || sharingDomainRestrictionMode === "blockList"
      ? "pass"
      : "fail";

  const linkTypeStatus: "pass" | "fail" | "manual" =
    defaultSharingLinkType === null
      ? "manual"
      : isRestrictedLinkType(defaultSharingLinkType)
      ? "pass"
      : "fail";

  const anyoneLinkExpiryStatus: "pass" | "fail" | "manual" =
    anyoneLinkExpirationInDays === null
      ? "manual"
      : anyoneLinkExpirationInDays > 0
      ? "pass"
      : "fail";

  const sharePointPoliciesChecklist: ChecklistGroup[] = [
    {
      id: "sp.1",
      title: "SP.1 External Sharing Policy",
      items: [
        {
          label: "SharePoint external sharing capability",
          status: sharingCapabilityStatus,
          detail: sharingCapability ?? "Manual Check Required",
          evidenceStatus: sharePointPoliciesWithMetadata?.fieldMetadata?.sharingCapability?.evidenceStatus,
          confidenceLabel: sharePointPoliciesWithMetadata?.fieldMetadata?.sharingCapability?.confidenceLabel,
          sourceLabel: "Graph /admin/sharepoint/settings",
        },
        {
          label: "OneDrive external sharing capability",
          status: oneDriveSharingCapabilityStatus,
          detail: oneDriveSharingCapability ?? "Manual Check Required",
          evidenceStatus: sharePointPoliciesWithMetadata?.fieldMetadata?.oneDriveSharingCapability?.evidenceStatus,
          confidenceLabel: sharePointPoliciesWithMetadata?.fieldMetadata?.oneDriveSharingCapability?.confidenceLabel,
          sourceLabel: "Graph /admin/sharepoint/settings",
        },
        {
          label: "Domain restriction mode",
          status: domainRestrictionStatus,
          detail:
            sharingDomainRestrictionMode === null
              ? "Manual Check Required"
              : `${sharingDomainRestrictionMode} (allow: ${sharingAllowedDomainCount}, block: ${sharingBlockedDomainCount})`,
          evidenceStatus: sharePointPoliciesWithMetadata?.fieldMetadata?.sharingDomainRestrictionMode?.evidenceStatus,
          confidenceLabel: sharePointPoliciesWithMetadata?.fieldMetadata?.sharingDomainRestrictionMode?.confidenceLabel,
          sourceLabel: "Graph /admin/sharepoint/settings",
        },
      ],
    },
    {
      id: "sp.2",
      title: "SP.2 Link Defaults",
      items: [
        {
          label: "Default sharing link type",
          status: linkTypeStatus,
          detail: defaultSharingLinkType ?? "Manual Check Required",
          evidenceStatus: sharePointPoliciesWithMetadata?.fieldMetadata?.defaultSharingLinkType?.evidenceStatus,
          confidenceLabel: sharePointPoliciesWithMetadata?.fieldMetadata?.defaultSharingLinkType?.confidenceLabel,
          sourceLabel: "Graph /admin/sharepoint/settings",
        },
        {
          label: "Default link permission",
          status: defaultLinkPermission === null ? "manual" : defaultLinkPermission === "view" ? "pass" : "warning",
          detail: defaultLinkPermission ?? "Manual Check Required",
          evidenceStatus: sharePointPoliciesWithMetadata?.fieldMetadata?.defaultLinkPermission?.evidenceStatus,
          confidenceLabel: sharePointPoliciesWithMetadata?.fieldMetadata?.defaultLinkPermission?.confidenceLabel,
          sourceLabel: "Graph /admin/sharepoint/settings",
        },
        {
          label: "Anyone link expiration",
          status: anyoneLinkExpiryStatus,
          detail:
            anyoneLinkExpirationInDays === null
              ? "Manual Check Required"
              : anyoneLinkExpirationInDays > 0
              ? `${anyoneLinkExpirationInDays} days`
              : "Not set",
          evidenceStatus: sharePointPoliciesWithMetadata?.fieldMetadata?.anyoneLinkExpirationInDays?.evidenceStatus,
          confidenceLabel: sharePointPoliciesWithMetadata?.fieldMetadata?.anyoneLinkExpirationInDays?.confidenceLabel,
          sourceLabel: "Graph /admin/sharepoint/settings",
        },
      ],
    },
  ];

  const teamsChecklist: ChecklistGroup[] = [
    { id: "3.1", title: "3.1 External User Access SHALL Be Restricted", items: [
      { label: "External domains restricted in Teams admin centre", status: externalAccessEnabled === null ? "manual" : externalAccessEnabled ? "fail" : "pass", detail: externalAccessEnabled === null ? "Manual Check Required" : externalAccessEnabled ? "Not Restricted" : "Restricted",
        evidenceStatus: getMetricMetaWithFieldFallback("teams-sharepoint.checklist.3.1.externalAccess")?.evidenceStatus,
        confidenceLabel: getMetricMetaWithFieldFallback("teams-sharepoint.checklist.3.1.externalAccess")?.confidenceLabel,
        metricId: "teams-sharepoint.checklist.3.1.externalAccess",
        sourceLabel: "Teams Settings",
      },
    ]},
    { id: "3.2", title: "3.2 External Participants SHOULD NOT be Enabled to Request Control of Shared Desktops", items: [
      { label: "External participants cannot request desktop control", status: "manual",
        evidenceStatus: getMetricMeta("teams-sharepoint.checklist.3.2.desktopControl")?.evidenceStatus,
        metricId: "teams-sharepoint.checklist.3.2.desktopControl",
      },
    ]},
    { id: "3.3", title: "3.3 Anonymous Users SHALL NOT be Enabled to Start Meetings", items: [
      { label: "Anonymous users cannot start meetings", status: "manual",
        evidenceStatus: getMetricMeta("teams-sharepoint.checklist.3.3.anonMeetingStart")?.evidenceStatus,
        metricId: "teams-sharepoint.checklist.3.3.anonMeetingStart",
      },
    ]},
    { id: "3.4", title: "3.4 Automatic Admittance to Meeting SHOULD Be Restricted", items: [
      { label: "Only internal users bypass lobby (external users wait)", status: "manual",
        evidenceStatus: getMetricMeta("teams-sharepoint.checklist.3.4.lobbyRestriction")?.evidenceStatus,
        metricId: "teams-sharepoint.checklist.3.4.lobbyRestriction",
      },
    ]},
    { id: "3.5", title: "3.5 Unmanaged users SHALL NOT be enabled to initiate contact with internal users", items: [
      { label: "Unmanaged users cannot initiate contact with internal users", status: "manual",
        evidenceStatus: getMetricMeta("teams-sharepoint.checklist.3.5.unmanagedContact")?.evidenceStatus,
        metricId: "teams-sharepoint.checklist.3.5.unmanagedContact",
      },
    ]},
    { id: "3.6", title: "3.6 Contact with Skype Users SHALL be Blocked", items: [
      { label: "Communication with Skype (consumer) users is blocked", status: "manual",
        evidenceStatus: getMetricMeta("teams-sharepoint.checklist.3.6.skypeBlock")?.evidenceStatus,
        metricId: "teams-sharepoint.checklist.3.6.skypeBlock",
      },
    ]},
    { id: "3.7", title: "3.7 File Sharing and File Storage Options shall be blocked", items: [
      { label: "Third-party file sharing restricted in Teams", status: "manual",
        evidenceStatus: getMetricMeta("teams-sharepoint.checklist.3.7.fileSharing")?.evidenceStatus,
        metricId: "teams-sharepoint.checklist.3.7.fileSharing",
      },
    ]},
    { id: "5.1", title: "5.1 Default sharing settings are set for New and Existing Guest", items: [
      { label: "External sharing managed via whitelist/blacklist", status: domainRestrictionStatus,
        detail:
          sharingDomainRestrictionMode === null
            ? "Manual Check Required"
            : `${sharingDomainRestrictionMode} (allow: ${sharingAllowedDomainCount}, block: ${sharingBlockedDomainCount})`,
        evidenceStatus: getMetricMetaWithFieldFallback("teams-sharepoint.checklist.5.1.guestSharing")?.evidenceStatus,
        confidenceLabel: getMetricMetaWithFieldFallback("teams-sharepoint.checklist.5.1.guestSharing")?.confidenceLabel,
        metricId: "teams-sharepoint.checklist.5.1.guestSharing",
        sourceLabel: "SharePoint Admin Center",
      },
      { label: "Link sharing restricted to specific people or organisation", status: linkTypeStatus,
        detail: defaultSharingLinkType ?? "Manual Check Required",
        evidenceStatus: getMetricMeta("teams-sharepoint.checklist.5.1.linkSharing")?.evidenceStatus,
        metricId: "teams-sharepoint.checklist.5.1.linkSharing",
      },
    ]},
    { id: "5.2", title: "5.2 Expiration Dates are set for Anyone links", items: [
      { label: "Expiration date is set for anonymous sharing links", status: anyoneLinkExpiryStatus,
        detail:
          anyoneLinkExpirationInDays === null
            ? "Manual Check Required"
            : anyoneLinkExpirationInDays > 0
            ? `${anyoneLinkExpirationInDays} days`
            : "Not set",
        evidenceStatus: getMetricMeta("teams-sharepoint.checklist.5.2.anonLinkExpiration")?.evidenceStatus,
        confidenceLabel: getMetricMeta("teams-sharepoint.checklist.5.2.anonLinkExpiration")?.confidenceLabel,
        metricId: "teams-sharepoint.checklist.5.2.anonLinkExpiration",
      },
    ]},
  ];

  const { gridColor, tickColor } = useChartTheme();

  const [topTeamsGlobalFilter, setTopTeamsGlobalFilter] = useState("");
  const [spGlobalFilter, setSpGlobalFilter] = useState("");
  const [spActiveFilter, setSpActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [spTeamFilter, setSpTeamFilter] = useState<"all" | "assigned" | "unassigned">("all");

  const filteredSites = useMemo(() => {
    let sites = spData?.sites ?? [];
    if (spActiveFilter === "active")   sites = sites.filter(s => s.isActive);
    if (spActiveFilter === "inactive") sites = sites.filter(s => !s.isActive);
    if (spTeamFilter === "assigned")   sites = sites.filter(s => !!s.assignedTeamName);
    if (spTeamFilter === "unassigned") sites = sites.filter(s => !s.assignedTeamName);
    return sites;
  }, [spData?.sites, spActiveFilter, spTeamFilter]);

  return (
    <div className="relative space-y-4">
      <RefreshIndicator active={anyFetching && !anyLoading} />
      <CollapsibleSection title="Microsoft Teams" description="Teams usage, activity, and top teams overview" storageKey="teams-ms-teams" defaultOpen={true} density="compact" issue={teamsIssue}>
        {isTeamsError ? (
          <ErrorPanel title="Couldn't load Teams data" error={teamsError} onRetry={() => refetchTeams()} />
        ) : (
        <>
        <div className="space-y-4">
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard
            title="Total Teams"
            value={teamsData?.totalTeams}
            loading={teamsLoading}
            evidenceStatus={getMetricMetaWithFieldFallback("teams.totalTeams")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("teams.totalTeams")?.confidenceLabel}
          />
          <KPICard
            title="Active Teams"
            value={teamsData?.activeTeams}
            loading={teamsLoading}
            evidenceStatus={getMetricMetaWithFieldFallback("teams.activeTeams")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("teams.activeTeams")?.confidenceLabel}
          />
          <KPICard
            title="Private Teams"
            value={teamsData?.privateTeams}
            loading={teamsLoading}
            evidenceStatus={getMetricMetaWithFieldFallback("teams.privateTeams")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("teams.privateTeams")?.confidenceLabel}
          />
          <KPICard
            title="Public Teams"
            value={teamsData?.publicTeams}
            loading={teamsLoading}
            evidenceStatus={getMetricMetaWithFieldFallback("teams.publicTeams")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("teams.publicTeams")?.confidenceLabel}
          />
          <KPICard
            title="Archived Teams"
            value={teamsData?.archivedTeams}
            loading={teamsLoading}
            evidenceStatus={getMetricMetaWithFieldFallback("teams.archivedTeams")?.evidenceStatus}
            confidenceLabel={getMetricMetaWithFieldFallback("teams.archivedTeams")?.confidenceLabel}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Teams by Size</CardTitle>
              {!teamsLoading && <ExportBtn filename="teams-by-size.csv" data={teamsData?.teamsBySize ?? []} ariaLabel="Export chart data as CSV" />}
            </CardHeader>
            <CardContent>
              {teamsLoading ? <Skeleton className="w-full h-[250px]" /> : (
                <ResponsiveContainer width="100%" height={250} debounce={0}>
                  <BarChart data={teamsBySizeBreakdown} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="range" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                    <YAxis tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                    <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)', stroke: 'none' }} isAnimationActive={false} />
                    <Legend />
                    <Bar dataKey="totalTeamSize" name="Total team size" fill={CHART_COLORS.blue} fillOpacity={0.85} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="owners" name="Owners" fill={CHART_COLORS.purple} fillOpacity={0.85} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="members" name="Members" fill={CHART_COLORS.green} fillOpacity={0.85} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="guests" name="Guests" fill={CHART_COLORS.pink} fillOpacity={0.85} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-base">Activity (Last 30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              {teamsLoading ? (
                 <div className="grid grid-cols-2 gap-4 mt-4">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                 </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="p-4 border rounded-md flex flex-col justify-center bg-card">
                    <p className="text-sm text-muted-foreground font-medium mb-1">Active Users</p>
                    <p className="text-2xl font-bold" style={{ color: CHART_COLORS.blue }}>{formatCompact(teamsData?.activeUsersLast30Days || 0)}</p>
                  </div>
                  <div className="p-4 border rounded-md flex flex-col justify-center bg-card">
                    <p className="text-sm text-muted-foreground font-medium mb-1">Messages</p>
                    <p className="text-2xl font-bold" style={{ color: CHART_COLORS.purple }}>{formatCompact(teamsData?.messagesLast30Days || 0)}</p>
                  </div>
                  <div className="p-4 border rounded-md flex flex-col justify-center bg-card">
                    <p className="text-sm text-muted-foreground font-medium mb-1">Calls</p>
                    <p className="text-2xl font-bold" style={{ color: CHART_COLORS.green }}>{formatCompact(teamsData?.callsLast30Days || 0)}</p>
                  </div>
                  <div className="p-4 border rounded-md flex flex-col justify-center bg-card">
                    <p className="text-sm text-muted-foreground font-medium mb-1">Meetings</p>
                    <p className="text-2xl font-bold" style={{ color: CHART_COLORS.pink }}>{formatCompact(teamsData?.meetingsOrganizedLast30Days || 0)}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

        <CollapsibleSection title="Most Active Teams (Last 30 Days)" storageKey="teams-most-active" className="mt-4">
          {teamsLoading ? (
            <TableSkeleton rows={6} rowClassName="h-12" className="p-0" />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <Input
                  placeholder="Search teams…"
                  value={topTeamsGlobalFilter}
                  onChange={(e) => setTopTeamsGlobalFilter(e.target.value)}
                  className="max-w-sm"
                />
                <ExportBtn filename="most-active-teams.csv" data={teamsData?.topTeams ?? []} variant="button" />
              </div>

              <DataTable
                columns={topTeamsColumns}
                data={teamsData?.topTeams || []}
                globalFilter={topTeamsGlobalFilter}
                pageSize={10}
                emptyMessage="No Teams activity data available for the last 30 days."
              />
            </div>
          )}
        </CollapsibleSection>
        </>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="SharePoint Online" description="Sites, storage, and sharing policies" storageKey="teams-sharepoint" defaultOpen={true} density="compact" issue={spIssue}>
        {isSpError ? (
          <ErrorPanel title="Couldn't load SharePoint data" error={spError} onRetry={() => refetchSp()} />
        ) : (
        <div className="space-y-4">

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard
            title="Total Sites"
            value={spData?.totalSites}
            loading={spLoading}
            evidenceStatus={getSharePointMetricMetaWithFieldFallback("sharepoint.totalSites")?.evidenceStatus}
            confidenceLabel={getSharePointMetricMetaWithFieldFallback("sharepoint.totalSites")?.confidenceLabel}
          />
          <KPICard
            title="Active Sites"
            value={spData?.activeSites}
            loading={spLoading}
            evidenceStatus={getSharePointMetricMetaWithFieldFallback("sharepoint.activeSites")?.evidenceStatus}
            confidenceLabel={getSharePointMetricMetaWithFieldFallback("sharepoint.activeSites")?.confidenceLabel}
          />
          <KPICard
            title="Inactive Sites"
            value={spData ? spData.totalSites - spData.activeSites : undefined}
            loading={spLoading}
            evidenceStatus={getSharePointMetricMetaWithFieldFallback("sharepoint.activeSites")?.evidenceStatus}
            confidenceLabel={getSharePointMetricMetaWithFieldFallback("sharepoint.activeSites")?.confidenceLabel}
          />
          <KPICard
            title="Storage Used (GB)"
            value={spData?.totalStorageUsedGB?.toFixed(1)}
            loading={spLoading}
            evidenceStatus={getSharePointMetricMetaWithFieldFallback("sharepoint.totalStorageUsedGB")?.evidenceStatus}
            confidenceLabel={getSharePointMetricMetaWithFieldFallback("sharepoint.totalStorageUsedGB")?.confidenceLabel}
          />
          <KPICard
            title="Total Files"
            value={spData ? formatCompact(spData.totalFiles) : undefined}
            loading={spLoading}
            evidenceStatus={getSharePointMetricMetaWithFieldFallback("sharepoint.totalFiles")?.evidenceStatus}
            confidenceLabel={getSharePointMetricMetaWithFieldFallback("sharepoint.totalFiles")?.confidenceLabel}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KPICard
            title="Total Sharing Links"
            value={sharingData ? formatCompact(sharingData.totalSharingLinks) : undefined}
            loading={sharingSummaryLoading}
            evidenceStatus="apiBacked"
            confidenceLabel={sharingData?.partialData ? "medium" : "high"}
          />
          <KPICard
            title="Organisation-Wide Links"
            value={sharingData ? formatCompact(sharingData.orgWideLinks) : undefined}
            loading={sharingSummaryLoading}
            evidenceStatus="apiBacked"
            confidenceLabel={sharingData?.partialData ? "medium" : "high"}
          />
        </div>
        {sharingData?.partialData && sharingData.sampledSites < sharingData.totalSitesAvailable && (
          <p className="text-xs text-muted-foreground">
            Sharing links based on {sharingData.sampledSites} of {sharingData.totalSitesAvailable} sites sampled
          </p>
        )}

        <CollapsibleSection title="SharePoint Site Details" storageKey="teams-sharepoint-sites">
            {spLoading ? (
              <TableSkeleton rows={6} rowClassName="h-12" className="p-0" />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <Input
                      placeholder="Search sites…"
                      value={spGlobalFilter}
                      onChange={(e) => setSpGlobalFilter(e.target.value)}
                      className="max-w-sm"
                    />
                    <ExportBtn filename="sharepoint-sites.csv" data={filteredSites} variant="button" />
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground mr-1">Status:</span>
                      {(["all", "active", "inactive"] as const).map((v) => (
                        <Button key={v} size="sm" variant={spActiveFilter === v ? "default" : "outline"}
                          className="h-7 px-3 text-xs capitalize" onClick={() => setSpActiveFilter(v)}>
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </Button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground mr-1">Team:</span>
                      {([
                        { value: "all",        label: "All" },
                        { value: "assigned",   label: "Assigned" },
                        { value: "unassigned", label: "Unassigned" },
                      ] as const).map(({ value, label }) => (
                        <Button key={value} size="sm" variant={spTeamFilter === value ? "default" : "outline"}
                          className="h-7 px-3 text-xs" onClick={() => setSpTeamFilter(value)}>
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                <DataTable
                  columns={spColumns}
                  data={filteredSites}
                  globalFilter={spGlobalFilter}
                  pageSize={5}
                  emptyMessage="No results found."
                />
              </div>
            )}
        </CollapsibleSection>
        </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Summary Check List" description="Teams and SharePoint security controls assessment" storageKey="teams-checklist" defaultOpen={false} density="compact">
        <div className="space-y-4">
          <ChecklistTable
            sectionTitle=""
            groups={sharePointPoliciesChecklist}
            loading={spPoliciesLoading}
          />
          <ChecklistTable sectionTitle="" groups={teamsChecklist} loading={teamsLoading || spLoading} />
        </div>
      </CollapsibleSection>

    </div>
  );
}
