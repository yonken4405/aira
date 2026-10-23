/**
 * Minimal cache primitives for the responder console (PRODUCT.md §5 - in-memory only).
 * Deliberately dependency-free and time-injectable so behavior is unit testable.
 */

export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

/** Time-boxed key/value cache. Expired entries are dropped on read. */
export function createTtlCache<T>(ttlMs: number, now: () => number = Date.now): TtlCache<T> {
  const entries = new Map<string, CacheEntry<T>>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

export interface InFlightTracker {
  /** Reuses the pending promise for `key` instead of starting a second request. */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  reset(): void;
  readonly size: number;
}

/** Collapses concurrent duplicate requests (e.g. two panels refreshing at once). */
export function createInFlightTracker(): InFlightTracker {
  const inFlight = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) {
        return existing as Promise<T>;
      }

      const promise = task().finally(() => {
        inFlight.delete(key);
      });

      inFlight.set(key, promise);
      return promise;
    },
    reset() {
      inFlight.clear();
    },
    get size() {
      return inFlight.size;
    },
  };
}
