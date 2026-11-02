import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import fc from 'fast-check';

import { MockMeshTransport, type CitizenAuthState, type Connectivity } from '@aira/ui';

import { AppNavigator } from '../AppNavigator';
import { TEST_CITIZEN, createTestClient, createTestStore } from '../../test-utils/citizen';

jest.setTimeout(180_000);

const STATES: readonly CitizenAuthState[] = [
  { kind: 'anonymous' },
  { kind: 'registered', citizen: TEST_CITIZEN },
  { kind: 'unknown' },
];

const CONNECTIVITIES: readonly Connectivity[] = ['online', 'offline', 'unknown'];

const CATEGORIES = ['SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA'] as const;

/**
 * Property 1 (R1.1-R1.5): for every (auth state x connectivity) combination the app opens
 * on the SOS grid and each category still reaches the wire with the frozen payload.
 */
describe('grid invariance (Property 1)', () => {
  it('keeps all four SOS actions available across every state combination', async () => {
    const expected = CATEGORIES.map((id) => `["${id}",10.3157,123.8854]`);

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...STATES),
        fc.constantFrom(...CONNECTIVITIES),
        async (initialState, initialConnectivity) => {
          const wire: string[] = [];
          const transport = new MockMeshTransport({
            onWire: (serialized) => wire.push(serialized),
          });

          try {
            await render(
              <AppNavigator
                client={createTestClient()}
                store={createTestStore()}
                initialState={initialState}
                initialConnectivity={initialConnectivity}
                transport={transport}
              />,
            );

            for (const id of CATEGORIES) {
              await fireEvent.press(screen.getByTestId(`sos-${id}`));
            }

            await waitFor(() => expect(wire).toHaveLength(CATEGORIES.length));
            expect([...wire].sort()).toEqual([...expected].sort());
          } finally {
            await cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
