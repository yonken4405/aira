/**
 * In-memory `CitizenStore` for citizen-auth tests (TESTING.md §4.3).
 */

import type {
  CitizenLoginFailureResult,
  CitizenRecord,
  CitizenSessionRecord,
  CitizenStore,
  CreateCitizenInput,
} from '../../src/lib/citizen/types';

export interface MemoryCitizenStore extends CitizenStore {
  readonly citizens: CitizenRecord[];
  readonly sessions: CitizenSessionRecord[];
}

export function createMemoryCitizenStore(
  _options: { readonly now: () => number } = { now: () => Date.now() },
): MemoryCitizenStore {
  void _options;
  const citizens: CitizenRecord[] = [];
  const sessions: CitizenSessionRecord[] = [];
  let seq = 0;

  function replace(next: CitizenRecord): void {
    const index = citizens.findIndex((c) => c.id === next.id);
    if (index >= 0) {
      citizens[index] = next;
    }
  }

  return {
    citizens,
    sessions,

    async findByEmail(email) {
      return citizens.find((c) => c.email === email) ?? null;
    },

    async findByDeviceKeyHash(deviceKeyHash) {
      return citizens.find((c) => c.deviceKeyHash === deviceKeyHash) ?? null;
    },

    async findById(id) {
      return citizens.find((c) => c.id === id) ?? null;
    },

    async create(input: CreateCitizenInput) {
      // Mirror the DB unique constraints so conflict handling is exercised.
      if (input.email && citizens.some((c) => c.email === input.email)) {
        throw Object.assign(new Error('duplicate_email'), { code: '23505' });
      }
      if (input.deviceKeyHash && citizens.some((c) => c.deviceKeyHash === input.deviceKeyHash)) {
        throw Object.assign(new Error('duplicate_device'), { code: '23505' });
      }

      seq += 1;
      const citizen: CitizenRecord = {
        id: `citizen-${seq}`,
        email: input.email,
        deviceKeyHash: input.deviceKeyHash,
        passwordHash: input.passwordHash,
        emailVerified: input.emailVerified,
        active: true,
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
      };
      citizens.push(citizen);
      return citizen;
    },

    async deleteCitizen(id) {
      const index = citizens.findIndex((c) => c.id === id);
      if (index >= 0) {
        citizens.splice(index, 1);
      }
      // Drop any sessions the removed citizen directly owned so nothing dangles.
      for (let i = sessions.length - 1; i >= 0; i -= 1) {
        if (sessions[i]?.citizenId === id) {
          sessions.splice(i, 1);
        }
      }
    },

    async markLoginFailure(citizenId, opts): Promise<CitizenLoginFailureResult> {
      const citizen = citizens.find((c) => c.id === citizenId);
      if (!citizen) {
        return { failedAttempts: 0, lockedUntil: null };
      }
      const failedAttempts = citizen.failedAttempts + 1;
      const lockedUntil =
        failedAttempts >= opts.threshold ? opts.now + opts.lockMs : citizen.lockedUntil;
      replace({ ...citizen, failedAttempts, lockedUntil });
      return { failedAttempts, lockedUntil };
    },

    async markLoginSuccess(citizenId, now) {
      const citizen = citizens.find((c) => c.id === citizenId);
      if (citizen) {
        replace({ ...citizen, failedAttempts: 0, lockedUntil: null, lastLoginAt: now });
      }
    },

    async createSession(input) {
      seq += 1;
      const session: CitizenSessionRecord = {
        id: `citizen-session-${seq}`,
        citizenId: input.citizenId,
        tokenHash: input.tokenHash,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        lastSeenAt: input.createdAt,
        revokedAt: null,
      };
      sessions.push(session);
      return { id: session.id };
    },

    async findSessionByTokenHash(tokenHash) {
      return sessions.find((s) => s.tokenHash === tokenHash) ?? null;
    },

    async touchSession(id, input) {
      const index = sessions.findIndex((s) => s.id === id);
      if (index >= 0) {
        const existing = sessions[index];
        if (existing && existing.revokedAt === null) {
          sessions[index] = {
            ...existing,
            lastSeenAt: input.lastSeenAt,
            expiresAt: input.expiresAt,
          };
        }
      }
    },

    async revokeSession(id, input) {
      const existing = sessions.find((s) => s.id === id);
      // Mutate in place so a reference captured before revocation reflects the
      // stamped revokedAt (mirrors a real row update observed by a held handle).
      if (existing && existing.revokedAt === null) {
        (existing as { revokedAt: number | null }).revokedAt = input.at;
      }
    },
  };
}
