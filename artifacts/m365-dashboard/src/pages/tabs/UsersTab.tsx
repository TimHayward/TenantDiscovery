import { useGetM365Users } from "@workspace/api-client-react";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CSVLink } from "react-csv";
import { Download } from "lucide-react";
import { useTheme } from "next-themes";
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
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { UserItem } from "@workspace/api-client-react/src/generated/api.schemas";

const CHART_COLORS = {
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
};
const CHART_COLOR_LIST = [CHART_COLORS.blue, CHART_COLORS.purple, CHART_COLORS.green, CHART_COLORS.red, CHART_COLORS.pink];

const columns: ColumnDef<UserItem>[] = [
  {
    accessorKey: "displayName",
    header: "Display Name",
    cell: ({ row }) => <span className="font-medium">{row.original.displayName}</span>,
  },
  {
    accessorKey: "userPrincipalName",
    header: "UPN",
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.userPrincipalName}</span>,
  },
  {
    accessorKey: "userType",
    header: "Type",
    cell: ({ row }) => <span>{row.original.userType}</span>,
  },
  {
    accessorKey: "mfaEnabled",
    header: "MFA",
    cell: ({ row }) => (
      row.original.mfaEnabled ? 
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 font-normal">Enabled</Badge> : 
        <Badge variant="outline" className="text-muted-foreground font-normal">Disabled</Badge>
    ),
  },
  {
    accessorKey: "assignedLicenses",
    header: "Licenses",
    cell: ({ row }) => <span>{row.original.assignedLicenses}</span>,
  },
  {
    accessorKey: "department",
    header: "Department",
    cell: ({ row }) => <span>{row.original.department || "—"}</span>,
  },
  {
    accessorKey: "lastSignIn",
    header: "Last Sign-In",
    cell: ({ row }) => <span>{formatDate(row.original.lastSignIn)}</span>,
  },
  {
    accessorKey: "accountEnabled",
    header: "Status",
    cell: ({ row }) => (
      row.original.accountEnabled ? 
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 font-normal">Active</Badge> : 
        <Badge variant="destructive" className="font-normal">Disabled</Badge>
    ),
  },
];

export function UsersTab() {
  const { data, isLoading, isFetching } = useGetM365Users();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const loading = isLoading || isFetching;

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const donutData = data ? [
    { name: "Members", value: data.memberUsers },
    { name: "Guests", value: data.guestUsers },
    { name: "Disabled", value: data.disabledUsers },
  ].filter(d => d.value > 0) : [];

  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data: data?.users || [],
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard title="Total Users" value={data?.totalUsers} loading={loading} />
        <KPICard title="Active Users" value={data?.activeUsers} loading={loading} />
        <KPICard title="Disabled Users" value={data?.disabledUsers} loading={loading} />
        <KPICard title="Guest Users" value={data?.guestUsers} loading={loading} />
        <KPICard title="MFA Enabled" value={data ? `${Math.round((data.mfaEnabled / (data.totalUsers || 1)) * 100)}%` : undefined} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">User Types</CardTitle>
            {!loading && donutData.length > 0 && (
              <CSVLink data={donutData} filename="user-types.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[250px]" /> : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={250} debounce={0}>
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} cornerRadius={2} paddingAngle={2} isAnimationActive={false} stroke="none">
                      {donutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={CHART_COLOR_LIST[index % CHART_COLOR_LIST.length]} />
                      ))}
                    </Pie>
                    <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)', stroke: 'none' }} isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4 mt-2">
                  {donutData.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CHART_COLOR_LIST[index % CHART_COLOR_LIST.length] }} />
                      <span className="text-muted-foreground">{entry.name}</span>
                      <span className="font-medium">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Users by Department</CardTitle>
            {!loading && data?.usersByDepartment && data.usersByDepartment.length > 0 && (
              <CSVLink data={data.usersByDepartment} filename="users-by-department.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                <Download className="w-3.5 h-3.5" />
              </CSVLink>
            )}
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[280px]" /> : (
              <ResponsiveContainer width="100%" height={280} debounce={0}>
                <BarChart data={data?.usersByDepartment || []} layout="vertical" margin={{ left: 40, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke={gridColor} />
                  <XAxis type="number" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <YAxis type="category" dataKey="department" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} width={100} />
                  <Tooltip isAnimationActive={false} cursor={false} />
                  <Bar dataKey="count" name="Users" fill={CHART_COLORS.blue} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="px-4 pt-4 pb-2">
          <CardTitle className="text-base">All Users</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="space-y-4">
              <Input
                placeholder="Search users..."
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
                          No results found.
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
        </CardContent>
      </Card>
    </div>
  );
}
