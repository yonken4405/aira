import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import {
  EMERGENCY_CATEGORIES,
  MOCK_LOCATION,
  MockMeshTransport,
  SosOutbox,
  buildSosPayload,
  getCategory,
  t,
  type EmergencyCategoryId,
  type OutboxSnapshot,
} from '@aira/ui';

import { SosButton } from '../components/SosButton';

/** Fixed 2×2 grid layout - order matches the design spec (DESIGN.md §4). */
const GRID_ROWS: readonly (readonly [EmergencyCategoryId, EmergencyCategoryId])[] = [
  ['SUNOG', 'MEDIKAL'],
  ['KRIMEN', 'BAHA'],
];

/**
 * Mock mesh transport for the MVP (AGENTS.md rule 15). The citizen app talks only to
 * the `MeshTransport` port; real Bluetooth/LoRa radio is a separate hardware track.
 * `onWire` logs the exact frozen wire string - the string the radio will later put on
 * the air (PRODUCT.md §4).
 */
export function createCitizenMesh(): MockMeshTransport {
  return new MockMeshTransport({ onWire: (serialized) => console.log(serialized) });
}

/** Header status chip color per link state - semantic only (DESIGN.md §2/§6). */
function linkToneClass(link: OutboxSnapshot['link']): string {
  switch (link) {
    case 'broadcasting':
      return 'bg-status-dispatched';
    case 'offline':
      return 'bg-status-error';
    default:
      return 'bg-emergency-medikal';
  }
}

function linkLabel(snapshot: OutboxSnapshot): string {
  if (snapshot.link === 'broadcasting') {
    return t('meshBroadcasting');
  }
  if (snapshot.link === 'offline') {
    return snapshot.pending > 0
      ? t('meshOfflineQueued', { count: snapshot.pending })
      : t('meshOffline');
  }
  return t('meshStandby');
}

export interface EmergencyGridScreenProps {
  /** Injectable for tests; defaults to a fresh mock-mesh-backed outbox. */
  readonly transport?: MockMeshTransport;
}

/**
 * The ONLY citizen screen: four giant SOS buttons + an offline-aware readout.
 * PRODUCT.md §3: 100% of citizen interaction happens here (no voice, no chat).
 * Offline-first (PRODUCT.md §1b): the grid always works; the outbox queues alerts when
 * there is no mesh link and drains them automatically when a link returns.
 */
export function EmergencyGridScreen({ transport }: EmergencyGridScreenProps = {}) {
  // The transport is stable for the component's lifetime; the outbox (which owns the
  // transport subscriptions) is created and disposed together inside the effect so the
  // create/dispose pair is always balanced, even under React StrictMode's
  // mount→cleanup→mount double-invoke.
  const [mesh] = useState(() => transport ?? createCitizenMesh());
  const [outbox, setOutbox] = useState<SosOutbox | null>(null);
  const [snapshot, setSnapshot] = useState<OutboxSnapshot>({
    link: mesh.linkState(),
    entries: [],
    received: [],
    pending: 0,
  });

  useEffect(() => {
    const instance = new SosOutbox(mesh);
    setOutbox(instance);
    const unsubscribe = instance.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      instance.dispose();
      setOutbox(null);
    };
  }, [mesh]);

  const lastEntry = snapshot.entries.at(-1) ?? null;

  const handleSos = (category: EmergencyCategoryId) => {
    // Hand to the outbox: broadcasts now if the link is up, otherwise queues and drains
    // automatically later. Never blocks the UI (Tier 0).
    outbox?.submit(buildSosPayload(category, MOCK_LOCATION.lat, MOCK_LOCATION.lon));
  };

  return (
    <View className="flex-1 bg-ink">
      <View className="border-b border-line bg-surface px-5 pb-4 pt-14">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-extrabold text-fg">{t('appName')}</Text>
          <View className="flex-row items-center gap-2 border border-line bg-raised px-2 py-1">
            <View className={`h-2 w-2 ${linkToneClass(snapshot.link)}`} />
            <Text className="text-[10px] font-bold uppercase text-muted" testID="mesh-status">
              {linkLabel(snapshot)}
            </Text>
          </View>
        </View>

        <Text className="mt-4 text-2xl font-extrabold text-fg">{t('emergencyPrompt')}</Text>
        <Text className="mt-1 text-sm text-muted">{t('emergencyHint')}</Text>
      </View>

      <View className="flex-1 gap-4 p-4">
        {GRID_ROWS.map(([leftId, rightId]) => {
          const left = getCategory(leftId);
          const right = getCategory(rightId);
          return (
            <View key={`${left.id}-${right.id}`} className="flex-row flex-1 gap-4">
              <SosButton
                testID={`sos-${left.id}`}
                label={left.label}
                sublabel={left.localizedLabel}
                color={left.color}
                onPress={() => handleSos(left.id)}
              />
              <SosButton
                testID={`sos-${right.id}`}
                label={right.label}
                sublabel={right.localizedLabel}
                color={right.color}
                onPress={() => handleSos(right.id)}
              />
            </View>
          );
        })}
      </View>

      {snapshot.pending > 0 ? (
        <View className="border-t border-line bg-surface px-5 pt-3">
          <Text className="text-[10px] font-bold uppercase text-muted">{t('outboxTitle')}</Text>
          {snapshot.entries
            .filter((entry) => !entry.sent)
            .map((entry) => (
              <View
                key={entry.id}
                className="mt-2 flex-row items-center justify-between"
                testID={`outbox-${entry.id}`}
              >
                <Text className="font-mono text-xs text-fg">{entry.serialized}</Text>
                <Text className="text-[10px] font-bold uppercase text-status-queued">
                  {t('outboxQueuedState')}
                </Text>
              </View>
            ))}
          <Text className="mt-2 text-[11px] text-muted">{t('outboxQueuedHint')}</Text>
        </View>
      ) : null}

      <View className="border-t border-line bg-surface px-5 pb-8 pt-3">
        <Text className="text-[10px] font-bold uppercase text-muted">{t('lastTransmission')}</Text>
        <Text className="mt-1 font-mono text-sm text-fg" testID="last-payload">
          {lastEntry?.serialized ?? 'No transmission yet'}
        </Text>
        <Text className="mt-1 font-mono text-[11px] text-muted">
          {t('mockGps')} {MOCK_LOCATION.lat}, {MOCK_LOCATION.lon}, Cebu
        </Text>
      </View>
    </View>
  );
}

/** Re-exported for tests/debug tooling - proves the grid matches the closed enum. */
export const GRID_CATEGORIES = EMERGENCY_CATEGORIES.map((category) => category.id);
