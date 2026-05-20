import { useGetM365LicensesWithMetadata } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CSVLink } from "react-csv";
import { Download, Filter } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useMemo } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { LicenseItem } from "@workspace/api-client-react";

const CHART_COLORS = {
  blue: "#1E3D59",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
};

const FREE_SKUS = new Set([
  "WINDOWS_STORE",
  "FLOW_FREE",
  "POWERAPPS_DEV",
  "POWERAPPS_VIRAL",
  "POWER_BI_STANDARD",
  "TEAMS_FREE",
  "TEAMS_EXPLORATORY",
  "DEVELOPERPACK",
  "DEVELOPERPACK_E5",
  "RIGHTSMANAGEMENT_ADHOC",
  "MCOMEETADV",
]);

const columns: ColumnDef<LicenseItem>[] = [
  {
    accessorKey: "displayName",
    header: "Product Name",
    cell: ({ row }) => <span className="font-medium">{row.original.displayName}</span>,
  },
  {
    accessorKey: "skuPartNumber",
    header: "SKU",
    cell: ({ row }) => <span className="text-muted-foreground text-xs">{row.original.skuPartNumber}</span>,
  },
  {
    accessorKey: "total",
    header: "Total",
    cell: ({ row }) => <span>{row.original.total.toLocaleString()}</span>,
  },
  {
    accessorKey: "assigned",
    header: "Assigned",
    cell: ({ row }) => <span className="font-semibold" style={{ color: CHART_COLORS.blue }}>{row.original.assigned.toLocaleString()}</span>,
  },
  {
    accessorKey: "available",
    header: "Available",
    cell: ({ row }) => <span>{row.original.available.toLocaleString()}</span>,
  },
  {
    accessorKey: "suspended",
    header: "Suspended",
    cell: ({ row }) => <span className={row.original.suspended > 0 ? "text-red-600 font-semibold" : "text-muted-foreground"}>{row.original.suspended}</span>,
  },
  {
    accessorKey: "warning",
    header: "Warning",
    cell: ({ row }) => <span className={row.original.warning > 0 ? "text-amber-600 font-semibold" : "text-muted-foreground"}>{row.original.warning}</span>,
  },
];

export function LicensesTab() {
  const { data: licensesWithMetadata, isLoading, isFetching } = useGetM365LicensesWithMetadata();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const loading = isLoading || isFetching;
  const data = licensesWithMetadata?.data;

  const metricToFieldMap: Record<string, string> = {
    "licenses.totalLicenses": "totalLicenses",
    "licenses.assignedLicenses": "assignedLicenses",
    "licenses.availableLicenses": "availableLicenses",
    "licenses.utilizationPercent": "utilizationPercent",
  };

  const getMetricMeta = (metricId: string) => {
    const field = metricToFieldMap[metricId];
    return field ? licensesWithMetadata?.fieldMetadata?.[field] : undefined;
  };

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [hideFree, setHideFree] = useState(true);
  const [hideZeroAssigned, setHideZeroAssigned] = useState(false);

  const filteredLicenses = useMemo(() => {
    if (!data?.licenses) return [];
    return data.licenses.filter((lic) => {
      if (hideFree && FREE_SKUS.has(lic.skuPartNumber)) return false;
      if (hideZeroAssigned && lic.assigned === 0) return false;
      return true;
    });
  }, [data?.licenses, hideFree, hideZeroAssigned]);

  const filteredStats = useMemo(() => {
    const totalLicenses = filteredLicenses.reduce((s, l) => s + l.total, 0);
    const assignedLicenses = filteredLicenses.reduce((s, l) => s + l.assigned, 0);
    const availableLicenses = filteredLicenses.reduce((s, l) => s + l.available, 0);
    const utilizationPercent = totalLicenses > 0 ? Math.round((assignedLicenses / totalLicenses) * 100) : 0;
    return { totalLicenses, assignedLicenses, availableLicenses, utilizationPercent };
  }, [filteredLicenses]);

  const table = useReactTable({
    data: filteredLicenses,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  return (
    <div className="space-y-4">
      <CollapsibleSection title="Summary" description="License counts, allocation, and utilization" storageKey="licenses-summary" defaultOpen={true} density="compact">
      <div className="space-y-4">
      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Filters:</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="hide-free"
            checked={hideFree}
            onCheckedChange={setHideFree}
          />
          <Label htmlFor="hide-free" className="text-sm cursor-pointer">Hide free/developer SKUs</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="hide-zero"
            checked={hideZeroAssigned}
            onCheckedChange={setHideZeroAssigned}
          />
          <Label htmlFor="hide-zero" className="text-sm cursor-pointer">Hide unassigned licenses</Label>
        </div>
        {(hideFree || hideZeroAssigned) && data?.licenses && (
          <span className="text-xs text-muted-foreground ml-auto">
            Showing {filteredLicenses.length} of {data.licenses.length} SKUs
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Licenses"
          value={loading ? undefined : filteredStats.totalLicenses.toLocaleString()}
          loading={loading}
          evidenceStatus={getMetricMeta("licenses.totalLicenses")?.evidenceStatus}
          confidenceLabel={getMetricMeta("licenses.totalLicenses")?.confidenceLabel}
        />
        <KPICard
          title="Assigned Licenses"
          value={loading ? undefined : filteredStats.assignedLicenses.toLocaleString()}
          loading={loading}
          valueColor={CHART_COLORS.blue}
          evidenceStatus={getMetricMeta("licenses.assignedLicenses")?.evidenceStatus}
          confidenceLabel={getMetricMeta("licenses.assignedLicenses")?.confidenceLabel}
        />
        <KPICard
          title="Available Licenses"
          value={loading ? undefined : filteredStats.availableLicenses.toLocaleString()}
          loading={loading}
          evidenceStatus={getMetricMeta("licenses.availableLicenses")?.evidenceStatus}
          confidenceLabel={getMetricMeta("licenses.availableLicenses")?.confidenceLabel}
        />
        <KPICard
          title="Utilization"
          value={loading ? undefined : `${filteredStats.utilizationPercent}%`}
          loading={loading}
          valueColor={filteredStats.utilizationPercent > 90 ? CHART_COLORS.red : filteredStats.utilizationPercent > 70 ? CHART_COLORS.green : CHART_COLORS.blue}
          evidenceStatus={getMetricMeta("licenses.utilizationPercent")?.evidenceStatus}
          confidenceLabel={getMetricMeta("licenses.utilizationPercent")?.confidenceLabel}
        />
      </div>

      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">License Allocation</CardTitle>
          {!loading && filteredLicenses.length > 0 && (
            <CSVLink data={filteredLicenses} filename="license-allocation.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
              <Download className="w-3.5 h-3.5" />
            </CSVLink>
          )}
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="w-full h-[350px]" /> : (
            <ResponsiveContainer width="100%" height={Math.max(200, filteredLicenses.length * 40)} debounce={0}>
              <BarChart data={filteredLicenses} layout="vertical" margin={{ left: 20, right: 30, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke={gridColor} />
                <XAxis type="number" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                <YAxis
                  type="category"
                  dataKey="displayName"
                  tick={{ fontSize: 11, fill: tickColor }}
                  stroke={tickColor}
                  width={180}
                />
                <Tooltip isAnimationActive={false} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Legend />
                <Bar dataKey="assigned" name="Assigned" fill={CHART_COLORS.blue} fillOpacity={0.85} isAnimationActive={false} radius={[0, 2, 2, 0]} />
                <Bar dataKey="available" name="Available" fill={CHART_COLORS.purple} fillOpacity={0.5} isAnimationActive={false} radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      </div>
      </CollapsibleSection>

      <CollapsibleSection title="License Subscriptions" storageKey="licenses-subscriptions">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-4">
              <Input
                placeholder="Search licenses..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="max-w-sm"
              />

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none">
                            <div className="flex items-center gap-1">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? null}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.length > 0 ? (
                      table.getRowModel().rows.map((row) => (
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
                        <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                          No licenses match the current filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + (table.getFilteredRowModel().rows.length > 0 ? 1 : 0)} to{" "}
                  {Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, table.getFilteredRowModel().rows.length)}{" "}
                  of {table.getFilteredRowModel().rows.length} results
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
      </CollapsibleSection>
    </div>
  );
}
