import { useGetM365LicensesWithMetadata, useGetM365Users } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Filter, EyeOff } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { ErrorPanel, RefreshIndicator } from "@/components/ErrorPanel";
import { EmptyState } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { getCollectionIssues, summarizeIssues } from "@/lib/collectionStatus";
import { useChartTheme } from "@/lib/useChartTheme";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { type ColumnDef } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { calculateLicenseStats, isFreeLicenseSku, readHiddenLicenseSkus, writeHiddenLicenseSkus } from "@/lib/licenseFilters";
import type { LicenseItem, GhostUserItem } from "@workspace/api-client-react";
import { chartPalette as CHART_COLORS } from "@/lib/chartPalette";
import { ExportBtn } from "@/components/ExportBtn";
import { DataTable } from "@/components/DataTable";

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
    cell: ({ row }) => <span>{formatNumber(row.original.total)}</span>,
  },
  {
    accessorKey: "assigned",
    header: "Assigned",
    cell: ({ row }) => <span className="font-semibold" style={{ color: CHART_COLORS.blue }}>{formatNumber(row.original.assigned)}</span>,
  },
  {
    accessorKey: "available",
    header: "Available",
    cell: ({ row }) => <span>{formatNumber(row.original.available)}</span>,
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

const ghostColumns: ColumnDef<GhostUserItem>[] = [
  {
    accessorKey: "displayName",
    header: "Name",
    cell: ({ row }) => (
      <div>
        <div className="font-medium text-sm">{row.original.displayName}</div>
        <div className="text-xs text-muted-foreground">{row.original.userPrincipalName}</div>
      </div>
    ),
  },
  {
    accessorKey: "lastSignIn",
    header: "Last Sign-in",
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.lastSignIn
          ? formatDate(row.original.lastSignIn)
          : <span className="text-muted-foreground italic">Never</span>}
      </span>
    ),
  },
  {
    accessorKey: "daysInactive",
    header: "Days Inactive",
    cell: ({ row }) => (
      <span className={`font-semibold text-sm ${(row.original.daysInactive ?? 999) > 180 ? "text-red-600" : "text-amber-600"}`}>
        {row.original.daysInactive != null ? row.original.daysInactive : "—"}
      </span>
    ),
  },
  {
    accessorKey: "assignedLicenseCount",
    header: "Licenses",
    cell: ({ row }) => <span className="text-sm">{row.original.assignedLicenseCount}</span>,
  },
  {
    accessorKey: "estimatedMonthlyCost",
    header: "Est. Monthly Cost",
    cell: ({ row }) => (
      <span className="text-sm font-medium">
        {row.original.estimatedMonthlyCost > 0
          ? `$${row.original.estimatedMonthlyCost.toFixed(2)}`
          : <span className="text-muted-foreground text-xs">Unknown SKU</span>}
      </span>
    ),
  },
];

export function LicensesTab() {
  const { data: licensesWithMetadata, isLoading, isFetching, isError, error, refetch } = useGetM365LicensesWithMetadata();
  const { data: usersData } = useGetM365Users();

  const loading = isLoading;
  const data = licensesWithMetadata?.data;
  const issue = summarizeIssues(getCollectionIssues(data));

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

  const { gridColor, tickColor } = useChartTheme();

  const [globalFilter, setGlobalFilter] = useState("");
  const [hideFree, setHideFree] = useState(true);
  const [hideZeroAssigned, setHideZeroAssigned] = useState(false);
  const [hiddenSkus, setHiddenSkus] = useState<Set<string>>(() => readHiddenLicenseSkus());

  useEffect(() => {
    writeHiddenLicenseSkus(hiddenSkus);
  }, [hiddenSkus]);

  const toggleHiddenSku = (sku: string) => {
    setHiddenSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const [ghostFilter, setGhostFilter] = useState("");

  const ghostUsers = useMemo(() => usersData?.ghostUsers ?? [], [usersData]);
  const ghostLicensedCount = usersData?.ghostLicensedCount ?? 0;
  const estimatedMonthlyWaste = usersData?.estimatedMonthlyWaste ?? 0;

  const filteredLicenses = useMemo(() => {
    if (!data?.licenses) return [];
    return data.licenses.filter((lic) => {
      const isFree = isFreeLicenseSku(lic.skuPartNumber);
      // Checked: hide free/dev SKUs. Unchecked: show *only* free/dev SKUs.
      if (hideFree ? isFree : !isFree) return false;
      if (hideZeroAssigned && lic.assigned === 0) return false;
      if (hiddenSkus.has(lic.skuPartNumber)) return false;
      return true;
    });
  }, [data?.licenses, hideFree, hideZeroAssigned, hiddenSkus]);

  // SKUs offered in the "Hide specific SKUs" picker: every SKU in the tenant,
  // independent of the free/dev and unassigned bulk toggles — this is the
  // granular escape hatch, so any SKU (including free/dev ones the bulk toggles
  // hide) must be hide-able here. Sorted by name for scannability.
  const pickerLicenses = useMemo(() => {
    if (!data?.licenses) return [];
    return [...data.licenses].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [data?.licenses]);

  const filteredStats = useMemo(() => {
    return calculateLicenseStats(filteredLicenses);
  }, [filteredLicenses]);

  if (isError) {
    return <ErrorPanel title="Couldn't load licensing data" error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="relative space-y-4">
      <RefreshIndicator active={isFetching && !isLoading} />
      <CollapsibleSection title="Summary" description="License counts, allocation, and utilization" storageKey="licenses-summary" defaultOpen={true} density="compact" issue={issue}>
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
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-2">
              <EyeOff className="w-3.5 h-3.5" />
              Hide specific SKUs
              {hiddenSkus.size > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5">{hiddenSkus.size}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search SKUs…" />
              <CommandList>
                <CommandEmpty>No SKUs found.</CommandEmpty>
                <CommandGroup>
                  {pickerLicenses.map((lic) => (
                    <CommandItem
                      key={lic.skuId}
                      value={`${lic.displayName} ${lic.skuPartNumber}`}
                      onSelect={() => toggleHiddenSku(lic.skuPartNumber)}
                      className="cursor-pointer"
                    >
                      <Checkbox checked={hiddenSkus.has(lic.skuPartNumber)} className="mr-2 pointer-events-none" />
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-sm truncate">{lic.displayName}</span>
                        <span className="text-xs text-muted-foreground truncate">{lic.skuPartNumber}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
              {hiddenSkus.size > 0 && (
                <div className="border-t p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-7 text-xs"
                    onClick={() => setHiddenSkus(new Set())}
                  >
                    Clear {hiddenSkus.size} hidden
                  </Button>
                </div>
              )}
            </Command>
          </PopoverContent>
        </Popover>
        {(hideFree || hideZeroAssigned || hiddenSkus.size > 0) && data?.licenses && (
          <span className="text-xs text-muted-foreground ml-auto">
            Showing {filteredLicenses.length} of {data.licenses.length} SKUs
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Licenses"
          value={loading ? undefined : formatNumber(filteredStats.totalLicenses)}
          loading={loading}
          evidenceStatus={getMetricMeta("licenses.totalLicenses")?.evidenceStatus}
          confidenceLabel={getMetricMeta("licenses.totalLicenses")?.confidenceLabel}
        />
        <KPICard
          title="Assigned Licenses"
          value={loading ? undefined : formatNumber(filteredStats.assignedLicenses)}
          loading={loading}
          valueColor={CHART_COLORS.blue}
          evidenceStatus={getMetricMeta("licenses.assignedLicenses")?.evidenceStatus}
          confidenceLabel={getMetricMeta("licenses.assignedLicenses")?.confidenceLabel}
        />
        <KPICard
          title="Available Licenses"
          value={loading ? undefined : formatNumber(filteredStats.availableLicenses)}
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
          {!loading && <ExportBtn filename="license-allocation.csv" data={filteredLicenses} ariaLabel="Export chart data as CSV" />}
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

      <CollapsibleSection
        title="Stale Licensed Users"
        description="Enabled users with assigned licences who have not signed in for 90+ days"
        storageKey="licenses-ghost-users"
      >
        {loading ? (
          <TableSkeleton rows={3} rowClassName="h-12" className="p-0" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <KPICard
                title="Stale Licensed Users"
                value={formatNumber(ghostLicensedCount)}
                loading={false}
                valueColor={ghostLicensedCount > 0 ? CHART_COLORS.red : CHART_COLORS.green}
              />
              <KPICard
                title="Est. Monthly Waste"
                value={estimatedMonthlyWaste > 0 ? formatCurrency(estimatedMonthlyWaste) : ghostLicensedCount > 0 ? "SKU unknown" : "$0"}
                loading={false}
                valueColor={estimatedMonthlyWaste > 0 ? CHART_COLORS.red : undefined}
              />
              <KPICard
                title="Est. Annual Waste"
                value={estimatedMonthlyWaste > 0 ? formatCurrency(estimatedMonthlyWaste * 12) : ghostLicensedCount > 0 ? "SKU unknown" : "$0"}
                loading={false}
                valueColor={estimatedMonthlyWaste > 0 ? CHART_COLORS.red : undefined}
              />
            </div>

            {ghostUsers.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Input
                    placeholder="Search users…"
                    value={ghostFilter}
                    onChange={(e) => setGhostFilter(e.target.value)}
                    className="max-w-sm"
                  />
                  <div className="ml-auto">
                    <ExportBtn filename="stale-licensed-users.csv" data={ghostUsers} />
                  </div>
                </div>

                <DataTable
                  columns={ghostColumns}
                  data={ghostUsers}
                  globalFilter={ghostFilter}
                  initialSorting={[{ id: "daysInactive", desc: true }]}
                  pageSize={10}
                  rowNoun="users"
                  emptyMessage="No stale licensed users found."
                />
              </div>
            )}

            {ghostUsers.length === 0 && (
              <EmptyState
                title="No stale licensed users found"
                description="All licensed users have signed in within the last 90 days."
              />
            )}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="License Subscriptions" storageKey="licenses-subscriptions">
          {loading ? (
            <TableSkeleton rows={6} rowClassName="h-12" className="p-0" />
          ) : (
            <div className="space-y-4">
              <Input
                placeholder="Search licenses…"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="max-w-sm"
              />

              <DataTable
                columns={columns}
                data={filteredLicenses}
                globalFilter={globalFilter}
                pageSize={10}
                rowNoun="results"
                emptyMessage="No licenses match the current filters."
              />
            </div>
          )}
      </CollapsibleSection>
    </div>
  );
}
