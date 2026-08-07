import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewTab } from "@/pages/tabs/OverviewTab";
import { endpoints, failure, ok, pending } from "@/test/handlers";
import { snapshot, withMetadata, withOverrides } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The four states every tab has, on one tab.
 *
 * This is the shape the other fifteen should follow: render the real tab
 * component, let the real generated hooks run, and vary only what the network
 * answers. Nothing here mocks `useGetM365OverviewWithMetadata`, so the test
 * fails if the generated client stops parsing what the server sends — which is
 * where a regression in this application actually lives.
 */

/** The KPI card carrying `title`, found through the title the operator reads. */
function kpiCard(title: string): HTMLElement {
  const label = screen.getByText(title);
  const card = label.closest("div");
  if (card === null) throw new Error(`No card around the KPI titled "${title}"`);
  return card;
}

describe("OverviewTab", () => {
  it("renders the tenant's figures from the API response", async () => {
    renderWithProviders(<OverviewTab />);

    expect(await screen.findByText("Total Users")).toBeInTheDocument();

    // 250 / 229 / 462 out of 600 / 92% are this profile's numbers. Reading them
    // off the fixture rather than repeating them keeps the assertion true when
    // the profile is revised, while still failing if the wrong field is shown.
    const overview = snapshot<{
      totalUsers: number;
      activeUsers: number;
      secureScore: number;
      secureScoreMax: number;
      mfaEnabledPercent: number;
    }>("m365-overview");

    expect(within(kpiCard("Total Users")).getByText(String(overview.totalUsers))).toBeInTheDocument();
    expect(
      within(kpiCard("Active Users")).getByText(String(overview.activeUsers)),
    ).toBeInTheDocument();
    expect(
      within(kpiCard("Secure Score")).getByText(
        `${overview.secureScore} / ${overview.secureScoreMax}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(kpiCard("MFA Coverage")).getByText(`${overview.mfaEnabledPercent}%`),
    ).toBeInTheDocument();
  });

  it("shows no figures at all while the requests are still in flight", async () => {
    server.use(pending(endpoints.overviewWithMetadata), pending(endpoints.licensesWithMetadata));

    renderWithProviders(<OverviewTab />);

    // The section renders, so the tab is not blank...
    expect(await screen.findByText("Summary")).toBeInTheDocument();
    // ...but no card has a title, a figure or the not-assessed placeholder yet.
    // A loading card that leaked a "--" would read as "we looked and found
    // nothing", which is a different and worse claim than "still looking".
    expect(screen.queryByText("Total Users")).not.toBeInTheDocument();
    expect(screen.queryByText("--")).not.toBeInTheDocument();
  });

  it("shows the error panel, not an empty tab, when the overview request fails", async () => {
    server.use(failure(endpoints.overviewWithMetadata, 500, "The metric store is unavailable."));

    renderWithProviders(<OverviewTab />);

    expect(await screen.findByText("Couldn't load the tenant overview")).toBeInTheDocument();
    // The message comes off the response body through the generated client's
    // ApiError, so this also proves the error path parses.
    expect(screen.getByText(/The metric store is unavailable\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
    expect(screen.queryByText("Total Users")).not.toBeInTheDocument();
  });

  it("shows the not-assessed placeholder when the licence response carries no licences", async () => {
    const licences = snapshot<Record<string, unknown>>("m365-licenses");
    server.use(
      ok(
        endpoints.licensesWithMetadata,
        withMetadata(withOverrides(licences, { licenses: [], partialData: false })),
      ),
    );

    renderWithProviders(<OverviewTab />);

    await screen.findByText("Total Users");

    // An empty licence list is not 0% utilisation. There is nothing to divide.
    await waitFor(() => {
      expect(within(kpiCard("License Utilization")).getByText("--")).toBeInTheDocument();
    });
    // The rest of the tab is unaffected: one empty response does not empty
    // the neighbouring cards.
    expect(within(kpiCard("Total Users")).getByText("250")).toBeInTheDocument();
  });
});
