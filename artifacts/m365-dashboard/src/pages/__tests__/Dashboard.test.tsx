import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Switch } from "wouter";
import { describe, expect, it } from "vitest";
import Dashboard from "@/pages/Dashboard";
import { TAB_ROUTE_PATTERN, isTabId } from "@/lib/tabRoutes";
import { renderWithProviders } from "@/test/render";
import { observedRequestsTo } from "@/test/server";

/**
 * The shell: tab keep-alive, and the one header control that issues a request.
 *
 * `App.tsx` is not rendered, because importing it installs a module-scope
 * `popstate` listener that reloads the document — see the comment at the top of
 * that file. The route below is the same single `/tab/:tab` route `App.tsx`
 * declares, using the same exported pattern, so a tab change re-renders
 * `Dashboard` rather than remounting it. That property is what the keep-alive
 * depends on, so it has to be reproduced rather than bypassed.
 */
function DashboardRoutes() {
  return (
    <Switch>
      <Route path={TAB_ROUTE_PATTERN}>
        {(params) => (isTabId(params.tab) ? <Dashboard tab={params.tab} /> : null)}
      </Route>
    </Switch>
  );
}

// Text that appears on exactly one tab, so "is it still there" is answerable.
const OVERVIEW_MARKER = "M365 Service Health Status";
const LICENSES_MARKER = "Hide free/developer SKUs";

describe("Dashboard", () => {
  /**
   * The guard for T09's keep-alive.
   *
   * Two things are asserted, because either alone can pass while the behaviour
   * is broken. The first tab is still in the document, so it was not unmounted;
   * and it has not asked for its data a second time, so it was not remounted
   * and re-fetched behind a new mount. The query client in these tests has a
   * zero `staleTime` and a zero `gcTime`, so a remount would certainly refetch.
   *
   * What is *not* asserted is that the inactive tab is invisible. The hiding is
   * a Tailwind `hidden` class, and no stylesheet is loaded in jsdom, so nothing
   * in the test environment can tell visible from hidden. Asserting on the
   * class name instead would be asserting on the implementation.
   */
  it("keeps a visited tab mounted, and does not refetch it, when you leave and return", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardRoutes />, { path: "/tab/overview" });

    // Waiting for a *rendered figure* rather than for the section heading is
    // what makes the request count below deterministic: the heading appears as
    // soon as the tab mounts, which can be before its first request has left.
    expect(await screen.findByText("Total Users")).toBeInTheDocument();
    expect(observedRequestsTo("GET", "/api/m365/overview/with-metadata")).toHaveLength(1);

    await user.click(screen.getByRole("link", { name: "Licenses" }));
    expect(await screen.findByText(LICENSES_MARKER)).toBeInTheDocument();
    expect(screen.getByText(OVERVIEW_MARKER)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Overview" }));
    expect(screen.getByText(OVERVIEW_MARKER)).toBeInTheDocument();
    expect(screen.getByText(LICENSES_MARKER)).toBeInTheDocument();

    // A remount would have put the cards back into their loading state, in
    // which no card renders a title, and would have asked for the data again.
    expect(screen.getByText("Total Users")).toBeInTheDocument();
    expect(observedRequestsTo("GET", "/api/m365/overview/with-metadata")).toHaveLength(1);
  });

  it("keeps per-tab state across a tab change", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardRoutes />, { path: "/tab/overview" });
    await screen.findByText("Total Users");

    // The licence tab's free/developer SKU filter is plain component state: it
    // is not in the URL, not in React Query and not in localStorage, so it
    // survives a tab change only if the tab is never unmounted. A section's
    // open/closed state would have been a weaker choice, because that one is
    // persisted and would come back after a remount too.
    await user.click(screen.getByRole("link", { name: "Licenses" }));
    const hideFree = await screen.findByRole("switch", { name: "Hide free/developer SKUs" });
    expect(hideFree).toBeChecked();
    await user.click(hideFree);
    expect(hideFree).not.toBeChecked();

    await user.click(screen.getByRole("link", { name: "Overview" }));
    await user.click(screen.getByRole("link", { name: "Licenses" }));

    expect(screen.getByRole("switch", { name: "Hide free/developer SKUs" })).not.toBeChecked();
  });

  /**
   * The request, not a spy. A spy on `postM365Refresh` would pass even if the
   * generated client sent it to the wrong path or with the wrong method.
   */
  it("posts to the collection endpoint when Refresh Data is pressed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardRoutes />, { path: "/tab/overview" });

    await screen.findByText(OVERVIEW_MARKER);
    expect(observedRequestsTo("POST", "/api/m365/refresh")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Refresh Data/ }));

    await waitFor(() => {
      expect(observedRequestsTo("POST", "/api/m365/refresh")).toHaveLength(1);
    });
    const [request] = observedRequestsTo("POST", "/api/m365/refresh");
    expect(new URL(request.url).search).toBe("");
  });

  /**
   * The export entries are plain anchors to server routes, so the browser
   * navigates and no `fetch` is issued. jsdom does not navigate, which means
   * MSW never sees these and there is no request to assert on: the address is
   * the whole of the behaviour. See the report for the change that would make
   * this assertable the same way the refresh button is.
   */
  it("offers each export at the address the server serves it from", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardRoutes />, { path: "/tab/overview" });

    await screen.findByText(OVERVIEW_MARKER);
    await user.click(screen.getByRole("button", { name: /^Export/ }));

    expect(screen.getByRole("link", { name: "Findings (CSV)" })).toHaveAttribute(
      "href",
      "/api/m365/export/findings.csv",
    );
    expect(screen.getByRole("link", { name: "Evidence pack (Excel)" })).toHaveAttribute(
      "href",
      "/api/m365/export/evidence.xlsx",
    );
    // The HTML report opens in a tab of its own, and must carry the opener
    // protection that goes with it.
    const html = screen.getByRole("link", { name: "Executive summary (HTML)" });
    expect(html).toHaveAttribute("href", "/api/m365/export/executive.html");
    expect(html).toHaveAttribute("target", "_blank");
    expect(html).toHaveAttribute("rel", "noopener noreferrer");
  });
});
