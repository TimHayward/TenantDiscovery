import { describe, expect, it } from "vitest";
import { getRecommendedApplicationPermissions } from "../../routes/onboarding";
import { permissionsManifest } from "@workspace/permissions-manifest";

function requiredGraphAppPermissions(): string[] {
  return permissionsManifest.permissions
    .filter(
      (p) =>
        p.tier === "required" &&
        p.provider === "microsoft-graph" &&
        p.accessKind === "application",
    )
    .map((p) => p.name);
}

describe("getRecommendedApplicationPermissions", () => {
  const recommended = getRecommendedApplicationPermissions();

  it("includes the data-affecting permissions that were previously unsurfaced", () => {
    for (const name of [
      "RoleManagement.Read.Directory",
      "SecurityIncident.Read.All",
      "SecurityAlert.Read.All",
      "SharePointTenantSettings.Read.All",
    ]) {
      expect(recommended).toContain(name);
    }
  });

  it("never overlaps with the hard-gating required set", () => {
    const required = new Set(requiredGraphAppPermissions());
    for (const name of recommended) {
      expect(required.has(name)).toBe(false);
    }
  });

  it("excludes non-Graph external scopes (e.g. Defender) from the application list", () => {
    expect(recommended).not.toContain("https://api.security.microsoft.com/.default");
  });
});
