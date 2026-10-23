import { describe, expect, it, vi } from 'vitest';

import { buildSosPayload } from './payload';
import {
  decodeMeshFrame,
  MockMeshTransport,
  MESH_MAX_HOPS,
  type MeshFrame,
  type MeshLinkState,
} from './mesh';

const payload = buildSosPayload('SUNOG', 10.3157, 123.8854);

function fixedClock(value = 1_000): () => number {
  return () => value;
}

describe('MockMeshTransport.send', () => {
  it('emits the exact frozen wire string and a frame at hop 0', async () => {
    const onWire = vi.fn();
    const mesh = new MockMeshTransport({ now: fixedClock(), onWire });

    const frame = await mesh.send(payload);

    expect(onWire).toHaveBeenCalledWith('["SUNOG",10.3157,123.8854]');
    expect(frame.hops).toBe(0);
    expect(frame.payload).toEqual(payload);
    expect(frame.sentAt).toBe(1_000);
  });

  it('notifies frame listeners and returns an unsubscribe', async () => {
    const mesh = new MockMeshTransport({ now: fixedClock() });
    const seen: MeshFrame[] = [];
    const off = mesh.onFrame((f) => seen.push(f));

    await mesh.send(payload);
    off();
    await mesh.send(payload);

    expect(seen).toHaveLength(1);
  });

  it('round-trips through the frozen format for every category', async () => {
    const onWire = vi.fn();
    const mesh = new MockMeshTransport({ now: fixedClock(), onWire });

    await mesh.send(buildSosPayload('MEDIKAL', 10.3157, 123.8854));
    await mesh.send(buildSosPayload('KRIMEN', 10.3157, 123.8854));
    await mesh.send(buildSosPayload('BAHA', 10.3157, 123.8854));

    expect(onWire).toHaveBeenCalledWith('["MEDIKAL",10.3157,123.8854]');
    expect(onWire).toHaveBeenCalledWith('["KRIMEN",10.3157,123.8854]');
    expect(onWire).toHaveBeenCalledWith('["BAHA",10.3157,123.8854]');
  });
});

describe('MockMeshTransport link state', () => {
  it('pulses broadcasting then settles back to standby on send', async () => {
    const mesh = new MockMeshTransport({ now: fixedClock() });
    const states: MeshLinkState[] = [];
    mesh.onLinkState((s) => states.push(s));

    expect(mesh.linkState()).toBe('standby');
    await mesh.send(payload);

    expect(states).toEqual(['broadcasting', 'standby']);
    expect(mesh.linkState()).toBe('standby');
  });

  it('stays offline after a send when started offline', async () => {
    const mesh = new MockMeshTransport({ now: fixedClock(), initialState: 'offline' });
    const states: MeshLinkState[] = [];
    mesh.onLinkState((s) => states.push(s));

    await mesh.send(payload);

    expect(states).toEqual(['broadcasting', 'offline']);
    expect(mesh.linkState()).toBe('offline');
  });

  it('does not re-notify when setting the same state', () => {
    const mesh = new MockMeshTransport({ now: fixedClock() });
    const states: MeshLinkState[] = [];
    mesh.onLinkState((s) => states.push(s));

    mesh.setLinkState('standby');
    expect(states).toEqual([]);
  });
});

describe('MockMeshTransport.relay', () => {
  it('increments the hop count on relay', async () => {
    const mesh = new MockMeshTransport({ now: fixedClock() });
    const origin = await mesh.send(payload);

    // A peer forwards the frame; simulate by relaying on a second node.
    const peer = new MockMeshTransport({ now: fixedClock() });
    const relayed = await peer.relay(origin);

    expect(relayed.hops).toBe(1);
    expect(relayed.id).toBe(origin.id);
    expect(relayed.payload).toEqual(payload);
  });

  it('dedupes: relaying the same frame twice broadcasts once', async () => {
    const onWire = vi.fn();
    const peer = new MockMeshTransport({ now: fixedClock(), onWire });
    const frame: MeshFrame = { id: 'f1', payload, sentAt: 1_000, hops: 0 };

    await peer.relay(frame);
    await peer.relay(frame);

    expect(onWire).toHaveBeenCalledTimes(1);
  });

  it('drops a frame that has exceeded the hop limit', async () => {
    const onWire = vi.fn();
    const mesh = new MockMeshTransport({ now: fixedClock(), onWire });
    const exhausted: MeshFrame = { id: 'far', payload, sentAt: 1_000, hops: MESH_MAX_HOPS };

    const result = await mesh.relay(exhausted);

    expect(onWire).not.toHaveBeenCalled();
    expect(result.hops).toBe(MESH_MAX_HOPS);
  });
});

describe('decodeMeshFrame', () => {
  it('decodes a valid frozen wire string', () => {
    expect(decodeMeshFrame('["SUNOG",10.3157,123.8854]')).toEqual(payload);
  });

  it('rejects malformed JSON', () => {
    expect(decodeMeshFrame('not json')).toBeNull();
  });

  it('rejects a well-formed but invalid payload (reject-by-default)', () => {
    expect(decodeMeshFrame('["NOPE",10.3,123.8]')).toBeNull();
    expect(decodeMeshFrame('["SUNOG",999,123.8]')).toBeNull();
    expect(decodeMeshFrame('["SUNOG",10.3]')).toBeNull();
  });
});
