/**
 * In-memory `AuthStore` (TESTING.md §4.3).
 *
 * The service, route and page layers are exercised without Postgres; the adapter's
 * SQL is verified by the migration reset, not by unit tests that would need a server.
 */

import { DUMMY_PASSWORD_HASH } from '../../src/lib/auth/password';
import { displayName } from '../../src/lib/auth/view';
import type {
  AdminResponderRow,
  AgencySummary,
  AssignableResponder,
  AuthEventRecord,
  AuthEventType,
  AuthStore,
  CreateResponderInput,
  OfficeSummary,
  ResponderRecord,
  ResponderSessionRecord,
  UpdateResponderPatch,
} from '../../src/lib/auth/types';
import { AGENCY_ID, OFFICE_ID, TENANT_ID, TEST_PASSWORD } from './fixtures';

export interface MemoryAuthStore extends AuthStore {
  readonly sessions: Map<string, ResponderSessionRecord>;
  readonly events: AuthEventRecord[];
  /** Seed a responder. `email` defaults from `callsign` when only a callsign is given. */
  seedResponder(
    overrides: Partial<ResponderRecord> & {
      readonly callsign?: string | null;
      readonly email?: string;
    },
  ): ResponderRecord;
}

export interface MemoryAuthStoreOptions {
  readonly now: () => number;
  readonly offices?: readonly OfficeSummary[];
  readonly agencies?: readonly AgencySummary[];
}

export const TEST_PASSWORD_HASH = DUMMY_PASSWORD_HASH;
export { TEST_PASSWORD };

const DEFAULT_OFFICES: readonly OfficeSummary[] = [
  { id: OFFICE_ID, name: 'Cebu City DRRMO', kind: 'LGU' },
  { id: 'office-lahug', name: 'Barangay Lahug', kind: 'BARANGAY' },
];

const DEFAULT_AGENCIES: readonly AgencySummary[] = [
  { id: AGENCY_ID, name: 'Bureau of Fire Protection', code: 'BFP' },
];

let sequence = 0;
const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${sequence}`;
};

export function createMemoryAuthStore(options: MemoryAuthStoreOptions): MemoryAuthStore {
  const responders = new Map<string, ResponderRecord>();
  const sessions = new Map<string, ResponderSessionRecord>();
  const events: AuthEventRecord[] = [];
  const offices = options.offices ?? DEFAULT_OFFICES;
  const agencies = options.agencies ?? DEFAULT_AGENCIES;

  function seedResponder(
    overrides: Partial<ResponderRecord> & {
      readonly callsign?: string | null;
      readonly email?: string;
    },
  ): ResponderRecord {
    const callsign = overrides.callsign ?? null;
    // Default a login email from the callsign so existing tests that seed by callsign
    // keep working; an explicit email wins.
    const email =
      overrides.email ?? `${(callsign ?? overrides.id ?? nextId('r')).toLowerCase()}@aira.test`;
    const record: ResponderRecord = {
      id: overrides.id ?? nextId('responder'),
      email,
      callsign,
      role: overrides.role ?? 'RESPONDER',
      passwordHash: overrides.passwordHash ?? DUMMY_PASSWORD_HASH,
      active: overrides.active ?? true,
      tenantId: overrides.tenantId ?? TENANT_ID,
      officeId: overrides.officeId ?? OFFICE_ID,
      officeName: overrides.officeName ?? 'Cebu City DRRMO',
      agencyId: overrides.agencyId ?? null,
      agencyName: overrides.agencyName ?? null,
      mustChangePassword: overrides.mustChangePassword ?? false,
      failedAttempts: overrides.failedAttempts ?? 0,
      lockedUntil: overrides.lockedUntil ?? null,
      lastLoginAt: overrides.lastLoginAt ?? null,
    };

    responders.set(record.id, record);
    return record;
  }

  function liveSessions(responderId: string): number {
    const now = options.now();
    let count = 0;
    for (const session of sessions.values()) {
      if (
        session.responderId === responderId &&
        session.revokedAt === null &&
        session.expiresAt > now
      ) {
        count += 1;
      }
    }
    return count;
  }

  function inOfficeScope(officeId: string, scopeId: string): boolean {
    const scope = offices.find((office) => office.id === scopeId);
    return officeId === scopeId || scope?.kind === 'LGU';
  }

  return {
    sessions,
    events,
    seedResponder,

    async findResponderByEmail(email) {
      const normalized = email.toLowerCase();
      for (const responder of responders.values()) {
        if (responder.email.toLowerCase() === normalized) {
          return responder;
        }
      }
      return null;
    },

    async findResponderById(id) {
      return responders.get(id) ?? null;
    },

    async markLoginFailure(responderId, { now, lockMs, threshold }) {
      const responder = responders.get(responderId);
      if (!responder) {
        return { failedAttempts: 0, lockedUntil: null };
      }

      const failedAttempts = responder.failedAttempts + 1;
      const lockedUntil = failedAttempts >= threshold ? now + lockMs : responder.lockedUntil;

      const updated: ResponderRecord = { ...responder, failedAttempts, lockedUntil };
      responders.set(responderId, updated);

      return { failedAttempts, lockedUntil };
    },

    async markLoginSuccess(responderId, now) {
      const responder = responders.get(responderId);
      if (!responder) {
        return;
      }
      responders.set(responderId, {
        ...responder,
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
      });
    },

    async createSession(input) {
      const session: ResponderSessionRecord = {
        id: nextId('session'),
        responderId: input.responderId,
        tokenHash: input.tokenHash,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        lastSeenAt: input.createdAt,
        revokedAt: null,
      };
      sessions.set(session.id, session);
      return { id: session.id };
    },

    async findSessionByTokenHash(tokenHash) {
      for (const session of sessions.values()) {
        if (session.tokenHash === tokenHash) {
          return session;
        }
      }
      return null;
    },

    async touchSession(id, input) {
      const session = sessions.get(id);
      if (!session || session.revokedAt !== null) {
        return;
      }
      sessions.set(id, { ...session, lastSeenAt: input.lastSeenAt, expiresAt: input.expiresAt });
    },

    async revokeSession(id, input) {
      const session = sessions.get(id);
      if (!session || session.revokedAt !== null) {
        return;
      }
      sessions.set(id, { ...session, revokedAt: input.at });
    },

    async revokeResponderSessions(responderId, input) {
      let revoked = 0;
      for (const [id, session] of sessions) {
        if (
          session.responderId === responderId &&
          session.revokedAt === null &&
          id !== input.exceptSessionId
        ) {
          sessions.set(id, { ...session, revokedAt: input.at });
          revoked += 1;
        }
      }
      return revoked;
    },

    async updatePassword(responderId, input) {
      const responder = responders.get(responderId);
      if (!responder) {
        return;
      }
      responders.set(responderId, {
        ...responder,
        passwordHash: input.passwordHash,
        mustChangePassword: input.mustChangePassword,
      });
    },

    async createResponder(input: CreateResponderInput) {
      for (const responder of responders.values()) {
        if (responder.email.toLowerCase() === input.email.toLowerCase()) {
          throw Object.assign(new Error('duplicate_email'), { code: '23505' });
        }
      }

      const office = offices.find((row) => row.id === input.officeId);
      const agency = agencies.find((row) => row.id === input.agencyId);

      return seedResponder({
        email: input.email,
        callsign: input.callsign,
        role: input.role,
        passwordHash: input.passwordHash,
        officeId: input.officeId,
        officeName: office?.name ?? 'Unknown office',
        agencyId: input.agencyId,
        agencyName: agency?.name ?? null,
        mustChangePassword: input.mustChangePassword,
      });
    },

    async updateResponder(id: string, patch: UpdateResponderPatch) {
      const responder = responders.get(id);
      if (!responder) {
        return null;
      }

      const updated: ResponderRecord = {
        ...responder,
        role: patch.role ?? responder.role,
        active: patch.active ?? responder.active,
        mustChangePassword: patch.mustChangePassword ?? responder.mustChangePassword,
        failedAttempts: patch.unlock ? 0 : responder.failedAttempts,
        lockedUntil: patch.unlock ? null : responder.lockedUntil,
      };

      responders.set(id, updated);
      return updated;
    },

    async updateOwnProfile(id: string, patch: { readonly callsign: string | null }) {
      const responder = responders.get(id);
      if (!responder) {
        return null;
      }
      const updated: ResponderRecord = { ...responder, callsign: patch.callsign };
      responders.set(id, updated);
      return updated;
    },

    async listResponders(tenantId: string): Promise<readonly AdminResponderRow[]> {
      return [...responders.values()]
        .filter((responder) => responder.tenantId === tenantId)
        .map((responder) => ({
          ...responder,
          sessionCount: liveSessions(responder.id),
        }))
        .sort((left, right) => left.email.localeCompare(right.email));
    },

    async listAssignableResponders(officeId): Promise<readonly AssignableResponder[]> {
      return [...responders.values()]
        .filter((responder) => responder.active && inOfficeScope(responder.officeId, officeId))
        .map((responder) => ({
          id: responder.id,
          email: responder.email,
          callsign: responder.callsign,
          displayName: displayName(responder),
          role: responder.role,
          officeName: responder.officeName,
          agencyName: responder.agencyName,
        }))
        .sort((left, right) => left.email.localeCompare(right.email));
    },

    async listOffices(_tenantId: string) {
      void _tenantId;
      return offices;
    },

    async listAgencies() {
      return agencies;
    },

    async appendAuthEvent(input) {
      events.push({
        id: nextId('event'),
        responderId: input.responderId ?? null,
        sessionId: input.sessionId ?? null,
        event: input.event as AuthEventType,
        callsign: input.callsign ?? null,
        detail: input.detail ?? null,
        createdAt: input.at ?? options.now(),
      });
    },

    async listAuthEvents({ limit, before }) {
      return events
        .filter((event) => before === undefined || event.createdAt < before)
        .slice()
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, limit);
    },
  };
}
