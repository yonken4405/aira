import { describe, expect, it } from 'vitest';

import { createInFlightTracker, createTtlCache } from '../src/lib/cache';

describe('createTtlCache', () => {
  it('serves values until the TTL elapses, then drops them', () => {
    const clock = { now: 1_000 };
    const cache = createTtlCache<string>(10_000, () => clock.now);

    cache.set('incidents', 'v1');
    expect(cache.get('incidents')).toBe('v1');

    clock.now += 9_999;
    expect(cache.get('incidents')).toBe('v1');

    clock.now += 1;
    expect(cache.get('incidents')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('supports delete, clear and size', () => {
    const cache = createTtlCache<number>(60_000, () => 0);

    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);

    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('createInFlightTracker', () => {
  it('collapses concurrent calls for the same key into one task', async () => {
    const tracker = createInFlightTracker();
    let calls = 0;

    const task = async (): Promise<string> => {
      calls += 1;
      return 'payload';
    };

    const [first, second] = await Promise.all([
      tracker.run('incidents', task),
      tracker.run('incidents', task),
    ]);

    expect(calls).toBe(1);
    expect(first).toBe('payload');
    expect(second).toBe('payload');
    expect(tracker.size).toBe(0);
  });

  it('starts a new task after the previous one settles', async () => {
    const tracker = createInFlightTracker();
    let calls = 0;

    const task = async (): Promise<number> => {
      calls += 1;
      return calls;
    };

    await tracker.run('incidents', task);
    await tracker.run('incidents', task);

    expect(calls).toBe(2);
  });

  it('keeps different keys independent and clears failures from the map', async () => {
    const tracker = createInFlightTracker();

    const failure = tracker.run('a', async () => {
      throw new Error('boom');
    });
    const success = tracker.run('b', async () => 'ok');

    await expect(failure).rejects.toThrow('boom');
    await expect(success).resolves.toBe('ok');
    expect(tracker.size).toBe(0);
  });
});
