import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { createFixedWindowLimiter, type FixedWindowLimiter } from "./rateLimit.js";

/**
 * Paths served without a token, relative to the mount point (`/api`).
 *
 * The container health check calls `/api/healthz` with no credentials, and a
 * health probe that cannot run is a worse outcome than a liveness bit being
 * readable. `/healthz/with-metadata` is not exempt: it carries more than a
 * liveness bit and nothing probes it.
 */
const EXEMPT_PATHS = new Set(["/healthz"]);

export interface ApiAuthOptions {
  /**
   * Resolves the expected token. Async and called per request so a token
   * generated during onboarding takes effect without a restart.
   */
  getToken: () => Promise<string | null>;
  limiter?: FixedWindowLimiter;
}

/**
 * Constant-time comparison of two tokens of any length. Hashing first gives
 * `timingSafeEqual` the equal-length buffers it requires without leaking the
 * expected length through an early return.
 */
export function tokensMatch(presented: string, expected: string): boolean {
  const presentedDigest = createHash("sha256").update(presented, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function normalisePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "");
  return path;
}

/**
 * Require a bearer token on every `/api` route except the health probe.
 *
 * Mounted only when the server is bound off loopback, so the default
 * loopback deployment is unaffected. Failures are counted per client address
 * and answered with 429 once the window is used up, which is what keeps a
 * wrong token from being guessed at speed; a success clears the count.
 *
 * No branch of this function puts a token, presented or expected, into a
 * response body, a header or a log line.
 */
export function createApiAuth(options: ApiAuthOptions): RequestHandler {
  const limiter = options.limiter ?? createFixedWindowLimiter();

  const handler: RequestHandler = async (req, res, next) => {
    // A CORS preflight carries no Authorization header by design; rejecting it
    // would break the request it is asking about.
    if (req.method === "OPTIONS") return next();
    if (EXEMPT_PATHS.has(normalisePath(req.path))) return next();

    const client = req.ip ?? "unknown";

    const decision = limiter.check(client);
    if (decision.limited) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).json({ error: "Too many failed authentication attempts" });
      return;
    }

    let expected: string | null;
    try {
      expected = await options.getToken();
    } catch (err) {
      req.log?.error({ err }, "Could not read the API token");
      res.status(503).json({ error: "API authentication is unavailable" });
      return;
    }

    if (!expected) {
      // Fail closed: the binding demands a token and there is none to check
      // against. 503 rather than 401 because no credential would help.
      req.log?.error(
        "No API token is configured, but the server is bound off loopback. Complete onboarding on loopback or set API_AUTH_TOKEN.",
      );
      res.status(503).json({ error: "API authentication is not configured" });
      return;
    }

    const presented = extractBearerToken(req.header("authorization"));

    if (!presented || !tokensMatch(presented, expected)) {
      limiter.recordFailure(client);
      res.setHeader("WWW-Authenticate", 'Bearer realm="TenentDiscovery"');
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    limiter.reset(client);
    return next();
  };

  return handler;
}
