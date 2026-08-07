import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KPICard } from "@/components/KPICard";

/**
 * KPICard takes no data of its own, so it needs neither MSW nor the provider
 * wrapper. Plain `render` is right for a component like this; reach for
 * `renderWithProviders` only when something in the tree asks for a provider.
 */
describe("KPICard", () => {
  it("renders the title and the value it is given, including a genuine zero", () => {
    render(<KPICard title="Total Users" value={250} />);
    expect(screen.getByText("Total Users")).toBeInTheDocument();
    expect(screen.getByText("250")).toBeInTheDocument();

    render(<KPICard title="Guest Users" value={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("--")).not.toBeInTheDocument();
  });

  /**
   * The guard for backlog 5.8: a metric that was never assessed must not read
   * as a measured zero. `undefined` and `null` both have to reach the
   * placeholder, because a route that stops sending a field produces the first
   * and a route that sends it empty produces the second.
   */
  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("shows the not-assessed placeholder rather than a zero when the value is %s", (_label, value) => {
    render(<KPICard title="Shared Mailboxes" value={value} />);

    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
