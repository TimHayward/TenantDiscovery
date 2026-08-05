import fsActual from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolated on-disk libSQL database, so the store really does create a file for
// the hardening hook to act on (see findingsStore.test.ts for the same idiom).
const dbPath = path.join(os.tmpdir(), `file-hardening-test-${process.pid}-${Date.now()}.db`);
process.env.METRIC_DB_PATH = dbPath;

// The two platform calls are stubbed rather than executed: chmod is a partial
// no-op on Windows and icacls does not exist off it, so neither branch could
// otherwise be asserted from a single host.
const execFileMock = vi.hoisted(() =>
  vi.fn((_file: string, _args: string[], callback: (err: Error | null, stdout: string) => void) => {
    callback(null, "");
  }),
);
const chmodMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const patched = { ...actual, execFile: execFileMock };
  return { ...patched, default: patched };
});

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const patched = { ...actual, chmod: chmodMock };
  return { ...patched, default: patched };
});

const { hardenFile } = await import("../fileHardening.js");
const { logger } = await import("../logger.js");

const realPlatform = process.platform;
const realUserDomain = process.env.USERDOMAIN;
const realUserName = process.env.USERNAME;

let openedClient: { close(): void } | null = null;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

/** A directory whose name contains a space, so quoting is exercised throughout. */
async function makeTempFile(name: string): Promise<string> {
  const dir = await fsActual.mkdtemp(path.join(os.tmpdir(), "td hardening "));
  const filePath = path.join(dir, name);
  await fsActual.writeFile(filePath, "{}");
  return filePath;
}

beforeEach(() => {
  execFileMock.mockClear();
  chmodMock.mockClear();
});

afterEach(() => {
  setPlatform(realPlatform);
  process.env.USERDOMAIN = realUserDomain;
  process.env.USERNAME = realUserName;
  vi.restoreAllMocks();
});

afterAll(async () => {
  // Windows keeps the file locked while the libSQL handle is open, so the
  // removal stays best-effort, as it is in findingsStore.test.ts.
  openedClient?.close();
  await fsActual.rm(dbPath, { force: true }).catch(() => undefined);
});

describe("hardenFile", () => {
  it("restricts the file to its owner with chmod 0600 on POSIX", async () => {
    setPlatform("linux");
    const filePath = await makeTempFile("onboarding-settings.json");

    await expect(hardenFile(filePath)).resolves.toBe(true);

    expect(chmodMock).toHaveBeenCalledWith(filePath, 0o600);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("grants the current user sole full control via icacls on Windows", async () => {
    setPlatform("win32");
    process.env.USERDOMAIN = "CORP";
    process.env.USERNAME = "ada lovelace";
    const filePath = await makeTempFile("onboarding-settings.json");

    await expect(hardenFile(filePath)).resolves.toBe(true);

    expect(chmodMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    const [command, args] = execFileMock.mock.calls[0];
    expect(command).toBe("icacls");
    // The path and the principal are discrete array elements: a space in either
    // must not be able to split into extra arguments.
    expect(args).toEqual([
      filePath,
      "/inheritance:r",
      "/grant:r",
      "CORP\\ada lovelace:F",
    ]);
    expect(args[0]).toContain(" ");
  });

  it("falls back to the bare username when the machine reports no domain", async () => {
    setPlatform("win32");
    delete process.env.USERDOMAIN;
    process.env.USERNAME = "ada";
    const filePath = await makeTempFile("metrics.db");

    await hardenFile(filePath);

    expect(execFileMock.mock.calls[0][1]).toEqual([
      filePath,
      "/inheritance:r",
      "/grant:r",
      "ada:F",
    ]);
  });

  it("warns and continues when the POSIX call fails, rather than refusing to start", async () => {
    setPlatform("linux");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    chmodMock.mockRejectedValueOnce(new Error("EPERM: operation not permitted"));

    await expect(hardenFile("/some/file")).resolves.toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns and continues when the Windows call fails, rather than refusing to start", async () => {
    setPlatform("win32");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    execFileMock.mockImplementationOnce((_file, _args, callback) => {
      callback(new Error("icacls exited with code 1"), "");
    });

    await expect(hardenFile("C:\\some\\file")).resolves.toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps the token and the secret out of the warning it emits", async () => {
    setPlatform("linux");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    chmodMock.mockRejectedValueOnce(new Error("EPERM"));

    await hardenFile("/some/file");

    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
  });
});

/**
 * Assert the file was restricted, whichever branch this host takes. The two
 * branches are covered individually above; these call-site tests run on the
 * real platform because libSQL resolves its native binary from
 * `process.platform` and cannot be loaded under a forged one.
 */
function expectHardened(filePath: string): void {
  if (process.platform === "win32") {
    expect(execFileMock.mock.calls.map((call) => call[1][0])).toContain(filePath);
  } else {
    expect(chmodMock).toHaveBeenCalledWith(filePath, 0o600);
  }
}

describe("the hardening hook at file-creation time", () => {
  it("is invoked on metrics.db once the store has created it", async () => {
    vi.resetModules();

    const metricStore = await import("../metricStore.js");
    openedClient = await metricStore.getClient();

    // The database exists on disk and was restricted to its owner.
    await expect(fsActual.access(dbPath)).resolves.toBeUndefined();
    expectHardened(dbPath);
  });

  it("is invoked on onboarding-settings.json every time it is written", async () => {
    const settingsPath = await makeTempFile("onboarding-settings.json");
    const previous = process.env.ONBOARDING_SETTINGS_PATH;
    process.env.ONBOARDING_SETTINGS_PATH = settingsPath;

    try {
      vi.resetModules();
      const setupConfig = await import("../setupConfig.js");

      await setupConfig.patchOnboardingSettings({ clientId: "app-a" });
      expectHardened(settingsPath);

      // A second save must re-apply it: the file is replaced by a rename.
      chmodMock.mockClear();
      execFileMock.mockClear();
      await setupConfig.patchOnboardingSettings({ clientSecret: "s3cret" });
      expectHardened(settingsPath);
    } finally {
      process.env.ONBOARDING_SETTINGS_PATH = previous;
      await fsActual.rm(path.dirname(settingsPath), { recursive: true, force: true });
    }
  });

  it("creates the settings temp file owner-only, leaving no world-readable window", async () => {
    const settingsPath = await makeTempFile("onboarding-settings.json");
    const previous = process.env.ONBOARDING_SETTINGS_PATH;
    process.env.ONBOARDING_SETTINGS_PATH = settingsPath;

    const writeFileSpy = vi.spyOn(fsActual, "writeFile");

    try {
      vi.resetModules();
      const setupConfig = await import("../setupConfig.js");
      await setupConfig.patchOnboardingSettings({ clientSecret: "s3cret" });

      const call = writeFileSpy.mock.calls.find(([target]) =>
        String(target).endsWith(".tmp"),
      );
      expect(call).toBeDefined();
      expect(call?.[2]).toMatchObject({ mode: 0o600 });
    } finally {
      process.env.ONBOARDING_SETTINGS_PATH = previous;
      await fsActual.rm(path.dirname(settingsPath), { recursive: true, force: true });
    }
  });
});
