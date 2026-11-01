/**
 * In-memory `PlatformStore` for platform-tier tests (TESTING.md §4.3).
 */

import type { AgencyType, EmergencyCategoryId } from '@aira/ui';

import { DUMMY_PASSWORD_HASH } from '../../src/lib/auth/password';
import type {
  AgencyRecord,
  CapabilityConfig,
  CreateTenantInput,
  OfficePin,
  PlatformAdminRecord,
  PlatformSessionRecord,
  PlatformStore,
  TenantRecord,
  TenantStatus,
} from '../../src/lib/platform/types';

/** The four frozen Emergency_Category ids (mirrors `EmergencyCategoryId`). */
const FROZEN_CATEGORIES: readonly EmergencyCategoryId[] = ['SUNOG', 'MEDIKAL', 'KRIMEN', 'BAHA'];

/** Build a full `CapabilityConfig` from a per-tenant capability map. */
function buildCapabilityConfig(
  tenantMap: Map<EmergencyCategoryId, Set<AgencyType>>,
): CapabilityConfig {
  const result: Record<string, readonly AgencyType[]> = {};
  for (const cat of FROZEN_CATEGORIES) {
    result[cat] = tenantMap.has(cat) ? [...(tenantMap.get(cat) as Set<AgencyType>)] : [];
  }
  return result as CapabilityConfig;
}

export interface MemoryPlatformStore extends PlatformStore {
  readonly admins: Map<string, PlatformAdminRecord>;
  readonly sessions: Map<string, PlatformSessionRecord>;
  readonly tenants: Map<string, TenantRecord>;
  readonly offices: OfficePin[];
  /** Agency rows keyed by agency id. */
  readonly agencies: Map<string, AgencyRecord>;
  /** Per-tenant capability: tenantId → category → set of AgencyTypes. */
  readonly capability: Map<string, Map<EmergencyCategoryId, Set<AgencyType>>>;
  seedAdmin(
    overrides: Partial<PlatformAdminRecord> & { readonly email: string },
  ): PlatformAdminRecord;
}

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-${seq}`;
};

export function createMemoryPlatformStore(
  _now: () => number = () => Date.now(),
): MemoryPlatformStore {
  void _now;
  const admins = new Map<string, PlatformAdminRecord>();
  const sessions = new Map<string, PlatformSessionRecord>();
  const tenants = new Map<string, TenantRecord>();
  const offices: OfficePin[] = [];
  const agencies = new Map<string, AgencyRecord>();
  const capability = new Map<string, Map<EmergencyCategoryId, Set<AgencyType>>>();

  function seedAdmin(
    overrides: Partial<PlatformAdminRecord> & { readonly email: string },
  ): PlatformAdminRecord {
    const admin: PlatformAdminRecord = {
      id: overrides.id ?? nextId('padmin'),
      email: overrides.email,
      passwordHash: overrides.passwordHash ?? DUMMY_PASSWORD_HASH,
      active: overrides.active ?? true,
      failedAttempts: overrides.failedAttempts ?? 0,
      lockedUntil: overrides.lockedUntil ?? null,
      lastLoginAt: overrides.lastLoginAt ?? null,
    };
    admins.set(admin.id, admin);
    return admin;
  }

  return {
    admins,
    sessions,
    tenants,
    offices,
    agencies,
    capability,
    seedAdmin,

    async findAdminByEmail(email) {
      const normalized = email.toLowerCase();
      for (const admin of admins.values()) {
        if (admin.email.toLowerCase() === normalized) {
          return admin;
        }
      }
      return null;
    },

    async findAdminById(id) {
      return admins.get(id) ?? null;
    },

    async markLoginFailure(adminId, { now: at, lockMs, threshold }) {
      const admin = admins.get(adminId);
      if (!admin) {
        return { failedAttempts: 0, lockedUntil: null };
      }
      const failedAttempts = admin.failedAttempts + 1;
      const lockedUntil = failedAttempts >= threshold ? at + lockMs : admin.lockedUntil;
      admins.set(adminId, { ...admin, failedAttempts, lockedUntil });
      return { failedAttempts, lockedUntil };
    },

    async markLoginSuccess(adminId, at) {
      const admin = admins.get(adminId);
      if (admin) {
        admins.set(adminId, { ...admin, failedAttempts: 0, lockedUntil: null, lastLoginAt: at });
      }
    },

    async createSession(input) {
      const session: PlatformSessionRecord = {
        id: nextId('psession'),
        adminId: input.adminId,
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
      if (session && session.revokedAt === null) {
        sessions.set(id, { ...session, lastSeenAt: input.lastSeenAt, expiresAt: input.expiresAt });
      }
    },

    async revokeSession(id, input) {
      const session = sessions.get(id);
      if (session && session.revokedAt === null) {
        sessions.set(id, { ...session, revokedAt: input.at });
      }
    },

    async listTenants() {
      return [...tenants.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    async createTenantWithLgu(input: CreateTenantInput & { readonly now: number }) {
      for (const tenant of tenants.values()) {
        if (tenant.name.toLowerCase() === input.name.toLowerCase()) {
          throw Object.assign(new Error('duplicate_tenant'), { code: '23505' });
        }
      }
      const tenant: TenantRecord = {
        id: nextId('tenant'),
        name: input.name,
        region: input.region,
        province: input.province,
        status: 'active',
        createdAt: input.now,
      };
      tenants.set(tenant.id, tenant);
      offices.push({
        id: nextId('office'),
        tenantId: tenant.id,
        tenantName: tenant.name,
        name: input.lguName,
        kind: 'LGU',
        region: input.region,
        province: input.province,
        lat: input.lat,
        lon: input.lon,
        status: 'active',
      });
      return tenant;
    },

    async setTenantStatus(tenantId, status: TenantStatus) {
      const tenant = tenants.get(tenantId);
      if (!tenant) {
        return null;
      }
      const updated = { ...tenant, status };
      tenants.set(tenantId, updated);
      for (let i = 0; i < offices.length; i += 1) {
        const office = offices[i];
        if (office && office.tenantId === tenantId) {
          offices[i] = { ...office, status };
        }
      }
      return updated;
    },

    async listOfficePins() {
      return [...offices];
    },

    async lguOfficeIdForTenant(tenantId) {
      return offices.find((o) => o.tenantId === tenantId && o.kind === 'LGU')?.id ?? null;
    },

    // ── Responder-network: agencies ─────────────────────────────────────────

    async createAgency(input) {
      // Prove tenant existence
      if (!tenants.has(input.tenantId)) {
        return { status: 'tenant_not_found' };
      }

      // Trim name and code
      const name = input.name.trim();
      const code = input.code.trim();

      // Enforce per-tenant case-insensitive uniqueness
      for (const existing of agencies.values()) {
        if (existing.tenantId === input.tenantId) {
          if (existing.name.toLowerCase() === name.toLowerCase()) {
            throw Object.assign(new Error('dup'), { code: '23505' });
          }
          if (existing.code.toLowerCase() === code.toLowerCase()) {
            throw Object.assign(new Error('dup'), { code: '23505' });
          }
        }
      }

      const agency: AgencyRecord = {
        id: nextId('agency'),
        tenantId: input.tenantId,
        name,
        code,
        agencyType: input.agencyType,
        active: true,
      };
      agencies.set(agency.id, agency);
      return { status: 'ok', agency };
    },

    async listAgenciesForTenant(tenantId) {
      const result: AgencyRecord[] = [];
      for (const agency of agencies.values()) {
        if (agency.tenantId === tenantId) {
          result.push(agency);
        }
      }
      return result;
    },

    async findAgencyById(agencyId) {
      return agencies.get(agencyId) ?? null;
    },

    async renameAgency(agencyId, patch) {
      const agency = agencies.get(agencyId);
      if (!agency) {
        return null;
      }

      const newName = patch.name !== undefined ? patch.name : agency.name;
      const newCode = patch.code !== undefined ? patch.code : agency.code;

      // Enforce per-tenant uniqueness against other agencies (exclude self)
      for (const other of agencies.values()) {
        if (other.id === agencyId || other.tenantId !== agency.tenantId) {
          continue;
        }
        if (patch.name !== undefined && other.name.toLowerCase() === newName.toLowerCase()) {
          throw Object.assign(new Error('dup'), { code: '23505' });
        }
        if (patch.code !== undefined && other.code.toLowerCase() === newCode.toLowerCase()) {
          throw Object.assign(new Error('dup'), { code: '23505' });
        }
      }

      const updated: AgencyRecord = { ...agency, name: newName, code: newCode };
      agencies.set(agencyId, updated);
      return updated;
    },

    async setAgencyActive(agencyId, active) {
      const agency = agencies.get(agencyId);
      if (!agency) {
        return null;
      }
      const updated: AgencyRecord = { ...agency, active };
      agencies.set(agencyId, updated);
      return updated;
    },

    async findOfficeTenantId(officeId) {
      const office = offices.find((o) => o.id === officeId);
      return office?.tenantId ?? null;
    },

    // ── Responder-network: capability config ────────────────────────────────

    async readCapabilityConfig(tenantId) {
      const tenantMap = capability.get(tenantId);
      if (!tenantMap || tenantMap.size === 0) {
        return null;
      }
      return buildCapabilityConfig(tenantMap);
    },

    async setCapabilityForCategory(tenantId, category, agencyTypes) {
      let tenantMap = capability.get(tenantId);
      if (!tenantMap) {
        tenantMap = new Map<EmergencyCategoryId, Set<AgencyType>>();
        capability.set(tenantId, tenantMap);
      }

      // De-duplicate submitted types and replace the set for this category
      const deduplicated = new Set(agencyTypes);
      tenantMap.delete(category);
      tenantMap.set(category, deduplicated);

      return buildCapabilityConfig(tenantMap);
    },
  };
}
