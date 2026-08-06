/**
 * Per-host concurrency limiting for outbound collection requests.
 *
 * Bounded retry with `Retry-After` (see `fetchResourceWithRetry`) copes with
 * being throttled. It does not stop the collectors causing the throttling. A
 * background refresh fans out nineteen collection tasks, several of which issue
 * one request per discovered principal or device, so a tenant with a few
 * thousand principals produces a self-inflicted 429 storm: every request is
 * throttled, every request then retries, and the refresh degrades into partial
 * data with a page of collection issues.
 *
 * Each host is given its own budget, so saturating Microsoft Graph cannot
 * starve Defender for Endpoint and vice versa. The limiter is applied inside
 * the shared fetch helpers rather than at the call sites, because a limiter a
 * collector has to remember to use is a limiter the next collector will forget.
 */

/**
 * Concurrent requests allowed per host when nothing is configured. Eight is
 * comfortably below the point at which Graph starts issuing 429s for a single
 * app registration, while still keeping the nineteen collection tasks
 * overlapping rather than serialised.
 */
const DEFAULT_MAX_CONCURRENCY = 8;

/**
 * Hosts whose budget is tunable. A host that is not listed here gets
 * `DEFAULT_MAX_CONCURRENCY` and no environment override, which is deliberate:
 * every host the collectors reach today is one of these, and an unrecognised
 * host is more likely to be a mistake than something worth tuning.
 */
const HOST_LIMIT_VARIABLES: Record<string, string> = {
  "graph.microsoft.com": "GRAPH_MAX_CONCURRENCY",
  "api.securitycenter.microsoft.com": "DEFENDER_MAX_CONCURRENCY",
  "api.security.microsoft.com": "DEFENDER_MAX_CONCURRENCY",
};

/**
 * A counting semaphore over one host's request budget.
 *
 * Waiters are served first in, first out, so a collector that queued early
 * cannot be starved by one that fans out later.
 */
class HostSemaphore {
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  /** Take a permit, waiting if the host is at its ceiling. */
  async acquire(): Promise<() => void> {
    if (this.inFlight < this.limit) {
      this.inFlight += 1;
    } else {
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    }
    return this.createRelease();
  }

  /**
   * Give a permit back. The returned function is idempotent: releasing twice
   * would let the host exceed its ceiling, which is the failure the limiter
   * exists to prevent.
   */
  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) {
        // Hand the permit straight to the next waiter. `inFlight` is unchanged
        // because the waiter takes the slot this caller is giving up;
        // decrementing and letting the waiter re-increment would open a window
        // in which a third caller could slip past the ceiling.
        next();
        return;
      }
      this.inFlight -= 1;
    };
  }
}

const limiters = new Map<string, HostSemaphore>();

function readConfiguredLimit(variableName: string | undefined): number {
  if (!variableName) return DEFAULT_MAX_CONCURRENCY;
  const configured = Number(process.env[variableName]);
  if (!Number.isFinite(configured)) return DEFAULT_MAX_CONCURRENCY;
  // A ceiling of zero would deadlock every collector, so the floor is one.
  return Math.max(1, Math.floor(configured));
}

/** The configured ceiling for a host, after defaulting and clamping. */
export function getHostConcurrencyLimit(host: string): number {
  return readConfiguredLimit(HOST_LIMIT_VARIABLES[host.toLowerCase()]);
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    // A malformed URL still needs a budget. Put every one of them in the same
    // bucket rather than granting an unbounded free pass.
    return "";
  }
}

function limiterFor(host: string): HostSemaphore {
  const existing = limiters.get(host);
  if (existing) return existing;
  const created = new HostSemaphore(getHostConcurrencyLimit(host));
  limiters.set(host, created);
  return created;
}

/**
 * Run `request` while holding one of the target host's permits.
 *
 * The permit covers the whole call, including any `Retry-After` wait inside it.
 * That is intentional: a host that has asked us to slow down should see fewer
 * concurrent requests while it recovers, not the same number. The cost is that
 * a long `Retry-After` occupies a slot, which is why the budget is per host and
 * a throttled Graph cannot hold up Defender collection.
 *
 * `finally` releases the permit, so a rejected request does not leak one. A
 * limiter that leaked permits on error would eventually deadlock the refresh,
 * which is worse than the throttling it is there to avoid.
 *
 * Calls must not nest: acquiring a second permit for the same host while
 * holding one would deadlock once the ceiling is reached.
 */
export async function withHostLimit<T>(url: string, request: () => Promise<T>): Promise<T> {
  const release = await limiterFor(hostFromUrl(url)).acquire();
  try {
    return await request();
  } finally {
    release();
  }
}

/**
 * Drop every cached limiter so the next request rereads the environment.
 *
 * Exported for tests, which vary `GRAPH_MAX_CONCURRENCY` between cases. Calling
 * this while permits are outstanding abandons their bookkeeping, so it has no
 * legitimate use at runtime.
 */
export function resetHostLimiters(): void {
  limiters.clear();
}
