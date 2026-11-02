// Feature: mobile-citizen-account, Property 8: Medical profile fields never leak to logs
/**
 * Property 8 (R7.11): the citizen API client never writes any medical profile field value
 * to the console. We build the REAL client (`createCitizenApiClient`) with an injected
 * `fetchImpl` recorder that returns benign 200 responses, generate `MedicalDraft` values
 * whose every field carries a unique `SENTINEL_` value, exercise `getMedical`,
 * `putMedical`, and `deleteMedical` across arbitrary call sequences, and assert that none
 * of the generated sentinels appear in any captured `console.*` output.
 *
 * The client does not log today; this property guards that invariant against regressions.
 */

import fc from 'fast-check';

import type { MedicalDraft } from '@aira/ui';

import { createCitizenApiClient, type MedicalProfile } from '../citizenClient';
import { createTestStore } from '../../test-utils/citizen';

jest.setTimeout(180_000);

const BASE = 'https://aira.example';
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/** A medical draft whose every field value is a recognizable `SENTINEL_` string. */
interface SentinelDraft {
  readonly draft: MedicalDraft;
  readonly sentinels: readonly string[];
}

/** Marks a string so it is trivially greppable inside captured log output. */
const sentinel = (label: string): string => `SENTINEL_${label}`;

const sentinelDraftArb: fc.Arbitrary<SentinelDraft> = fc
  .record({
    bloodType: fc.constantFrom('bloodType'),
    ageBand: fc.constantFrom('ageBand'),
    allergies: fc.array(fc.nat(), { maxLength: 4 }),
    conditions: fc.array(fc.nat(), { maxLength: 4 }),
    medications: fc.array(fc.nat(), { maxLength: 4 }),
    notes: fc.boolean(),
    contacts: fc.array(fc.nat(), { maxLength: 3 }),
  })
  .map((spec) => {
    const sentinels: string[] = [];
    const take = (label: string): string => {
      const value = sentinel(label);
      sentinels.push(value);
      return value;
    };

    const bloodType = take('bloodType');
    const ageBand = take('ageBand');
    const allergies = spec.allergies.map((_, i) => take(`allergy_${i}`));
    const conditions = spec.conditions.map((_, i) => take(`condition_${i}`));
    const medications = spec.medications.map((_, i) => take(`medication_${i}`));
    const notes = spec.notes ? take('notes') : null;
    const contacts = spec.contacts.map((_, i) => ({
      name: take(`contact_name_${i}`),
      phone: take(`contact_phone_${i}`),
      relation: take(`contact_relation_${i}`),
    }));

    // `bloodType`/`ageBand` are typed to closed enums, but the client treats them as opaque
    // pass-through values — the leak surface is identical, so sentinels exercise it faithfully.
    const draft = {
      bloodType,
      ageBand,
      allergies,
      conditions,
      medications,
      notes,
      contacts,
    } as unknown as MedicalDraft;

    return { draft, sentinels };
  });

/** The operations the client exposes for medical data. */
type MedicalOp = 'get' | 'put' | 'delete';
const medicalOpArb: fc.Arbitrary<MedicalOp> = fc.constantFrom('get', 'put', 'delete');

/** Benign 200 response that echoes the supplied body back as the profile. */
function benignResponse(profile: MedicalProfile) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ ok: true, profile }),
  };
}

/** An empty, PII-free profile used for GET/DELETE echoes. */
const EMPTY_PROFILE: MedicalProfile = {
  bloodType: null,
  ageBand: null,
  allergies: [],
  conditions: [],
  medications: [],
  notes: null,
  contacts: [],
};

describe('medical profile fields never leak to logs (Property 8, R7.11)', () => {
  it('never writes any generated medical field value to the console', async () => {
    const logs: unknown[][] = [];
    const spies = CONSOLE_METHODS.map((method) =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      }),
    );

    try {
      await fc.assert(
        fc.asyncProperty(
          sentinelDraftArb,
          fc.array(medicalOpArb, { minLength: 1, maxLength: 6 }),
          async ({ draft, sentinels }, ops) => {
            const store = createTestStore({ token: 'session-token' });
            // The recorder echoes the PUT body back as the profile so the response path
            // also carries the sentinels — if the client logged the response, we'd catch it.
            const fetchImpl = (async (_url: string, init: { method?: string; body?: string }) => {
              if (init.method === 'DELETE') {
                return {
                  ok: true,
                  status: 204,
                  headers: { get: () => null },
                  json: async () => null,
                };
              }
              if (init.method === 'PUT' && typeof init.body === 'string') {
                return benignResponse(JSON.parse(init.body) as MedicalProfile);
              }
              return benignResponse(EMPTY_PROFILE);
            }) as unknown as typeof fetch;

            const client = createCitizenApiClient({ baseUrl: BASE, store, fetchImpl });

            for (const op of ops) {
              if (op === 'get') {
                await client.getMedical();
              } else if (op === 'put') {
                await client.putMedical(draft);
              } else {
                await client.deleteMedical();
              }
            }

            const output = logs.flat().map(String).join('\u0000');
            for (const value of sentinels) {
              if (output.includes(value)) {
                throw new Error(`medical field value leaked to a console sink: ${value}`);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
