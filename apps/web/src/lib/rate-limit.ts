/**
 * Fixed-window in-memory rate limiter.
 *
 * Deliberately dependency-free and per-process: it blunts credential stuffing and
 * alert flooding on a single instance. A multi-instance deployment swaps this for a
 * shared store without touching the call sites.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitDecision;
  reset(): void;
}

export interface RateLimiterOptions {
  readonly capacity: number;
  readonly windowMs: number;
  readonly now?: () => number;
}

interface Window {
  count: number;
  resetAt: number;
}

const MAX_KEYS = 5_000;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();

  function prune(at: number): void {
    if (windows.size < MAX_KEYS) {
      return;
    }
    for (const [key, window] of windows) {
      if (window.resetAt <= at) {
        windows.delete(key);
      }
    }
  }

  return {
    consume(key) {
      const at = now();
      prune(at);

      const current = windows.get(key);
      if (!current || current.resetAt <= at) {
        windows.set(key, { count: 1, resetAt: at + options.windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      current.count += 1;
      if (current.count > options.capacity) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - at) / 1000)),
        };
      }

      return { allowed: true, retryAfterSeconds: 0 };
    },

    reset() {
      windows.clear();
    },
  };
}
