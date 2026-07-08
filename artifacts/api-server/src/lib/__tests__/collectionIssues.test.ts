import { describe, expect, it } from "vitest";
import { createCollectionIssue } from "../collectionIssues.js";

describe("createCollectionIssue requiredPermissions", () => {
  it("attaches resolved permissions for a 403 permission issue", () => {
    const issue = createCollectionIssue("secureScores", 403, "Forbidden", ["SecurityEvents.Read.All"]);
    expect(issue.category).toBe("permission");
    expect(issue.requiredPermissions).toEqual([
      { name: "SecurityEvents.Read.All", accessKind: "application" },
    ]);
  });

  it("attaches resolved permissions for a 401 permission issue", () => {
    const issue = createCollectionIssue("domains", 401, "Unauthorized", ["Directory.Read.All"]);
    expect(issue.category).toBe("permission");
    expect(issue.requiredPermissions).toEqual([
      { name: "Directory.Read.All", accessKind: "application" },
    ]);
  });

  it("does not attach permissions for a non-permission category (404)", () => {
    const issue = createCollectionIssue("getMicrosoft365CopilotUserCounts(D30)", 404, "Not found", ["Reports.Read.All"]);
    expect(issue.category).toBe("notFound");
    expect(issue.requiredPermissions).toBeUndefined();
  });

  it("falls back to accessKind application for a name not in the manifest", () => {
    const issue = createCollectionIssue("someSource", 403, "Forbidden", ["Not.A.Real.Permission"]);
    expect(issue.requiredPermissions).toEqual([
      { name: "Not.A.Real.Permission", accessKind: "application" },
    ]);
  });

  it("leaves requiredPermissions undefined when no names are passed", () => {
    const issue = createCollectionIssue("someSource", 403, "Forbidden");
    expect(issue.requiredPermissions).toBeUndefined();
  });
});
