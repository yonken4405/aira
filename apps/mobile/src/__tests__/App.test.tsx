/**
 * `App` grid-retention test (mobile-citizen-account spec, task 18.1 — TDD RED;
 * the `App.tsx` change is task 18.2).
 *
 * Task 18.2 rewires `App.tsx` to render `AppNavigator` (wrapped in
 * `CitizenAuthProvider`) instead of `EmergencyGridScreen` directly, keeping the grid's
 * props/behaviour verbatim. This test pins the two invariants that change MUST preserve:
 *
 *   1. The SOS grid is the FIRST screen on mount: all four `testID="sos-<ID>"` buttons
 *      render immediately and a category press still emits the EXACT frozen mesh wire
 *      string via the default mock-mesh transport's `console.log` (R1.1 / R1.7).
 *   2. `GRID_CATEGORIES` still equals the closed four-category enum
 *      (SUNOG / MEDIKAL / KRIMEN / BAHA) and `buildSosPayload` + `serializeSosPayload`
 *      still yield the frozen wire format for each category (R1.7).
 *
 * The RED driver for task 18.2: `App` currently renders `EmergencyGridScreen` directly,
 * which has NO account affordance. The navigator adds a single secondary affordance
 * (`testID="open-account-hub"`) on mount. Asserting that affordance is present FAILS while
 * `App` renders the grid directly and only goes green once task 18.2 wires `AppNavigator`.
 *
 * Requirements: 1.1, 1.7.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { buildSosPayload, serializeSosPayload, MOCK_LOCATION } from '@aira/ui';

import App from '../../App';
import { GRID_CATEGORIES } from '../screens/EmergencyGridScreen';

/** The frozen four-category closed enum and the exact wire string each press must emit. */
const EXPECTED_WIRE: Readonly<Record<string, string>> = {
  SUNOG: '["SUNOG",10.3157,123.8854]',
  MEDIKAL: '["MEDIKAL",10.3157,123.8854]',
  KRIMEN: '["KRIMEN",10.3157,123.8854]',
  BAHA: '["BAHA",10.3157,123.8854]',
};
const CATEGORIES = Object.keys(EXPECTED_WIRE) as readonly (
  'SUNOG' | 'MEDIKAL' | 'KRIMEN' | 'BAHA'
)[];

describe('App — grid retention (R1.1 / R1.7)', () => {
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('renders the SOS grid as the first screen on mount (R1.1)', async () => {
    await render(<App />);

    // All four category buttons are present immediately — the grid is the first screen.
    for (const id of CATEGORIES) {
      expect(screen.getByTestId(`sos-${id}`)).toBeTruthy();
    }
  });

  it('exposes the account affordance from AppNavigator on mount (R1.1)', async () => {
    // RED until task 18.2: the affordance only exists once `App` renders `AppNavigator`.
    // While `App` renders `EmergencyGridScreen` directly, this testID does not exist.
    await render(<App />);

    expect(screen.getByTestId('open-account-hub')).toBeTruthy();
  });

  it('still emits the exact frozen mesh wire string on a category press (R1.7)', async () => {
    await render(<App />);
    await fireEvent.press(screen.getByTestId('sos-SUNOG'));

    await waitFor(() => expect(logSpy).toHaveBeenCalledWith(EXPECTED_WIRE.SUNOG));
  });

  it('keeps GRID_CATEGORIES equal to the frozen closed enum (R1.7)', () => {
    expect(GRID_CATEGORIES).toEqual(['SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA']);
  });

  it('keeps buildSosPayload + serializeSosPayload frozen for every category (R1.7)', () => {
    for (const id of CATEGORIES) {
      const payload = buildSosPayload(id, MOCK_LOCATION.lat, MOCK_LOCATION.lon);
      expect(serializeSosPayload(payload)).toBe(EXPECTED_WIRE[id]);
    }
  });
});
