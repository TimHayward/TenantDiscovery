import { useState, type CSSProperties, type KeyboardEvent } from "react";
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
import { Button } from "@/components/ui/button";

/**
 * Header-cell accessibility props for bespoke sortable tables that can't
 * migrate into DataTable (expandable drill-downs etc.) — same keyboard and
 * aria-sort treatment as DataTable's own headers.
 */
export function sortableHeadA11yProps(
  sorted: "asc" | "desc" | false,
  toggle: () => void,
): {
  role: "button";
  tabIndex: number;
  "aria-sort": "ascending" | "descending" | "none";
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
} {
  return {
    role: "button",
    tabIndex: 0,
    "aria-sort": sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none",
    onClick: toggle,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    },
  };
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  /** Message shown when there are no rows. */
  emptyMessage?: string;
  /** When set, enables pagination at this page size and renders a footer. */
  pageSize?: number;
  /** Controlled global filter value (the search input lives in the parent). */
  globalFilter?: string;
  /** Initial sort state. */
  initialSorting?: SortingState;
  /** Row noun used in the pagination footer ("results" by default). */
  rowNoun?: string;
  /** When set, rows become interactive (click + Enter/Space, role/tabIndex). */
  onRowClick?: (row: T) => void;
  /** Optional per-row className (e.g. highlight a selected row). */
  rowClassName?: (row: T) => string;
  /** Optional per-row inline style (e.g. a computed highlight tint). */
  rowStyle?: (row: T) => CSSProperties | undefined;
}

/**
 * Shared sortable/paginated table. Promoted from SecurityTab's `renderTable`
 * and the ~8 copy-pasted TanStack blocks so sorting, pagination, empty state,
 * the sort-caret glyph, and header accessibility are defined once.
 *
 * Accessibility: sortable headers are keyboard-operable (Enter/Space) with
 * `role="button"`, `tabIndex`, and `aria-sort`.
 */
export function DataTable<T>({
  columns,
  data,
  emptyMessage = "No data.",
  pageSize,
  globalFilter,
  initialSorting = [],
  rowNoun = "results",
  onRowClick,
  rowClassName,
  rowStyle,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: globalFilter ?? "" },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(pageSize
      ? { getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize } } }
      : {}),
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-3">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={`whitespace-nowrap ${canSort ? "cursor-pointer select-none" : ""}`}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      onKeyDown={
                        canSort
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                header.column.toggleSorting();
                              }
                            }
                          : undefined
                      }
                      role={canSort ? "button" : undefined}
                      tabIndex={canSort ? 0 : undefined}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : canSort ? "none" : undefined}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: " ↑", desc: " ↓" }[sorted as string] ?? null}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={`${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row.original) ?? ""}`}
                  style={rowStyle?.(row.original)}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row.original);
                          }
                        }
                      : undefined
                  }
                  role={onRowClick ? "button" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={table.getAllColumns().length} className="h-16 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pageSize && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing{" "}
            {table.getState().pagination.pageIndex * table.getState().pagination.pageSize +
              (table.getFilteredRowModel().rows.length > 0 ? 1 : 0)}{" "}
            to{" "}
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length,
            )}{" "}
            of {table.getFilteredRowModel().rows.length} {rowNoun}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
