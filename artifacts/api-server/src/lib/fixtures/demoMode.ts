/**
 * Demonstration mode: the switch, and the rules about what it is allowed to do.
 *
 * `DEMO_MODE=<profile>` puts the server into a state where every metric
 * snapshot comes from a recorded fixture under `fixtures/<profile>/` and no
 * outbound call to Microsoft is possible. The profile name is part of a
 * filesystem path, so it is validated here rather than at each use.
 *
 * When `DEMO_MODE` is unset every function in this module is inert and the
 * server behaves exactly as it did before demonstration mode existed.
 */

/**
 * A profile name is a directory name under `fixtures/`. Restricting it to
 * lower-case letters, digits and hyphens is what stops `DEMO_MODE=../../etc`
 * reading a file outside the fixture tree.
 */
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class DemoModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoModeError";
  }
}

/**
 * The configured profile name, or null when demonstration mode is off.
 *
 * Read from the environment on every call rather than cached, so a test can set
 * and clear `DEMO_MODE` around a case without reloading the module.
 */
export function getDemoProfile(): string | null {
  const raw = process.env.DEMO_MODE?.trim();
  if (!raw) return null;
  if (!PROFILE_NAME_PATTERN.test(raw)) {
    throw new DemoModeError(
      `DEMO_MODE="${raw}" is not a valid fixture profile name. ` +
        "Use lower-case letters, digits and hyphens, matching a directory under fixtures/.",
    );
  }
  return raw;
}

export function isDemoMode(): boolean {
  return getDemoProfile() !== null;
}

/**
 * Refuse an outbound call to Microsoft.
 *
 * Demonstration mode exists so the product can be shown without a tenant. A
 * request that escaped to Graph would either fail confusingly or, worse,
 * succeed against whatever credentials happened to be lying around and mix real
 * tenant data into a demonstration. Both are worth an exception.
 */
export function assertNoOutboundCallsInDemoMode(what: string): void {
  const profile = getDemoProfile();
  if (profile === null) return;
  throw new DemoModeError(
    `Refused ${what} because the server is running in demonstration mode (DEMO_MODE=${profile}). ` +
      "Demonstration data comes from a recorded fixture and never from Microsoft Graph.",
  );
}
