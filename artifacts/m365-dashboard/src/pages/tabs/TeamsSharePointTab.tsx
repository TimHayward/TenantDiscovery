import { useGetM365TeamsWithMetadata, useGetM365SharePointWithMetadata, useGetM365DataSources } from "@workspace/api-client-react";
import { ChecklistTable, type ChecklistGroup } from "@/components/ChecklistTable";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CSVLink } from "react-csv";
import { Download } from "lucide-react";
import { useTheme } from "next-themes";
import { formatCompact, formatDate } from "@/lib/utils";
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
import type { SharePointSiteItem, TeamsTeamActivityItem } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import type { ConfidenceLabel, EvidenceStatus } from "@workspace/permissions-manifest";

const CHART_COLORS = {
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
};

const topTeamsColumns: ColumnDef<TeamsTeamActivityItem>[] = [
  {
    accessorKey: "teamName",
    header: "Team Name",
    cell: ({ row }) => <span className="font-medium">{row.original.teamName}</span>,
  },
  {
    accessorKey: "messages",
    header: "Messages",
    cell: ({ row }) => <span>{row.original.messages.toLocaleString()}</span>,
  },
  {
    accessorKey: "activeUsers",
    header: "Active Users",
    cell: ({ row }) => <span>{row.original.activeUsers.toLocaleString()}</span>,
  },
  {
    accessorKey: "activeChannels",
    header: "Active Channels",
    cell: ({ row }) => <span>{row.original.activeChannels.toLocaleString()}</span>,
  },
  {
    accessorKey: "meetingsOrganized",
    header: "Meetings",
    cell: ({ row }) => <span>{row.original.meetingsOrganized.toLocaleString()}</span>,
  },
  {
    accessorKey: "reactions",
    header: "Reactions",
    cell: ({ row }) => <span>{row.original.reactions.toLocaleString()}</span>,
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
    cell: ({ row }) => <span>{row.original.filesCount.toLocaleString()}</span>,
  },
  {
    accessorKey: "pageViews",
    header: "Page Views",
    cell: ({ row }) => <span>{row.original.pageViews.toLocaleString()}</span>,
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
  const { data: teamsWithMetadata, isLoading: isTeamsLoading, isFetching: isTeamsFetching } = useGetM365TeamsWithMetadata();
  const { data: spWithMetadata, isLoading: isSpLoading, isFetching: isSpFetching } = useGetM365SharePointWithMetadata();
  const { data: dataSources } = useGetM365DataSources({ tab: "teams-sharepoint" });
  
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const teamsLoading = isTeamsLoading || isTeamsFetching;
  const spLoading = isSpLoading || isSpFetching;
  const teamsData = teamsWithMetadata?.data;
  const spData = spWithMetadata?.data;

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
      { label: "External sharing managed via whitelist/blacklist", status: "manual",
        evidenceStatus: getMetricMetaWithFieldFallback("teams-sharepoint.checklist.5.1.guestSharing")?.evidenceStatus,
        confidenceLabel: getMetricMetaWithFieldFallback("teams-sharepoint.checklist.5.1.guestSharing")?.confidenceLabel,
        metricId: "teams-sharepoint.checklist.5.1.guestSharing",
        sourceLabel: "SharePoint Admin Center",
      },
      { label: "Link sharing restricted to specific people or organisation", status: "manual",
        evidenceStatus: getMetricMeta("teams-sharepoint.checklist.5.1.linkSharing")?.evidenceStatus,
        metricId: "teams-sharepoint.checklist.5.1.linkSharing",
      },
    ]},
    { id: "5.2", title: "5.2 Expiration Dates are set for Anyone links", items: [
      { label: "Expiration date is set for anonymous sharing links", status: "manual",
        evidenceStatus: getMetricMeta("teams-sharepoint.checklist.5.2.anonLinkExpiration")?.evidenceStatus,
        confidenceLabel: getMetricMeta("teams-sharepoint.checklist.5.2.anonLinkExpiration")?.confidenceLabel,
        metricId: "teams-sharepoint.checklist.5.2.anonLinkExpiration",
      },
    ]},
  ];

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const [topTeamsSorting, setTopTeamsSorting] = useState<SortingState>([]);
  const [topTeamsGlobalFilter, setTopTeamsGlobalFilter] = useState("");
  const [spSorting, setSpSorting] = useState<SortingState>([]);
  const [spGlobalFilter, setSpGlobalFilter] = useState("");

  const topTeamsTable = useReactTable({
    data: teamsData?.topTeams || [],
    columns: topTeamsColumns,
    state: { sorting: topTeamsSorting, globalFilter: topTeamsGlobalFilter },
    onSortingChange: setTopTeamsSorting,
    onGlobalFilterChange: setTopTeamsGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  const spTable = useReactTable({
    data: spData?.sites || [],
    columns: spColumns,
    state: { sorting: spSorting, globalFilter: spGlobalFilter },
    onSortingChange: setSpSorting,
    onGlobalFilterChange: setSpGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 5 } },
  });

  return (
    <div className="space-y-8">
      {/* TEAMS SECTION */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Microsoft Teams</h2>
        
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
              {!teamsLoading && teamsData?.teamsBySize && teamsData.teamsBySize.length > 0 && (
                <CSVLink data={teamsData.teamsBySize} filename="teams-by-size.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent>
              {teamsLoading ? <Skeleton className="w-full h-[250px]" /> : (
                <ResponsiveContainer width="100%" height={250} debounce={0}>
                  <BarChart data={teamsData?.teamsBySize || []} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="range" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                    <YAxis tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                    <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)', stroke: 'none' }} isAnimationActive={false} />
                    <Bar dataKey="count" name="Teams" fill={CHART_COLORS.purple} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]} />
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

        <CollapsibleSection title="Most Active Teams (Last 30 Days)" storageKey="teams-most-active">
          {teamsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <Input
                  placeholder="Search teams..."
                  value={topTeamsGlobalFilter}
                  onChange={(e) => setTopTeamsGlobalFilter(e.target.value)}
                  className="max-w-sm"
                />
                {(teamsData?.topTeams?.length ?? 0) > 0 && (
                  <CSVLink
                    data={teamsData!.topTeams}
                    filename="most-active-teams.csv"
                    className="print:hidden flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </CSVLink>
                )}
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    {topTeamsTable.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none">
                            <div className="flex items-center gap-2">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {{ asc: " 🔼", desc: " 🔽" }[header.column.getIsSorted() as string] ?? null}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {topTeamsTable.getRowModel().rows.length > 0 ? (
                      topTeamsTable.getRowModel().rows.map((row) => (
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
                        <TableCell colSpan={topTeamsColumns.length} className="h-24 text-center text-muted-foreground">
                          No Teams activity data available for the last 30 days.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {topTeamsTable.getState().pagination.pageIndex * topTeamsTable.getState().pagination.pageSize + (topTeamsTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)} to{" "}
                  {Math.min((topTeamsTable.getState().pagination.pageIndex + 1) * topTeamsTable.getState().pagination.pageSize, topTeamsTable.getFilteredRowModel().rows.length)}{" "}
                  of {topTeamsTable.getFilteredRowModel().rows.length} results
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => topTeamsTable.previousPage()} disabled={!topTeamsTable.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => topTeamsTable.nextPage()} disabled={!topTeamsTable.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
        </CollapsibleSection>

      {/* SHAREPOINT SECTION */}
      <div className="space-y-4 pt-4">
        <h2 className="text-xl font-semibold border-b pb-2">SharePoint Online</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
            title="Storage Used (GB)"
            value={spData?.totalStorageUsedGB.toFixed(1)}
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

        <CollapsibleSection title="Top SharePoint Sites" storageKey="teams-sharepoint-sites">
            {spLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="space-y-4">
                <Input
                  placeholder="Search sites..."
                  value={spGlobalFilter}
                  onChange={(e) => setSpGlobalFilter(e.target.value)}
                  className="max-w-sm"
                />

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      {spTable.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none">
                              <div className="flex items-center gap-2">
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {{ asc: " 🔼", desc: " 🔽" }[header.column.getIsSorted() as string] ?? null}
                              </div>
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {spTable.getRowModel().rows.length > 0 ? (
                        spTable.getRowModel().rows.map((row) => (
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
                          <TableCell colSpan={spColumns.length} className="h-24 text-center text-muted-foreground">
                            No results found.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing {spTable.getState().pagination.pageIndex * spTable.getState().pagination.pageSize + (spTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)} to{" "}
                    {Math.min((spTable.getState().pagination.pageIndex + 1) * spTable.getState().pagination.pageSize, spTable.getFilteredRowModel().rows.length)}{" "}
                    of {spTable.getFilteredRowModel().rows.length} results
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => spTable.previousPage()} disabled={!spTable.getCanPreviousPage()}>Previous</Button>
                    <Button variant="outline" size="sm" onClick={() => spTable.nextPage()} disabled={!spTable.getCanNextPage()}>Next</Button>
                  </div>
                </div>
              </div>
            )}
        </CollapsibleSection>
      </div>

      {/* SECTIONS 3 + 5 — TEAMS & SHAREPOINT SECURITY CHECKLIST */}
      <ChecklistTable sectionTitle="Teams & SharePoint" groups={teamsChecklist} loading={teamsLoading || spLoading} />

    </div>
  );
}
