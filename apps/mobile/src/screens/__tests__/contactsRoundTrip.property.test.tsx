// Feature: mobile-citizen-account, Property 12: Contact edits are reflected exactly in the next PUT body
//
// *For any* sequence of emergency-contact add / remove / edit operations applied through the
// MedicalProfileScreen UI (kept within validity bounds so the save is not blocked), the `contacts`
// array in the next successful putMedical body equals exactly the contacts remaining on screen —
// every added contact present, every removed contact absent, no extra or missing entries, in order.
//
// **Validates: Requirements 8.2, 8.3**

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import fc from 'fast-check';

import { MEDICAL_BOUNDS, type EmergencyContactDraft, type MedicalDraft } from '@aira/ui';

import type { CitizenApiClient, MedicalProfile } from '../../api/citizenClient';
import { MedicalProfileScreen } from '../MedicalProfileScreen';
import { clearPreservedDraft } from '../../medical/draft';
import {
  TEST_CITIZEN,
  createTestClient,
  createTestStore,
  renderWithAuth,
} from '../../test-utils/citizen';

jest.setTimeout(180_000);

const { MAX_CONTACTS } = MEDICAL_BOUNDS;

/** A single valid contact: non-empty, whitespace-free name/phone so validation always passes. */
const contactArb: fc.Arbitrary<EmergencyContactDraft> = fc.record({
  name: fc
    .string({ minLength: 1, maxLength: 20 })
    .map((value) => value.replace(/\s/g, 'x'))
    .filter((value) => value.length > 0),
  phone: fc
    .string({ minLength: 1, maxLength: 16 })
    .map((value) => value.replace(/\s/g, '0'))
    .filter((value) => value.length > 0),
  relation: fc.oneof(
    fc.constant<string | null>(null),
    fc
      .string({ minLength: 1, maxLength: 12 })
      .map((value) => value.replace(/\s/g, 'x'))
      .filter((value) => value.length > 0),
  ),
});

type Op =
  | { readonly kind: 'add'; readonly contact: EmergencyContactDraft }
  | { readonly kind: 'remove'; readonly at: number }
  | { readonly kind: 'edit'; readonly at: number; readonly contact: EmergencyContactDraft };

/**
 * A sequence of operations against a zero-based positional index into the current list. `at` is a
 * fraction in [0, 1); the applier resolves it to a real index at execution time so the op is always
 * valid against whatever length the list currently has. `add` past MAX_CONTACTS is a no-op by the
 * screen's own guard, so the model mirrors that.
 */
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: contactArb.map((contact): Op => ({ kind: 'add', contact })) },
  {
    weight: 1,
    arbitrary: fc
      .double({ min: 0, max: 0.999, noNaN: true })
      .map((at): Op => ({ kind: 'remove', at: at as number })),
  },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.double({ min: 0, max: 0.999, noNaN: true }), contactArb)
      .map(([at, contact]): Op => ({ kind: 'edit', at: at as number, contact })),
  },
);

const opsArb = fc.array(opArb, { minLength: 1, maxLength: 12 });

function openScreen(client: CitizenApiClient) {
  return renderWithAuth(<MedicalProfileScreen onBack={jest.fn()} onSessionExpired={jest.fn()} />, {
    client,
    store: createTestStore(),
    initialState: { kind: 'registered', citizen: TEST_CITIZEN },
  });
}

/** Resolve a [0,1) fraction to an in-range index for a list of the given length. */
function indexFor(fraction: number, length: number): number {
  return Math.min(length - 1, Math.floor(fraction * length));
}

describe('contact round-trip fidelity (Property 12)', () => {
  it('reflects the exact remaining contacts in the next PUT body', async () => {
    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        clearPreservedDraft();

        // Capture the draft handed to putMedical; echo it back as the canonical profile.
        let captured: MedicalDraft | null = null;
        const putMedical = jest.fn(async (draft: MedicalDraft) => {
          captured = draft;
          const data: MedicalProfile = {
            bloodType: draft.bloodType,
            ageBand: draft.ageBand,
            allergies: draft.allergies,
            conditions: draft.conditions,
            medications: draft.medications,
            notes: draft.notes,
            contacts: draft.contacts,
          };
          return { ok: true as const, status: 200, data };
        });
        const client = createTestClient({
          putMedical: putMedical as unknown as CitizenApiClient['putMedical'],
        });

        // The independent model of the contact list the UI should hold after the ops.
        const model: EmergencyContactDraft[] = [];

        try {
          await openScreen(client);
          await waitFor(() => expect(screen.getByTestId('contact-add')).toBeTruthy());

          for (const op of ops) {
            if (op.kind === 'add') {
              if (model.length >= MAX_CONTACTS) {
                continue; // The screen's add button is disabled at the cap — mirror the no-op.
              }
              const index = model.length;
              await fireEvent.press(screen.getByTestId('contact-add'));
              await fireEvent.changeText(
                screen.getByTestId(`contact-${index}-name`),
                op.contact.name,
              );
              await fireEvent.changeText(
                screen.getByTestId(`contact-${index}-phone`),
                op.contact.phone,
              );
              if (op.contact.relation !== null) {
                await fireEvent.changeText(
                  screen.getByTestId(`contact-${index}-relation`),
                  op.contact.relation,
                );
              }
              model.push({ ...op.contact });
            } else if (op.kind === 'remove') {
              if (model.length === 0) {
                continue;
              }
              const index = indexFor(op.at, model.length);
              await fireEvent.press(screen.getByTestId(`contact-${index}-remove`));
              model.splice(index, 1);
            } else {
              if (model.length === 0) {
                continue;
              }
              const index = indexFor(op.at, model.length);
              await fireEvent.changeText(
                screen.getByTestId(`contact-${index}-name`),
                op.contact.name,
              );
              await fireEvent.changeText(
                screen.getByTestId(`contact-${index}-phone`),
                op.contact.phone,
              );
              // relation: set when provided, otherwise clear it to null (empty input => null).
              await fireEvent.changeText(
                screen.getByTestId(`contact-${index}-relation`),
                op.contact.relation ?? '',
              );
              model[index] = { ...op.contact };
            }
          }

          await fireEvent.press(screen.getByTestId('medical-save'));
          await waitFor(() => expect(putMedical).toHaveBeenCalledTimes(1));

          // The PUT body's contacts equal exactly the remaining UI contacts, in order.
          expect(captured).not.toBeNull();
          expect((captured as unknown as MedicalDraft).contacts).toEqual(model);
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
