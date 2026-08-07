import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import type { IssueSummary } from "@/lib/collectionStatus";

const permissionIssue: IssueSummary = {
  kind: "permission",
  message: "Reading conditional access policies was refused.",
  count: 2,
  permissions: [{ name: "Policy.Read.All", accessKind: "application" }],
};

describe("CollapsibleSection", () => {
  it("starts closed, opens on a header click, and closes again", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection title="Summary">
        <p>Key metrics</p>
      </CollapsibleSection>,
    );

    // Closed is the absence of the children from the document, not a hidden
    // class: the component unmounts its content rather than styling it away.
    expect(screen.queryByText("Key metrics")).not.toBeInTheDocument();

    await user.click(screen.getByText("Summary"));
    expect(screen.getByText("Key metrics")).toBeInTheDocument();
    // With no `issue` prop there is no banner, open or shut.
    expect(screen.queryByText("Permission required")).not.toBeInTheDocument();
    expect(screen.queryByText("Collection error")).not.toBeInTheDocument();

    await user.click(screen.getByText("Summary"));
    expect(screen.queryByText("Key metrics")).not.toBeInTheDocument();
  });

  it("renders the status banner, the affected-source count and the permission to grant", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection title="Conditional Access" issue={permissionIssue}>
        <p>Policies</p>
      </CollapsibleSection>,
    );

    await user.click(screen.getByText("Conditional Access"));

    // The header marker and the banner both say "Permission required", so this
    // asserts on two, which is the point: an operator sees the state whether
    // the section is open or shut.
    expect(screen.getAllByText("Permission required")).toHaveLength(2);
    expect(
      screen.getByText("Reading conditional access policies was refused."),
    ).toBeInTheDocument();
    expect(screen.getByText("(2 sources affected)")).toBeInTheDocument();
    expect(screen.getByText("Policy.Read.All")).toBeInTheDocument();
    expect(screen.getByText("(application permission)")).toBeInTheDocument();
  });

  it("remembers its open state across a remount, keyed by storageKey", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <CollapsibleSection title="Summary" storageKey="overview-summary">
        <p>Key metrics</p>
      </CollapsibleSection>,
    );

    await user.click(screen.getByText("Summary"));
    expect(screen.getByText("Key metrics")).toBeInTheDocument();
    unmount();

    render(
      <CollapsibleSection title="Summary" storageKey="overview-summary">
        <p>Key metrics</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText("Key metrics")).toBeInTheDocument();
  });
});
