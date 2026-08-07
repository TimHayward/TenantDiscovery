import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable";

interface Licence {
  displayName: string;
  assigned: number;
}

const columns: ColumnDef<Licence>[] = [
  { accessorKey: "displayName", header: "Licence" },
  { accessorKey: "assigned", header: "Assigned" },
];

// Deliberately not in any natural order, so a passing sort assertion cannot be
// satisfied by the input order.
const rows: Licence[] = [
  { displayName: "Power BI Pro", assigned: 31 },
  { displayName: "Exchange Online Plan 1", assigned: 11 },
  { displayName: "Microsoft 365 E3", assigned: 238 },
  { displayName: "Enterprise Mobility + Security E3", assigned: 55 },
];

/**
 * The rendered body rows, first column only, in the order the DOM has them.
 *
 * Asserting on order means reading the DOM in order. The header row is dropped
 * by taking rows from within the `rowgroup` that is not the header.
 */
function renderedNames(): string[] {
  const body = screen.getAllByRole("rowgroup")[1];
  return within(body)
    .getAllByRole("row")
    .map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

describe("DataTable", () => {
  /**
   * TanStack sorts a numeric column descending on the first click and a string
   * column ascending, which is the behaviour a reader wants ("who has the most"
   * / "find the name") but is not what one would guess. The expectations below
   * are written against that, not around it.
   */
  it("sorts by a column, reverses on a second click, and says so through aria-sort", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={rows} />);

    const header = screen.getByRole("button", { name: /Assigned/ });
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(renderedNames()).toEqual([
      "Power BI Pro",
      "Exchange Online Plan 1",
      "Microsoft 365 E3",
      "Enterprise Mobility + Security E3",
    ]);

    await user.click(header);
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(renderedNames()).toEqual([
      "Microsoft 365 E3",
      "Enterprise Mobility + Security E3",
      "Power BI Pro",
      "Exchange Online Plan 1",
    ]);

    await user.click(header);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(renderedNames()).toEqual([
      "Exchange Online Plan 1",
      "Power BI Pro",
      "Enterprise Mobility + Security E3",
      "Microsoft 365 E3",
    ]);
  });

  it("sorts from the keyboard, not only from the mouse", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={rows} />);

    const header = screen.getByRole("button", { name: /Licence/ });
    header.focus();
    await user.keyboard("{Enter}");

    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(renderedNames()[0]).toBe("Enterprise Mobility + Security E3");
  });

  /**
   * `globalFilter` is controlled by the parent, because the search input lives
   * outside the table. The harness below is the smallest thing that owns that
   * state, which is what a real tab does.
   */
  it("narrows the rendered rows to those matching the filter", async () => {
    function Filterable() {
      const [filter, setFilter] = useState("");
      return (
        <>
          <label htmlFor="search">Search</label>
          <input id="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <DataTable columns={columns} data={rows} globalFilter={filter} />
        </>
      );
    }

    const user = userEvent.setup();
    render(<Filterable />);
    expect(renderedNames()).toHaveLength(4);

    await user.type(screen.getByLabelText("Search"), "Online");

    expect(renderedNames()).toEqual(["Exchange Online Plan 1"]);

    // Filtering to nothing gives the empty message, not an empty table body.
    await user.clear(screen.getByLabelText("Search"));
    await user.type(screen.getByLabelText("Search"), "Visio");
    expect(screen.getByText("No data.")).toBeInTheDocument();
  });
});
