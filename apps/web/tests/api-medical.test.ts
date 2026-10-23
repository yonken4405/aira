/**
 * @vitest-environment node
 *
 * Medical profile API (SECURITY.md §8): owner-only CRUD + the encryption boundary
 * (ciphertext never contains plaintext; another citizen cannot read it).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { handleCitizenRegister } from '../src/lib/api/citizen-handlers';
import {
  handleDeleteMedicalProfile,
  handleGetMedicalProfile,
  handlePutMedicalProfile,
} from '../src/lib/api/medical-handlers';
import { CITIZEN_SESSION_COOKIE } from '../src/lib/citizen/session';
import { createTestHarness, jsonBody } from './support/harness';

const PASSWORD = 'correct horse battery staple';

let world: ReturnType<typeof createTestHarness>;

beforeEach(() => {
  world = createTestHarness();
});

async function registerCitizen(email: string): Promise<string> {
  const response = await handleCitizenRegister(
    new Request(
      'http://localhost/api/citizen/register',
      jsonBody('POST', { email, password: PASSWORD }),
    ),
    world.deps,
  );
  const cookie = response.headers.get('set-cookie') ?? '';
  const token = new RegExp(`${CITIZEN_SESSION_COOKIE}=([A-Za-z0-9_-]+)`).exec(cookie)?.[1];
  if (!token) {
    throw new Error('register_failed');
  }
  return token;
}

const cookieHeader = (token: string): Record<string, string> => ({
  cookie: `${CITIZEN_SESSION_COOKIE}=${token}`,
});

const SAMPLE = {
  bloodType: 'O-',
  ageBand: '40-64',
  allergies: ['penicillin'],
  conditions: ['asthma'],
  medications: ['salbutamol'],
  notes: 'has a pacemaker',
  contacts: [{ name: 'Ana', phone: '0917-000-0000', relation: 'spouse' }],
};

describe('PUT + GET /api/citizen/medical (owner CRUD)', () => {
  it('saves and reads back the owner profile', async () => {
    const token = await registerCitizen('juan@example.com');

    const put = await handlePutMedicalProfile(
      new Request(
        'http://localhost/api/citizen/medical',
        jsonBody('PUT', SAMPLE, cookieHeader(token)),
      ),
      world.deps,
    );
    expect(put.status).toBe(200);

    const get = await handleGetMedicalProfile(
      new Request('http://localhost/api/citizen/medical', { headers: cookieHeader(token) }),
      world.deps,
    );
    const payload = (await get.json()) as { profile: typeof SAMPLE };
    expect(payload.profile).toMatchObject({
      bloodType: 'O-',
      allergies: ['penicillin'],
      notes: 'has a pacemaker',
    });
    expect(payload.profile.contacts[0]).toMatchObject({ name: 'Ana', relation: 'spouse' });
  });

  it('returns the empty profile when none is stored', async () => {
    const token = await registerCitizen('empty@example.com');
    const get = await handleGetMedicalProfile(
      new Request('http://localhost/api/citizen/medical', { headers: cookieHeader(token) }),
      world.deps,
    );
    const payload = (await get.json()) as { profile: { bloodType: null; allergies: [] } };
    expect(payload.profile.bloodType).toBeNull();
    expect(payload.profile.allergies).toEqual([]);
  });

  it('deletes the owner profile', async () => {
    const token = await registerCitizen('del@example.com');
    await handlePutMedicalProfile(
      new Request(
        'http://localhost/api/citizen/medical',
        jsonBody('PUT', SAMPLE, cookieHeader(token)),
      ),
      world.deps,
    );

    const del = await handleDeleteMedicalProfile(
      new Request('http://localhost/api/citizen/medical', {
        method: 'DELETE',
        headers: cookieHeader(token),
      }),
      world.deps,
    );
    expect(del.status).toBe(204);
    expect(world.medicalStore.rows.size).toBe(0);
  });
});

describe('encryption at rest (SECURITY.md §8.2)', () => {
  it('stores an opaque ciphertext that contains no plaintext field', async () => {
    const token = await registerCitizen('crypto@example.com');
    await handlePutMedicalProfile(
      new Request(
        'http://localhost/api/citizen/medical',
        jsonBody('PUT', SAMPLE, cookieHeader(token)),
      ),
      world.deps,
    );

    const stored = [...world.medicalStore.rows.values()][0];
    expect(stored).toBeDefined();
    expect(stored?.ciphertext.startsWith('v1.')).toBe(true);
    // No distinctive sensitive value survives in the stored row. (Short 2-3 char tokens
    // like "O-" are omitted: base64url output can contain them by chance, which would
    // make the assertion flaky without proving a leak - the distinctive terms below do.)
    for (const secret of ['penicillin', 'asthma', 'salbutamol', 'pacemaker', 'spouse']) {
      expect(stored?.ciphertext).not.toContain(secret);
    }
  });
});

describe('owner isolation + auth', () => {
  it('a different citizen cannot read another citizen profile', async () => {
    const owner = await registerCitizen('owner@example.com');
    await handlePutMedicalProfile(
      new Request(
        'http://localhost/api/citizen/medical',
        jsonBody('PUT', SAMPLE, cookieHeader(owner)),
      ),
      world.deps,
    );

    // Another citizen's session only ever resolves to their own (empty) profile.
    const other = await registerCitizen('other@example.com');
    const get = await handleGetMedicalProfile(
      new Request('http://localhost/api/citizen/medical', { headers: cookieHeader(other) }),
      world.deps,
    );
    const payload = (await get.json()) as { profile: { bloodType: string | null } };
    expect(payload.profile.bloodType).toBeNull();
  });

  it('rejects an unauthenticated request on every verb', async () => {
    const get = await handleGetMedicalProfile(
      new Request('http://localhost/api/citizen/medical'),
      world.deps,
    );
    expect(get.status).toBe(401);

    const put = await handlePutMedicalProfile(
      new Request('http://localhost/api/citizen/medical', jsonBody('PUT', SAMPLE)),
      world.deps,
    );
    expect(put.status).toBe(401);

    const del = await handleDeleteMedicalProfile(
      new Request('http://localhost/api/citizen/medical', { method: 'DELETE' }),
      world.deps,
    );
    expect(del.status).toBe(401);
  });
});
