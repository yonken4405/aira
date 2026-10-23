/**
 * Mesh transport abstraction (PRODUCT.md §1b, AGENTS.md rule 15).
 *
 * The apps never talk to a radio directly - they talk to this interface. Today the
 * only implementation is an in-memory mock; the real Bluetooth/LoRa radio is a
 * separate, flagged hardware track (PRODUCT.md §1 "mesh transport") and must never be
 * inlined into app/console code.
 *
 * Tier 0 (PRODUCT.md §1b): compose / broadcast / receive / relay happen here and must
 * work with zero connectivity. The frame on the wire is the frozen, PII-free payload
 * (`./payload`); this module only moves that exact serialized string around.
 */

import { parseSosPayload, serializeSosPayload, type SosPayload } from './payload';

/** Transport link state, surfaced to the UI as an honest status line (DESIGN.md §5a). */
export type MeshLinkState =
  | 'standby' // idle, link up, nothing in flight
  | 'broadcasting' // a frame is being sent/relayed over the mesh
  | 'offline'; // no mesh link available right now

/**
 * A frame observed on the mesh. `id` is a transport-level dedupe key (NOT incident PII);
 * `hops` counts relays so a frame cannot loop forever. The payload is the frozen array.
 */
export interface MeshFrame {
  readonly id: string;
  readonly payload: SosPayload;
  /** Monotonic-ish send time (ms epoch) used only for ordering/dedupe, never displayed. */
  readonly sentAt: number;
  readonly hops: number;
}

export type MeshFrameListener = (frame: MeshFrame) => void;
export type MeshLinkListener = (state: MeshLinkState) => void;

/** Unsubscribe handle returned by the `on*` methods. */
export type Unsubscribe = () => void;

/**
 * The single port both apps code against. Implementations: `MockMeshTransport` (now),
 * LoRa/Bluetooth radio (future hardware track).
 */
export interface MeshTransport {
  /** Broadcast a payload as a new frame. Resolves once handed to the transport. */
  send(payload: SosPayload): Promise<MeshFrame>;
  /** Re-broadcast a frame received from a peer, incrementing its hop count. */
  relay(frame: MeshFrame): Promise<MeshFrame>;
  /** Subscribe to frames seen on the mesh (own sends + relayed peers). */
  onFrame(listener: MeshFrameListener): Unsubscribe;
  /** Subscribe to link-state changes (standby/broadcasting/offline). */
  onLinkState(listener: MeshLinkListener): Unsubscribe;
  /** Current link state. */
  linkState(): MeshLinkState;
}

/** Default: how many relay hops a frame may take before it is dropped (loop guard). */
export const MESH_MAX_HOPS = 8;

let frameCounter = 0;

/**
 * Transport-level frame id. Deliberately NOT derived from the payload or any location:
 * it only has to be unique enough to dedupe relays within a session.
 */
function nextFrameId(now: number): string {
  frameCounter += 1;
  return `mesh-${now.toString(36)}-${frameCounter.toString(36)}`;
}

export interface MockMeshOptions {
  /** Clock injection keeps tests deterministic (TESTING.md §4.2). */
  readonly now?: () => number;
  /** Start offline to exercise the no-signal path. */
  readonly initialState?: MeshLinkState;
  /** Called with the exact serialized wire string on every send/relay (mock "radio"). */
  readonly onWire?: (serialized: string) => void;
}

/**
 * In-memory mock mesh. One instance behaves like a single node that can hear its own
 * broadcasts; tests (and a future local-mesh simulator) can wire several together by
 * forwarding frames between their `onFrame`/`relay`. It performs hop-limiting and
 * dedupe so the relay contract is exercised without any radio.
 */
export class MockMeshTransport implements MeshTransport {
  private readonly now: () => number;
  private readonly onWire: ((serialized: string) => void) | undefined;
  private state: MeshLinkState;
  private readonly frameListeners = new Set<MeshFrameListener>();
  private readonly linkListeners = new Set<MeshLinkListener>();
  private readonly seen = new Set<string>();

  constructor(options: MockMeshOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.onWire = options.onWire;
    this.state = options.initialState ?? 'standby';
  }

  linkState(): MeshLinkState {
    return this.state;
  }

  /** Flip link state (tests / a future connectivity watcher drive this). */
  setLinkState(state: MeshLinkState): void {
    if (state === this.state) {
      return;
    }
    this.state = state;
    for (const listener of this.linkListeners) {
      listener(state);
    }
  }

  async send(payload: SosPayload): Promise<MeshFrame> {
    const frame: MeshFrame = {
      id: nextFrameId(this.now()),
      payload,
      sentAt: this.now(),
      hops: 0,
    };
    return this.broadcast(frame);
  }

  async relay(frame: MeshFrame): Promise<MeshFrame> {
    if (frame.hops >= MESH_MAX_HOPS) {
      // Loop guard: a frame that has bounced too far is dropped, not re-sent.
      return frame;
    }
    const relayed: MeshFrame = { ...frame, hops: frame.hops + 1 };
    return this.broadcast(relayed);
  }

  onFrame(listener: MeshFrameListener): Unsubscribe {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onLinkState(listener: MeshLinkListener): Unsubscribe {
    this.linkListeners.add(listener);
    return () => this.linkListeners.delete(listener);
  }

  private broadcast(frame: MeshFrame): MeshFrame {
    if (this.seen.has(frame.id)) {
      // Already relayed this exact frame - drop to prevent a broadcast storm.
      return frame;
    }
    this.seen.add(frame.id);

    const previous = this.state;
    this.setLinkState('broadcasting');

    // The mock "radio": emit the exact frozen wire string. Real transports put this
    // on the air; here we just surface it and notify local listeners.
    this.onWire?.(serializeSosPayload(frame.payload));
    for (const listener of this.frameListeners) {
      listener(frame);
    }

    // Settle back to the pre-send state (offline stays offline).
    this.setLinkState(previous === 'offline' ? 'offline' : 'standby');
    return frame;
  }
}

/**
 * Safely decode a frame's payload from an untrusted serialized string (e.g. a peer
 * relay). Returns null on anything malformed - reject-by-default (SECURITY.md §3).
 */
export function decodeMeshFrame(serialized: string): SosPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    return null;
  }
  const parsed = parseSosPayload(raw);
  return parsed.ok ? parsed.payload : null;
}
