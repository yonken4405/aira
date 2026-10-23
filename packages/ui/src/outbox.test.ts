import { beforeEach, describe, expect, it } from 'vitest';

import { MockMeshTransport, type MeshFrame } from './mesh';
import { SosOutbox, type OutboxSnapshot } from './outbox';
import { buildSosPayload } from './payload';

const sunog = buildSosPayload('SUNOG', 10.3157, 123.8854);
const baha = buildSosPayload('BAHA', 10.3157, 123.8854);

let clock = 1_000;
const now = () => clock;

beforeEach(() => {
  clock = 1_000;
});

describe('SosOutbox online', () => {
  it('broadcasts immediately when the link is up and marks the entry sent', async () => {
    const mesh = new MockMeshTransport({ now });
    const outbox = new SosOutbox(mesh, { now });

    outbox.submit(sunog);
    // drain is async (microtask); let it settle
    await Promise.resolve();
    await Promise.resolve();

    const snap = outbox.snapshot();
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]?.sent).toBe(true);
    expect(snap.pending).toBe(0);
    outbox.dispose();
  });

  it('serializes the frozen wire string on the entry', () => {
    const mesh = new MockMeshTransport({ now });
    const outbox = new SosOutbox(mesh, { now });

    const entry = outbox.submit(sunog);
    expect(entry.serialized).toBe('["SUNOG",10.3157,123.8854]');
    outbox.dispose();
  });
});

describe('SosOutbox offline queueing', () => {
  it('queues an alert when offline and keeps it pending', () => {
    const mesh = new MockMeshTransport({ now, initialState: 'offline' });
    const outbox = new SosOutbox(mesh, { now });

    outbox.submit(sunog);
    outbox.submit(baha);

    const snap = outbox.snapshot();
    expect(snap.link).toBe('offline');
    expect(snap.pending).toBe(2);
    expect(snap.entries.every((e) => !e.sent)).toBe(true);
    outbox.dispose();
  });

  it('drains the queue in order when the link returns', async () => {
    const mesh = new MockMeshTransport({ now, initialState: 'offline' });
    const outbox = new SosOutbox(mesh, { now });

    outbox.submit(sunog);
    outbox.submit(baha);
    expect(outbox.snapshot().pending).toBe(2);

    mesh.setLinkState('standby'); // signal regained
    await Promise.resolve();
    await Promise.resolve();

    const snap = outbox.snapshot();
    expect(snap.pending).toBe(0);
    expect(snap.entries.map((e) => e.sent)).toEqual([true, true]);
    outbox.dispose();
  });

  it('notifies subscribers on submit and on drain', async () => {
    const mesh = new MockMeshTransport({ now, initialState: 'offline' });
    const outbox = new SosOutbox(mesh, { now });
    const pendings: number[] = [];
    outbox.subscribe((s: OutboxSnapshot) => pendings.push(s.pending));

    outbox.submit(sunog); // pending 1
    mesh.setLinkState('standby'); // drains -> pending 0
    await Promise.resolve();
    await Promise.resolve();

    expect(pendings[0]).toBe(0); // initial snapshot on subscribe
    expect(pendings).toContain(1);
    expect(pendings.at(-1)).toBe(0);
    outbox.dispose();
  });
});

describe('SosOutbox receive store (Tier 1)', () => {
  it('records a peer frame and dedupes repeats', () => {
    const mesh = new MockMeshTransport({ now });
    const outbox = new SosOutbox(mesh, { now });
    const peerFrame: MeshFrame = { id: 'peer-1', payload: baha, sentAt: 900, hops: 1 };

    mesh.relay(peerFrame);
    mesh.relay(peerFrame);

    const snap = outbox.snapshot();
    expect(snap.received).toHaveLength(1);
    expect(snap.received[0]?.payload).toEqual(baha);
    expect(snap.received[0]?.hops).toBe(2);
    outbox.dispose();
  });

  it('does not record our own broadcast as a received peer frame', async () => {
    const mesh = new MockMeshTransport({ now });
    const outbox = new SosOutbox(mesh, { now });

    outbox.submit(sunog);
    await Promise.resolve();
    await Promise.resolve();

    expect(outbox.snapshot().received).toHaveLength(0);
    outbox.dispose();
  });

  it('relays peer frames when relayPeers is enabled', () => {
    const mesh = new MockMeshTransport({ now });
    const outbox = new SosOutbox(mesh, { now, relayPeers: true });
    let relayedHops = -1;
    mesh.onFrame((f) => {
      if (f.id === 'peer-2') {
        relayedHops = f.hops;
      }
    });

    mesh.relay({ id: 'peer-2', payload: baha, sentAt: 900, hops: 0 });

    // The outbox should have re-relayed it (hops incremented again).
    expect(relayedHops).toBeGreaterThanOrEqual(1);
    outbox.dispose();
  });
});

describe('SosOutbox dispose', () => {
  it('stops reacting to the transport after dispose', async () => {
    const mesh = new MockMeshTransport({ now, initialState: 'offline' });
    const outbox = new SosOutbox(mesh, { now });
    outbox.submit(sunog);
    outbox.dispose();

    mesh.setLinkState('standby');
    await Promise.resolve();

    // Disposed: the queued entry is never drained.
    expect(outbox.snapshot().pending).toBe(1);
  });
});
