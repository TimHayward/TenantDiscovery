import { useGetM365PowerBIWithMetadata } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { ExportBtn } from "@/components/ExportBtn";
import { DataTable } from "@/components/DataTable";
import { ErrorPanel, RefreshIndicator } from "@/components/ErrorPanel";
import { getCollectionIssues, summarizeIssues } from "@/lib/collectionStatus";
import { chartPalette } from "@/lib/chartPalette";
import type { PowerBIWorkspaceItem } from "@workspace/api-client-react";

const workspaceColumns: ColumnDef<PowerBIWorkspaceItem>[] = [
  {
    accessorKey: "name",
    header: "Workspace",
    cell: ({ row }) => (
      <div>
        <div className="font-medium text-[13px]">{row.original.name || "(unnamed)"}</div>
        <div className="text-[11px] text-muted-foreground font-mono">{row.original.id}</div>
      </div>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ getValue }) => (
      <Badge variant="outline" className="text-[11px]">
        {String(getValue())}
      </Badge>
    ),
  },
  {
    accessorKey: "state",
    header: "State",
    cell: ({ getValue }) => {
      const state = String(getValue());
      const color =
        state === "Active" ? "text-green-600 dark:text-green-400" :
        state === "Deleted" ? "text-red-500" :
        "text-amber-600 dark:text-amber-400";
      return <span className={`text-[12px] font-medium ${color}`}>{state}</span>;
    },
  },
  {
    accessorKey: "isOrphaned",
    header: "Orphaned",
    cell: ({ row }) =>
      row.original.isOrphaned ? (
        <span className="text-amber-600 dark:text-amber-400 font-semibold text-[12px]">Yes</span>
      ) : (
        <span className="text-muted-foreground text-[12px]">No</span>
      ),
  },
  {
    accessorKey: "adminCount",
    header: "Admins",
    cell: ({ getValue }) => (
      <span className="text-[12px] tabular-nums">{Number(getValue())}</span>
    ),
  },
  {
    accessorKey: "datasetCount",
    header: "Datasets",
    cell: ({ getValue }) => (
      <span className="text-[12px] tabular-nums">{Number(getValue())}</span>
    ),
  },
  {
    accessorKey: "reportCount",
    header: "Reports",
    cell: ({ getValue }) => (
      <span className="text-[12px] tabular-nums">{Number(getValue())}</span>
    ),
  },
  {
    accessorKey: "isOnDedicatedCapacity",
    header: "Dedicated",
    cell: ({ getValue }) => (
      <span className="text-[12px]">{getValue() ? "Yes" : "No"}</span>
    ),
  },
];

export function PowerBITab() {
  const { data: response, isLoading, isFetching, isError, error, refetch } = useGetM365PowerBIWithMetadata();
  const data = response?.data;
  const loading = isLoading;
  const issue = summarizeIssues(getCollectionIssues(data));

  const [globalFilter, setGlobalFilter] = useState("");

  const workspaces = data?.workspaces ?? [];

  const csvData = workspaces.map((w) => ({
    Name: w.name,
    Type: w.type,
    State: w.state,
    Orphaned: w.isOrphaned ? "Yes" : "No",
    Admins: w.adminCount,
    Datasets: w.datasetCount,
    Reports: w.reportCount,
    "Dedicated Capacity": w.isOnDedicatedCapacity ? "Yes" : "No",
    "Capacity ID": w.capacityId ?? "",
  }));

  if (isError) {
    return <ErrorPanel title="Couldn't load Power BI data" error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="relative space-y-6">
      <RefreshIndicator active={isFetching && !isLoading} />
      {/* Unavailable banner */}
      {!loading && data && !data.available && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-4">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Power BI Admin API not accessible
            </p>
            <p className="text-[12px] text-amber-700 dark:text-amber-400 mt-0.5">
              The service principal could not acquire a Power BI token. To enable this tab,
              grant the service principal <strong>Tenant.Read.All</strong> (read-only) in the
              Power BI admin portal under Developer settings.
            </p>
            {issue && (
              <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1 font-mono">
                {issue.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Workspaces"
          value={data?.available ? data.totalWorkspaces : undefined}
          loading={loading}
          density="compact"
        />
        <KPICard
          title="Active Workspaces"
          value={data?.available ? data.activeWorkspaces : undefined}
          loading={loading}
          density="compact"
          valueColor={
            data?.available && (data.activeWorkspaces ?? 0) > 0 ? chartPalette.green : undefined
          }
        />
        <KPICard
          title="Orphaned Workspaces"
          value={data?.available ? data.orphanedWorkspaces : undefined}
          loading={loading}
          density="compact"
          valueColor={
            (data?.orphanedWorkspaces ?? 0) > 0 ? chartPalette.warning : undefined
          }
        />
        <KPICard
          title="Total Datasets"
          value={data?.available ? data.totalDatasets : undefined}
          loading={loading}
          density="compact"
        />
      </div>

      {/* Secondary metrics */}
      {data?.available && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard
            title="Total Reports"
            value={data.totalReports}
            loading={loading}
            density="compact"
          />
          <KPICard
            title="Refreshable Datasets"
            value={data.refreshableDatasets}
            loading={loading}
            density="compact"
          />
          <KPICard
            title="Personal Workspaces"
            value={data.personalWorkspaces}
            loading={loading}
            density="compact"
          />
          <KPICard
            title="Premium Capacity"
            value={data.dedicatedCapacityWorkspaces}
            loading={loading}
            density="compact"
          />
        </div>
      )}

      {/* Capacities section */}
      {data?.available && (data.capacities?.length ?? 0) > 0 && (
        <CollapsibleSection title="Premium Capacities" storageKey="powerbi-capacities" defaultOpen issue={issue}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[12px]">Name</TableHead>
                  <TableHead className="text-[12px]">SKU</TableHead>
                  <TableHead className="text-[12px]">State</TableHead>
                  <TableHead className="text-[12px]">Admins</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.capacities.map((cap) => (
                  <TableRow key={cap.id}>
                    <TableCell className="text-[12px] font-medium">{cap.displayName}</TableCell>
                    <TableCell className="text-[12px] font-mono">{cap.sku}</TableCell>
                    <TableCell>
                      <span
                        className={`text-[12px] font-medium ${
                          cap.state === "Active"
                            ? "text-green-600 dark:text-green-400"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {cap.state}
                      </span>
                    </TableCell>
                    <TableCell className="text-[12px] tabular-nums">{cap.adminCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CollapsibleSection>
      )}

      {/* Workspaces table */}
      {data?.available && (
        <CollapsibleSection title={`Workspaces (${workspaces.length})`} storageKey="powerbi-workspaces" defaultOpen>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Input
                placeholder="Filter workspaces…"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="max-w-xs h-8 text-[12px]"
              />
              <ExportBtn filename="powerbi-workspaces.csv" data={csvData} variant="button" />
            </div>

            <DataTable
              columns={workspaceColumns}
              data={workspaces}
              globalFilter={globalFilter}
              pageSize={25}
              rowNoun="workspaces"
              emptyMessage="No workspaces found"
            />
          </div>
        </CollapsibleSection>
      )}

      {/* Orphaned workspace call-out */}
      {data?.available && (data.orphanedWorkspaces ?? 0) > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-[12px]">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300">
            <strong>{data.orphanedWorkspaces}</strong> active workspace
            {data.orphanedWorkspaces !== 1 ? "s have" : " has"} no admin user assigned.
            Orphaned workspaces may contain sensitive reports with no accountable owner.
            Review and assign owners or archive these workspaces.
          </span>
        </div>
      )}
    </div>
  );
}
