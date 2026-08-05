import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { permissionsManifest } from "@workspace/permissions-manifest";
import { createAppFixture, type AppFixture } from "../../__fixtures__/testApp.js";
import { makeFinding } from "../../__fixtures__/inMemoryStore.js";

let fixture: AppFixture;

beforeEach(async () => {
  fixture = await createAppFixture();
});

afterAll(async () => {
  await fixture.dispose();
});

const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";
const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

function requiredGraphApplicationPermissions(): string[] {
  return permissionsManifest.permissions
    .filter((p) => p.tier === "required" && p.provider === "microsoft-graph" && p.accessKind === "application")
    .map((p) => p.name);
}

/**
 * Answer the two Graph calls the onboarding status check makes: the Graph
 * service principal (app role id to name) and the target app registration
 * (which role ids it has been granted).
 */
function stubGraphWithGrantedPermissions(granted: string[]): void {
  const roles = requiredGraphApplicationPermissions().map((name, index) => ({
    id: `role-${index}`,
    value: name,
    isEnabled: true,
  }));
  const grantedIds = roles.filter((r) => granted.includes(r.value)).map((r) => ({ id: r.id, type: "Role" }));

  fixture.onGraphJson((url) => {
    if (url.includes("/servicePrincipals")) {
      return { data: { value: [{ appRoles: roles }] }, issue: null };
    }
    return {
      data: {
        value: [
          {
            appId: CLIENT_ID,
            displayName: "TenentDiscovery",
            requiredResourceAccess: [{ resourceAppId: GRAPH_APP_ID, resourceAccess: grantedIds }],
          },
        ],
      },
      issue: null,
    };
  });
}

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  await fs.writeFile(
    path.join(fixture.settingsDir, "onboarding-settings.json"),
    JSON.stringify(settings, null, 2),
    "utf-8",
  );
}

describe("GET /api/healthz", () => {
  it("reports ok without touching any store or credential", async () => {
    const res = await request(fixture.app).get("/api/healthz").expect(200);

    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    // helmet is mounted before the router, so its headers apply to every route.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    // No CORS_ALLOWED_ORIGINS is set, so nothing may read this cross-origin.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("carries evidence metadata on the with-metadata variant", async () => {
    const res = await request(fixture.app).get("/api/healthz/with-metadata").expect(200);

    expect(res.body.data).toEqual({ status: "ok" });
    expect(res.body.metadataVersion).toBe("1.0");
    expect(res.body.fieldMetadata.status).toEqual({
      evidenceStatus: "apiBacked",
      confidenceLabel: "high",
      sourceLabel: "API health check",
    });
  });

  it("returns 404 for a path the router does not serve", async () => {
    await request(fixture.app).get("/api/not-a-route").expect(404);
  });
});

describe("onboarding gating", () => {
  it("asks for onboarding when nothing is configured, and says why", async () => {
    const res = await request(fixture.app).get("/api/onboarding/status").expect(200);

    expect(res.body.needsOnboarding).toBe(true);
    expect(res.body.targetClientId).toBeNull();
    expect(res.body.permissionCheckSucceeded).toBe(false);
    expect(res.body.permissionCheckError).toContain("No client ID is configured");
    expect(res.body.requiredApplicationPermissions.length).toBeGreaterThan(0);
  });

  it("clears onboarding once every required permission is granted", async () => {
    await writeSettings({ clientId: CLIENT_ID, tenantId: "tenant-1", setupComplete: true });
    stubGraphWithGrantedPermissions(requiredGraphApplicationPermissions());

    const res = await request(fixture.app).get("/api/onboarding/status").expect(200);

    expect(res.body.needsOnboarding).toBe(false);
    expect(res.body.missingRequiredPermissions).toEqual([]);
    expect(res.body.targetAppDisplayName).toBe("TenentDiscovery");
    expect(res.body.permissionCheckSucceeded).toBe(true);
  });

  it("keeps an established tenant out of onboarding when the permission check itself fails", async () => {
    await writeSettings({ clientId: CLIENT_ID, setupComplete: true });
    fixture.onGraphJson(() => ({
      data: null,
      issue: {
        source: "onboarding:graph-service-principal",
        status: 429,
        category: "throttled",
        message: "Graph returned 429",
        retryable: true,
        permissionRequired: false,
      },
    }));

    const res = await request(fixture.app).get("/api/onboarding/status").expect(200);

    // A transient Graph failure must not bounce a working tenant to onboarding.
    expect(res.body.permissionCheckSucceeded).toBe(false);
    expect(res.body.needsOnboarding).toBe(false);
  });

  it("re-triggers onboarding for a newly-missing permission outside the acknowledged set", async () => {
    const required = requiredGraphApplicationPermissions();
    await writeSettings({
      clientId: CLIENT_ID,
      setupComplete: true,
      acknowledgedMissingPermissions: [required[0]],
    });
    // Two are missing; only one of them was acknowledged.
    stubGraphWithGrantedPermissions(required.slice(2));

    const res = await request(fixture.app).get("/api/onboarding/status").expect(200);

    expect(res.body.missingRequiredPermissions).toEqual([required[0], required[1]].sort());
    expect(res.body.needsOnboarding).toBe(true);
    expect(res.body.canContinueWithMissingPermissions).toBe(true);
  });

  it("never returns the stored client secret, only whether one is held", async () => {
    await writeSettings({ clientId: CLIENT_ID, clientSecret: "super-secret-value", setupComplete: true });

    const res = await request(fixture.app).get("/api/onboarding/setup").expect(200);

    expect(res.body.hasClientSecret).toBe(true);
    expect(res.body.clientSecret).toBe("***REDACTED***");
    expect(JSON.stringify(res.body)).not.toContain("super-secret-value");
  });

  it("serves data routes to an ungated request while onboarding is incomplete", async () => {
    // The API does not enforce onboarding: the flag is advisory and the
    // dashboard router acts on it. The API is unauthenticated and loopback-only
    // by design, so gating here would add no protection. Encoded so that a
    // change to either half of that arrangement is a deliberate decision.
    const status = await request(fixture.app).get("/api/onboarding/status").expect(200);
    expect(status.body.needsOnboarding).toBe(true);

    fixture.setFindings([makeFinding("identity.globalAdminCount")]);
    await fixture.findingsStore.regenerateFindings();

    const findings = await request(fixture.app).get("/api/m365/findings").expect(200);
    expect(findings.body.total).toBe(1);

    await request(fixture.app).get("/api/healthz").expect(200);
  });
});

describe("the error handler", () => {
  it("does not leak a stack trace or an internal path when a request throws unexpectedly", async () => {
    // A malformed JSON body makes express.json() throw, which reaches the
    // app-level error handler rather than any route's own try/catch.
    const res = await request(fixture.app)
      .patch("/api/m365/findings/identity.globalAdminCount")
      .set("Content-Type", "application/json")
      .send('{"status": "acknowledged"')
      .expect(500);

    expect(res.body).toEqual({ error: "Internal server error" });

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toMatch(/SyntaxError|JSON/i);
    expect(serialised).not.toMatch(/\bat [\w$.]+ \(/); // no stack frames
    expect(serialised).not.toMatch(/[a-zA-Z]:[\\/]|\/home\/|node_modules|[\\/]src[\\/]/);
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("keeps the process serving after an unexpected throw", async () => {
    await request(fixture.app)
      .patch("/api/m365/findings/identity.globalAdminCount")
      .set("Content-Type", "application/json")
      .send("not json at all")
      .expect(500);

    await request(fixture.app).get("/api/healthz").expect(200);
  });
});
