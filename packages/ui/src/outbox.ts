/**
 * Offline-first SOS outbox + receive store (PRODUCT.md §1b Tier 0/1, DESIGN.md §5a).
 *
 * The citizen app never blocks on connectivity. Every SOS is handed to this outbox,
 * which broadcasts immediately when the mesh link is up and otherwise queues the alert
 * and drains it automatically once the link returns. Received/relayed peer frames are
 * also tracked here so a device can show what it has heard.
 *
 * Platform-neutral (no React, no React Native, no DOM) so the whole offline state
 * machine is unit-testable without a device (TESTING.md §4).
 */

import {
  MESH_MAX_HOPS,
  type MeshFrame,
  type MeshLinkState,
  type MeshTransport,
  type Unsubscribe,
} from './mesh';
import { serializeSosPayload, type SosPayload } from './payload';

/** An alert the citizen composed. `sent` flips once it reaches the transport. */
export interface OutboxEntry {
  readonly id: string;
  readonly payload: SosPayload;
  readonly serialized: string;
  readonly createdAt: number;
  readonly sent: boolean;
  /** When it was actually broadcast (null while still queued offline). */
  readonly sentAt: number | null;
}

/** A frame heard from a peer on the mesh (Tier 1 receive/relay). */
export interface ReceivedEntry {
  readonly id: string;
  readonly payload: SosPayload;
  readonly serialized: string;
  readonly receivedAt: number;
  readonly hops: number;
}

export interface OutboxSnapshot {
  readonly link: MeshLinkState;
  readonly entries: readonly OutboxEntry[];
  readonly received: readonly ReceivedEntry[];
  /** Count of composed-but-not-yet-sent alerts (drives "OFFLINE - QUEUED (n)"). */
  readonly pending: number;
}

export type OutboxListener = (snapshot: OutboxSnapshot) => void;

export interface SosOutboxOptions {
  readonly now?: () => number;
  /** Auto-relay peer frames we hear (Tier 1). Off by default on a citizen device. */
  readonly relayPeers?: boolean;
}

let entryCounter = 0;
function nextEntryId(now: number): string {
  entryCounter += 1;
  return `sos-${now.toString(36)}-${entryCounter.toString(36)}`;
}

/**
 * Owns the offline queue and the receive log over a `MeshTransport`. Does not depend
 * on any specific transport implementation (mock today, radio later).
 */
export class SosOutbox {
  private readonly transport: MeshTransport;
  private readonly now: () => number;
  private readonly relayPeers: boolean;
  private readonly entries: OutboxEntry[] = [];
  private readonly received: ReceivedEntry[] = [];
  private readonly ownFrameIds = new Set<string>();
  private readonly listeners = new Set<OutboxListener>();
  private readonly unsubscribes: Unsubscribe[] = [];
  private draining = false;

  constructor(transport: MeshTransport, options: SosOutboxOptions = {}) {
    this.transport = transport;
    this.now = options.now ?? (() => Date.now());
    this.relayPeers = options.relayPeers ?? false;

    this.unsubscribes.push(
      this.transport.onLinkState((state) => {
        // Link just came back: flush anything we queued while offline.
        if (state !== 'offline') {
          void this.drain();
        }
        this.emit();
      }),
    );

    this.unsubscribes.push(this.transport.onFrame((frame) => this.ingest(frame)));
  }

  /** Current immutable snapshot for rendering. */
  snapshot(): OutboxSnapshot {
    const pending = this.entries.reduce((n, entry) => (entry.sent ? n : n + 1), 0);
    return {
      link: this.transport.linkState(),
      entries: [...this.entries],
      received: [...this.received],
      pending,
    };
  }

  subscribe(listener: OutboxListener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  /**
   * Compose + enqueue an SOS. Returns immediately (Tier 0: never blocks). If the link
   * is up it is broadcast now; otherwise it stays queued and drains when the link
   * returns.
   */
  submit(payload: SosPayload): OutboxEntry {
    const createdAt = this.now();
    const entry: OutboxEntry = {
      id: nextEntryId(createdAt),
      payload,
      serialized: serializeSosPayload(payload),
      createdAt,
      sent: false,
      sentAt: null,
    };
    this.entries.push(entry);
    this.emit();

    if (this.transport.linkState() !== 'offline') {
      void this.drain();
    }
    return entry;
  }

  /** Broadcast every queued-but-unsent entry in order. Safe to call repeatedly. */
  async drain(): Promise<void> {
    if (this.draining || this.transport.linkState() === 'offline') {
      return;
    }
    this.draining = true;
    try {
      for (let index = 0; index < this.entries.length; index += 1) {
        const entry = this.entries[index];
        if (!entry || entry.sent) {
          continue;
        }
        if (this.transport.linkState() === 'offline') {
          break; // Link dropped mid-drain; keep the rest queued.
        }
        const frame = await this.transport.send(entry.payload);
        this.ownFrameIds.add(frame.id);
        // `send` emits synchronously, so our own frame may have been ingested as a
        // peer before its id was known; prune it back out.
        const echoed = this.received.findIndex((r) => r.id === frame.id);
        if (echoed !== -1) {
          this.received.splice(echoed, 1);
        }
        this.entries[index] = { ...entry, sent: true, sentAt: frame.sentAt };
        this.emit();
      }
    } finally {
      this.draining = false;
    }
  }

  /** Tear down transport subscriptions (unmount). */
  dispose(): void {
    for (const off of this.unsubscribes) {
      off();
    }
    this.unsubscribes.length = 0;
    this.listeners.clear();
  }

  /** Handle a frame observed on the mesh - our own echo or a peer's alert. */
  private ingest(frame: MeshFrame): void {
    if (this.ownFrameIds.has(frame.id)) {
      return; // Our own broadcast echoing back; already tracked as an entry.
    }
    if (this.received.some((r) => r.id === frame.id)) {
      return; // Dedupe peer frames.
    }
    this.received.push({
      id: frame.id,
      payload: frame.payload,
      serialized: serializeSosPayload(frame.payload),
      receivedAt: this.now(),
      hops: frame.hops,
    });
    this.emit();

    if (this.relayPeers && frame.hops < MESH_MAX_HOPS) {
      void this.transport.relay(frame);
    }
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
