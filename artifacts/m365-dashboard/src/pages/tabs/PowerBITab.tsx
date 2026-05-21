import { useGetM365PowerBIWithMetadata } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Download } from "lucide-react";
import { CSVLink } from "react-csv";
import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type SortingState,
  flexRender,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
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
  const { data: response, isLoading } = useGetM365PowerBIWithMetadata();
  const data = response?.data;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const PAGE_SIZE = 25;
  const [page, setPage] = useState(0);

  const workspaces = data?.workspaces ?? [];

  const table = useReactTable({
    data: workspaces,
    columns: workspaceColumns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const allRows = table.getRowModel().rows;
  const pageCount = Math.ceil(allRows.length / PAGE_SIZE);
  const pageRows = allRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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

  return (
    <div className="space-y-6">
      {/* Unavailable banner */}
      {!isLoading && data && !data.available && (
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
            {data.collectionIssues?.length > 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1 font-mono">
                {data.collectionIssues[0]?.message}
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
          loading={isLoading}
          density="compact"
        />
        <KPICard
          title="Active Workspaces"
          value={data?.available ? data.activeWorkspaces : undefined}
          loading={isLoading}
          density="compact"
          valueColor={
            data?.available && (data.activeWorkspaces ?? 0) > 0 ? "#009118" : undefined
          }
        />
        <KPICard
          title="Orphaned Workspaces"
          value={data?.available ? data.orphanedWorkspaces : undefined}
          loading={isLoading}
          density="compact"
          valueColor={
            (data?.orphanedWorkspaces ?? 0) > 0 ? "#d97706" : undefined
          }
        />
        <KPICard
          title="Total Datasets"
          value={data?.available ? data.totalDatasets : undefined}
          loading={isLoading}
          density="compact"
        />
      </div>

      {/* Secondary metrics */}
      {data?.available && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard
            title="Total Reports"
            value={data.totalReports}
            loading={isLoading}
            density="compact"
          />
          <KPICard
            title="Refreshable Datasets"
            value={data.refreshableDatasets}
            loading={isLoading}
            density="compact"
          />
          <KPICard
            title="Personal Workspaces"
            value={data.personalWorkspaces}
            loading={isLoading}
            density="compact"
          />
          <KPICard
            title="Premium Capacity"
            value={data.dedicatedCapacityWorkspaces}
            loading={isLoading}
            density="compact"
          />
        </div>
      )}

      {/* Capacities section */}
      {data?.available && (data.capacities?.length ?? 0) > 0 && (
        <CollapsibleSection title="Premium Capacities" defaultOpen>
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
        <CollapsibleSection title={`Workspaces (${workspaces.length})`} defaultOpen>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Input
                placeholder="Filter workspaces…"
                value={globalFilter}
                onChange={(e) => {
                  setGlobalFilter(e.target.value);
                  setPage(0);
                }}
                className="max-w-xs h-8 text-[12px]"
              />
              {csvData.length > 0 && (
                <CSVLink
                  data={csvData}
                  filename="powerbi-workspaces.csv"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded border border-border hover:bg-accent transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </CSVLink>
              )}
            </div>

            <div className="overflow-x-auto rounded border border-border">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((hg) => (
                    <TableRow key={hg.id}>
                      {hg.headers.map((header) => (
                        <TableHead
                          key={header.id}
                          className="text-[11px] cursor-pointer select-none whitespace-nowrap"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === "asc"
                            ? " ↑"
                            : header.column.getIsSorted() === "desc"
                            ? " ↓"
                            : ""}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {pageRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={workspaceColumns.length} className="text-center text-[12px] text-muted-foreground py-6">
                        No workspaces found
                      </TableCell>
                    </TableRow>
                  ) : (
                    pageRows.map((row) => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-2 align-top">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                <span>
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, allRows.length)} of {allRows.length}
                </span>
                <div className="flex gap-1">
                  <button
                    className="px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-40"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    ‹ Prev
                  </button>
                  <button
                    className="px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-40"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next ›
                  </button>
                </div>
              </div>
            )}
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
