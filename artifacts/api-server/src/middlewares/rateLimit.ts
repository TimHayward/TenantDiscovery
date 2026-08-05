/**
 * A fixed-window counter held in process memory.
 *
 * Deliberately not a dependency: the only thing being rate limited is the
 * authentication check on a single-process server, where a fixed window is
 * enough to make guessing a 256-bit token pointless. It carries the usual
 * fixed-window caveat, namely up to `maxAttempts` in the tail of one window
 * and again at the head of the next, which is immaterial at this scale.
 */

export const DEFAULT_WINDOW_MS = 60_000;
export const DEFAULT_MAX_ATTEMPTS = 10;

/**
 * Ceiling on distinct keys held at once. An attacker rotating source addresses
 * would otherwise grow the map without bound; the oldest entries are evicted,
 * which costs them nothing they did not already have.
 */
export const DEFAULT_MAX_TRACKED_KEYS = 5_000;

export interface FixedWindowLimiterOptions {
  windowMs?: number;
  maxAttempts?: number;
  maxTrackedKeys?: number;
  /** Injectable clock, so tests need not wait out a window. */
  now?: () => number;
}

export interface RateLimitDecision {
  limited: boolean;
  /** Seconds until the current window ends. Zero when not limited. */
  retryAfterSeconds: number;
}

export interface FixedWindowLimiter {
  /** Whether `key` has already used up its attempts in the current window. */
  check(key: string): RateLimitDecision;
  /** Count one failed attempt against `key`. */
  recordFailure(key: string): void;
  /** Forget `key`, so a success does not leave earlier failures counting. */
  reset(key: string): void;
}

interface WindowState {
  windowStart: number;
  count: number;
}

export function createFixedWindowLimiter(
  options: FixedWindowLimiterOptions = {},
): FixedWindowLimiter {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS;
  const now = options.now ?? Date.now;

  const windows = new Map<string, WindowState>();

  function currentWindow(key: string, timestamp: number): WindowState | null {
    const state = windows.get(key);
    if (!state) return null;
    if (timestamp - state.windowStart >= windowMs) {
      windows.delete(key);
      return null;
    }
    return state;
  }

  function evictIfCrowded(timestamp: number): void {
    if (windows.size <= maxTrackedKeys) return;

    for (const [key, state] of windows) {
      if (timestamp - state.windowStart >= windowMs) windows.delete(key);
    }

    // Map iterates in insertion order, so this drops the least recently
    // started windows first.
    for (const key of windows.keys()) {
      if (windows.size <= maxTrackedKeys) break;
      windows.delete(key);
    }
  }

  return {
    check(key) {
      const timestamp = now();
      const state = currentWindow(key, timestamp);
      if (!state || state.count < maxAttempts) {
        return { limited: false, retryAfterSeconds: 0 };
      }

      const remainingMs = state.windowStart + windowMs - timestamp;
      return {
        limited: true,
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
      };
    },

    recordFailure(key) {
      const timestamp = now();
      const state = currentWindow(key, timestamp);
      if (state) {
        state.count += 1;
        return;
      }
      windows.set(key, { windowStart: timestamp, count: 1 });
      evictIfCrowded(timestamp);
    },

    reset(key) {
      windows.delete(key);
    },
  };
}
