// Feature: mobile-citizen-account, Property 9: In-progress edits survive every non-success save outcome
//
// *For any* MedicalDraft and *any* save failure outcome in {non-200 HTTP (other than 401),
// timeout, network/offline error}, after a save attempt the draft is unchanged from what the
// Citizen entered and a save-failure copy is shown while the surface stays open and interactive.
//
// **Validates: Requirements 7.10, 11.5**

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import fc from 'fast-check';

import { t } from '@aira/ui';

import type { ApiFailure, CitizenApiClient } from '../../api/citizenClient';
import { MedicalProfileScreen } from '../MedicalProfileScreen';
import { clearPreservedDraft } from '../../medical/draft';
import {
  TEST_CITIZEN,
  createTestClient,
  createTestStore,
  renderWithAuth,
} from '../../test-utils/citizen';

jest.setTimeout(180_000);

/**
 * Every putMedical failure outcome that must preserve edits. 401 is deliberately excluded:
 * it routes the Citizen to sign-in instead of keeping the surface open (R7.9).
 */
const failureArb: fc.Arbitrary<ApiFailure> = fc.oneof(
  // Non-200 HTTP other than 401.
  fc
    .constantFrom(400, 403, 409, 422, 429, 500, 502, 503)
    .map((status): ApiFailure => ({
      ok: false,
      kind: 'http',
      status,
      code: 'service_unavailable',
    })),
  fc.constant<ApiFailure>({ ok: false, kind: 'timeout' }),
  fc.constant<ApiFailure>({ ok: false, kind: 'offline' }),
);

/** Light edit content: a single allergy entry plus optional free-text notes. */
const editArb = fc.record({
  allergy: fc
    .string({ minLength: 1, maxLength: 40 })
    .map((value) => value.replace(/\s/g, 'x'))
    .filter((value) => value.trim().length > 0),
  notes: fc.string({ minLength: 0, maxLength: 60 }).map((value) => value.replace(/\s/g, 'x')),
});

function openScreen(client: CitizenApiClient) {
  return renderWithAuth(<MedicalProfileScreen onBack={jest.fn()} onSessionExpired={jest.fn()} />, {
    client,
    store: createTestStore(),
    initialState: { kind: 'registered', citizen: TEST_CITIZEN },
  });
}

describe('medical edit preservation (Property 9)', () => {
  it('keeps the Citizen edits on screen for every non-success save outcome', async () => {
    await fc.assert(
      fc.asyncProperty(failureArb, editArb, async (failure, edit) => {
        clearPreservedDraft();
        const putMedical = jest.fn(async () => failure);
        const client = createTestClient({
          putMedical: putMedical as unknown as CitizenApiClient['putMedical'],
        });

        try {
          await openScreen(client);
          await waitFor(() => expect(screen.getByTestId('medical-save')).toBeTruthy());

          // The Citizen enters some edits.
          await fireEvent.press(screen.getByTestId('medical-allergies-add'));
          await fireEvent.changeText(screen.getByTestId('medical-allergies-0'), edit.allergy);
          if (edit.notes.length > 0) {
            await fireEvent.changeText(screen.getByTestId('medical-notes'), edit.notes);
          }

          // Save fails.
          await fireEvent.press(screen.getByTestId('medical-save'));
          await waitFor(() => expect(putMedical).toHaveBeenCalledTimes(1));

          // A save-failure message is shown...
          await waitFor(() =>
            expect(screen.getByTestId('medical-save-error').props.children).toBe(
              t('citizenMedicalSaveFailed'),
            ),
          );

          // ...the edits are still present in the inputs (preserved, R7.10/R11.5)...
          expect(screen.getByTestId('medical-allergies-0').props.value).toBe(edit.allergy);
          if (edit.notes.length > 0) {
            expect(screen.getByTestId('medical-notes').props.value).toBe(edit.notes);
          }

          // ...and the surface stayed open and interactive (save control still there, not routed away).
          expect(screen.getByTestId('medical-save')).toBeTruthy();
          expect(screen.queryByTestId('medical-saved')).toBeNull();
        } finally {
          await cleanup();
          // Let any trailing provider state updates settle before the next render.
          await new Promise((resolve) => setImmediate(resolve));
        }
      }),
      { numRuns: 100 },
    );
  });
});
