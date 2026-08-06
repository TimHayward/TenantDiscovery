import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCollectionIssue, fetchResourceWithRetry, getAccessToken } from "../collectionIssues.js";
import { resetHostLimiters } from "../concurrency.js";
import { collectLicenses } from "../collectors/licenses.js";
import { collectSecurityEstate } from "../collectors/security.js";

// The retry and collector cases below drive the real fetch helper, which asks
// for an app-only token first. Only the credential exchange is stubbed; every
// other line of the helper runs unmodified.
vi.mock("@azure/identity", () => ({
  ClientSecretCredential: class {
    getToken(): Promise<{ token: string; expiresOnTimestamp: number }> {
      return Promise.resolve({ token: "test-token", expiresOnTimestamp: Date.now() + 3_600_000 });
    }
  },
}));

const TEST_SCOPE = "https://graph.microsoft.com/.default";
const TEST_URL = "https://graph.microsoft.com/v1.0/users";

const previousEnv = {
  settingsPath: process.env.ONBOARDING_SETTINGS_PATH,
  tenantId: process.env.AZURE_TENANT_ID,
  clientId: process.env.AZURE_CLIENT_ID,
  clientSecret: process.env.AZURE_CLIENT_SECRET,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Stub `fetch` with a handler that dispatches on the requested URL. */
function stubFetchByUrl(handler: (url: string) => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: unknown) => Promise.resolve(handler(String(input))));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  // Point the settings loader at a path that does not exist, so credentials come
  // from the environment and no real onboarding file is read.
  process.env.ONBOARDING_SETTINGS_PATH = path.join(os.tmpdir(), "tenant-collection-issues-test", "absent.json");
  process.env.AZURE_TENANT_ID = "tenant-a";
  process.env.AZURE_CLIENT_ID = "client-a";
  process.env.AZURE_CLIENT_SECRET = "secret-a";
  // Warm the per-scope token cache under real timers. Later cases run under
  // fake timers, where the loader's file access would otherwise never settle.
  await getAccessToken(TEST_SCOPE);
});

afterAll(() => {
  process.env.ONBOARDING_SETTINGS_PATH = previousEnv.settingsPath;
  process.env.AZURE_TENANT_ID = previousEnv.tenantId;
  process.env.AZURE_CLIENT_ID = previousEnv.clientId;
  process.env.AZURE_CLIENT_SECRET = previousEnv.clientSecret;
});

beforeEach(() => {
  resetHostLimiters();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.GRAPH_MAX_CONCURRENCY;
  delete process.env.DEFENDER_MAX_CONCURRENCY;
  resetHostLimiters();
});

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

describe("honouring a server-provided Retry-After", () => {
  it("waits the full sixty seconds Graph asked for rather than the thirty second backoff cap", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "60" } }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const pending = fetchResourceWithRetry(TEST_URL, TEST_SCOPE);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The previous Math.min(MAX_RETRY_DELAY_MS, retryAfter) would have retried
    // here, thirty seconds into a wait the server asked to be sixty.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const resp = await pending;
    expect(resp.status).toBe(200);
  });

  it("caps a server-provided wait at two minutes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "600" } }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const pending = fetchResourceWithRetry(TEST_URL, TEST_SCOPE);

    await vi.advanceTimersByTimeAsync(119_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await pending;
  });

  it("keeps the thirty second cap and the jitter for the computed backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const pending = fetchResourceWithRetry(TEST_URL, TEST_SCOPE);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // No Retry-After header, so the delay is the jittered backoff, which is
    // still capped at thirty seconds.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await pending;
  });
});

describe("collection issues from the collectors moved onto the shared helpers", () => {
  it("records a permission issue for subscribedSkus in the shape the dashboard reads", async () => {
    stubFetchByUrl(() => jsonResponse({ error: { message: "Insufficient privileges." } }, 403));

    const result = await collectLicenses();

    expect(result.collectionIssues).toHaveLength(1);
    expect(result.collectionIssues[0]).toEqual({
      source: "subscribedSkus",
      status: 403,
      category: "permission",
      message: "Insufficient privileges.",
      retryable: false,
      permissionRequired: true,
      requiredPermissions: undefined,
    });
    expect(result.permissionError).toBe(true);
    expect(result.partialData).toBe(true);
    expect(result.licenses).toEqual([]);
  });

  it("records an issue for the Defender machines request, which used to report only a status string", async () => {
    stubFetchByUrl((url) =>
      url.startsWith("https://api.security.microsoft.com/api/machines")
        ? jsonResponse({ error: { message: "Defender licence not found." } }, 402)
        : jsonResponse({ value: [] }),
    );

    const result = await collectSecurityEstate();
    const defenderIssues = result.collectionIssues.filter((issue) =>
      issue.source.startsWith("securityEstateDefenderMachines"),
    );

    expect(defenderIssues).toHaveLength(1);
    expect(defenderIssues[0]).toMatchObject({
      status: 402,
      category: "license",
      message: "Defender licence not found.",
      retryable: false,
      permissionRequired: false,
    });
    // The pre-existing diagnostic block is unchanged.
    expect(result.mdeStatus).toMatchObject({
      ok: false,
      status: 402,
      count: 0,
      error: "Defender licence not found.",
    });
  });
});

describe("device identity when the source id is absent", () => {
  const managedDevice = {
    deviceName: "KIOSK-RECEPTION-01",
    operatingSystem: "Windows",
    osVersion: "10.0.19045.4046",
    enrolledDateTime: "2024-02-11T09:14:00Z",
    complianceState: "compliant",
    lastSyncDateTime: "2026-08-06T07:00:00Z",
  };
  const mdeMachine = {
    computerDnsName: "kiosk-loading-bay.contoso.local",
    osPlatform: "Windows10",
    osVersion: "22H2",
    lastSeen: "2026-08-06T07:30:00Z",
  };

  function stubEstate(): void {
    stubFetchByUrl((url) => {
      if (url.startsWith("https://api.security.microsoft.com/api/machines")) {
        return jsonResponse({ value: [mdeMachine] });
      }
      if (url.includes("/deviceManagement/managedDevices")) {
        return jsonResponse({ value: [managedDevice] });
      }
      return jsonResponse({ value: [] });
    });
  }

  it("produces identical keys on two consecutive collections over identical data", async () => {
    stubEstate();
    const first = await collectSecurityEstate();
    resetHostLimiters();
    stubEstate();
    const second = await collectSecurityEstate();

    const firstIds = first.deviceList.map((d) => d.id);
    const secondIds = second.deviceList.map((d) => d.id);

    expect(firstIds).toHaveLength(2);
    expect(secondIds).toEqual(firstIds);
    expect(second.mdeDeviceInventory.map((d) => d.id)).toEqual(first.mdeDeviceInventory.map((d) => d.id));
    // The old Math.random() fallback produced a key of this shape too, so the
    // test would pass on shape alone. Equality between runs is the assertion
    // that matters, and this one confirms the keys are derived, not sourced.
    expect(firstIds.every((id) => /^(intune|mde):[0-9a-f]{32}$/.test(id))).toBe(true);
  });

  it("distinguishes two devices that differ only in the stable tuple", async () => {
    stubFetchByUrl((url) =>
      url.includes("/deviceManagement/managedDevices")
        ? jsonResponse({
            value: [managedDevice, { ...managedDevice, deviceName: "KIOSK-RECEPTION-02" }],
          })
        : jsonResponse({ value: [] }),
    );

    const result = await collectSecurityEstate();
    const ids = result.deviceList.map((d) => d.id);

    expect(new Set(ids).size).toBe(2);
  });

  it("excludes a device with nothing stable and records a collection note", async () => {
    stubFetchByUrl((url) =>
      url.includes("/deviceManagement/managedDevices")
        ? jsonResponse({ value: [{ operatingSystem: "Windows", complianceState: "compliant" }] })
        : jsonResponse({ value: [] }),
    );

    const result = await collectSecurityEstate();

    expect(result.deviceList).toHaveLength(0);
    const note = result.collectionIssues.find((issue) => issue.source === "securityEstateManagedDevices");
    expect(note?.message).toContain("no stable identity could be derived");
  });
});
