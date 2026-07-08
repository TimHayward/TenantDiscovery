import { describe, expect, it, vi, beforeEach } from "vitest";
import { collectAdoption } from "../collectors/adoption.js";
import { createCollectionIssue } from "../collectionIssues.js";

const fetchGraphTextMock = vi.fn();

vi.mock("../collectionIssues.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../collectionIssues.js")>();
  return {
    ...actual,
    fetchGraphText: (url: string, source: string, requiredPermissionNames?: string[]) =>
      fetchGraphTextMock(url, source, requiredPermissionNames),
  };
});

function okResult() {
  return { text: "", issue: null };
}

beforeEach(() => {
  fetchGraphTextMock.mockReset();
  fetchGraphTextMock.mockImplementation((_url: string, source: string) => {
    if (source.startsWith("getMicrosoft365CopilotUserCounts")) return okResult();
    return okResult();
  });
});

describe("collectAdoption Copilot handling", () => {
  it("demotes a Copilot 404 to a collection note instead of an error", async () => {
    fetchGraphTextMock.mockImplementation((_url: string, source: string) => {
      if (source.startsWith("getMicrosoft365CopilotUserCounts")) {
        return {
          text: null,
          issue: createCollectionIssue(source, 404, "Resource not found for the segment 'getMicrosoft365CopilotUserCounts'"),
        };
      }
      return okResult();
    });

    const result = await collectAdoption();

    expect(result.collectionIssues.some((i) => i.source.startsWith("getMicrosoft365CopilotUserCounts"))).toBe(false);
    expect(result.collectionNotes.some((n) => n.toLowerCase().includes("copilot"))).toBe(true);
    expect(result.partialData).toBe(false);
    expect(result.copilotAdoption).toBeNull();
  });

  it("surfaces a Copilot 403 as a genuine permission issue", async () => {
    fetchGraphTextMock.mockImplementation((_url: string, source: string, requiredPermissionNames?: string[]) => {
      if (source.startsWith("getMicrosoft365CopilotUserCounts")) {
        return {
          text: null,
          issue: createCollectionIssue(source, 403, "Forbidden", requiredPermissionNames),
        };
      }
      return okResult();
    });

    const result = await collectAdoption();

    const copilotIssue = result.collectionIssues.find((i) => i.source.startsWith("getMicrosoft365CopilotUserCounts"));
    expect(copilotIssue).toBeDefined();
    expect(copilotIssue?.category).toBe("permission");
    expect(copilotIssue?.requiredPermissions).toEqual([{ name: "Reports.Read.All", accessKind: "application" }]);
    expect(result.partialData).toBe(true);
    expect(result.permissionError).toBe(true);
  });
});
