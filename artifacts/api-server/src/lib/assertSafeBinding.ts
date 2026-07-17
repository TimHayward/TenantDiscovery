export interface SafeBindingEnv {
  ALLOW_REMOTE?: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/**
 * The API is unauthenticated and holds Graph credentials, so binding it
 * anywhere reachable off-box must be an explicit, acknowledged choice rather
 * than an accidental `HOST=0.0.0.0`. Kept pure (no logging/process exit) so
 * it can be unit-tested directly; the caller decides how to act on the throw.
 */
export function assertSafeBinding(host: string, env: SafeBindingEnv): void {
  if (isLoopbackHost(host)) return;
  if (env.ALLOW_REMOTE === "true") return;

  throw new Error(
    `Refusing to bind to non-loopback host "${host}": the API is unauthenticated and holds ` +
      `Microsoft Graph credentials. Set ALLOW_REMOTE=true to acknowledge the risk and proceed.`,
  );
}
