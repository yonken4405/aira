/**
 * Incident persistence port + Postgres adapter.
 *
 * Scoping is enforced in SQL, not in the UI: a field responder can only ever read
 * rows assigned to them, a dispatcher reads their office subtree (SECURITY.md §4.1).
 * The web layer never receives a query it can widen.
 */

import type { EmergencyCategoryId } from '@aira/ui';
import type { PoolClient } from 'pg';

import { query, queryOne, withTransaction } from './db';
import type { Incident, IncidentSource, IncidentStatus } from './incidents';
import type { RoutingCandidate } from './routing';

export type AssignOutcome =
  | { readonly status: 'ok'; readonly incident: Incident }
  | { readonly status: 'not_found' }
  | { readonly status: 'final' }
  | { readonly status: 'assignee_not_found' };

export type StatusOutcome =
  | { readonly status: 'ok'; readonly incident: Incident }
  | { readonly status: 'not_found' }
  | { readonly status: 'conflict' };

export interface IncidentsStore {
  /** The single LGU office of this deployment (PRODUCT.md §1), if seeded. */
  getDefaultOfficeId(): Promise<string | null>;
  listForOffice(officeId: string): Promise<readonly Incident[]>;
  listAssignedTo(responderId: string): Promise<readonly Incident[]>;
  findById(id: string): Promise<Incident | null>;
  /** True when the incident belongs to the office or one of its barangays. */
  isInOfficeScope(incidentId: string, officeId: string): Promise<boolean>;
  /**
   * Active field responders inside the office subtree, with their office centroid as a
   * base position and agency code - the inputs the routing engine ranks (PRODUCT.md §5).
   */
  listRoutingCandidates(officeId: string): Promise<readonly RoutingCandidate[]>;
  create(input: {
    readonly category: EmergencyCategoryId;
    readonly lat: number;
    readonly lon: number;
    readonly officeId: string;
    readonly source?: IncidentSource;
    readonly reporterCitizenId?: string | null;
    readonly at: number;
  }): Promise<Incident>;
  /**
   * Appends a MEDICAL_ACCESS audit event recording that a responder revealed the
   * reporting citizen's medical snapshot on this incident (SECURITY.md §8.3). The
   * detail never carries the profile body or coordinates.
   */
  recordMedicalAccess(input: {
    readonly incidentId: string;
    readonly actorId: string;
    readonly at: number;
  }): Promise<void>;
  /** Stores an opaque tracking-token hash for an incident (SECURITY.md §10). */
  createTrackingToken(input: {
    readonly incidentId: string;
    readonly tokenHash: string;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): Promise<void>;
  /** Resolves a tracking-token hash to its incident id if valid + unexpired. */
  resolveTrackingToken(tokenHash: string, now: number): Promise<string | null>;
  assign(input: {
    readonly incidentId: string;
    readonly responderId: string;
    readonly actorId: string;
    readonly at: number;
  }): Promise<AssignOutcome>;
  updateStatus(input: {
    readonly incidentId: string;
    readonly from: IncidentStatus;
    readonly to: IncidentStatus;
    readonly actorId: string;
    readonly at: number;
  }): Promise<StatusOutcome>;
}

interface IncidentRow {
  id: string;
  category: EmergencyCategoryId;
  lat: number;
  lon: number;
  reportedAt: Date;
  source: IncidentSource;
  status: IncidentStatus;
  assignedToId: string | null;
  assignedToCallsign: string | null;
  officeId: string;
  note: string | null;
  resolvedAt: Date | null;
  reporterCitizenId: string | null;
}

function mapIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    category: row.category,
    lat: row.lat,
    lon: row.lon,
    reportedAt: row.reportedAt.toISOString(),
    source: row.source,
    status: row.status,
    assignedToId: row.assignedToId,
    assignedToCallsign: row.assignedToCallsign,
    officeId: row.officeId,
    note: row.note,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    reporterCitizenId: row.reporterCitizenId,
  };
}

const INCIDENT_COLUMNS = `
  i.id,
  i.category,
  i.lat,
  i.lon,
  i.reported_at as "reportedAt",
  i.source,
  i.status,
  i.assigned_to_id as "assignedToId",
  r.callsign as "assignedToCallsign",
  i.office_id as "officeId",
  i.note,
  i.resolved_at as "resolvedAt",
  i.reporter_citizen_id as "reporterCitizenId"
`;

const INCIDENT_FROM = `
  from public.incidents i
  left join public.responders r on r.id = i.assigned_to_id
`;

const QUEUE_LIMIT = 200;

// Office subtree scope, hard-bounded to the starting office's tenant: the recursion
// only follows parent links WITHIN the same tenant, so a scope can never cross a tenant
// boundary even if a parent_id were ever mis-set (defense-in-depth, multi-tenant).
const OFFICE_SCOPE = `
  with recursive scope as (
    select id, tenant_id from public.offices where id = $1
    union all
    select o.id, o.tenant_id
      from public.offices o
      join scope s on o.parent_id = s.id and o.tenant_id = s.tenant_id
  )
`;

async function findById(id: string): Promise<Incident | null> {
  const row = await queryOne<IncidentRow>(
    `select ${INCIDENT_COLUMNS} ${INCIDENT_FROM} where i.id = $1 limit 1`,
    [id],
  );
  return row ? mapIncident(row) : null;
}

/**
 * Reads a row back inside the caller's transaction. Using the pool here would read
 * from a different connection and miss the uncommitted write.
 */
async function findByIdOn(client: PoolClient, id: string): Promise<Incident | null> {
  const result = await client.query(
    `select ${INCIDENT_COLUMNS} ${INCIDENT_FROM} where i.id = $1 limit 1`,
    [id],
  );
  const row = result.rows[0] as IncidentRow | undefined;
  return row ? mapIncident(row) : null;
}

export function createPostgresIncidentsStore(): IncidentsStore {
  return {
    async getDefaultOfficeId() {
      const row = await queryOne<{ id: string }>(
        `select id from public.offices where kind = 'LGU' and active order by created_at asc limit 1`,
      );
      return row?.id ?? null;
    },

    async listForOffice(officeId) {
      const rows = await query<IncidentRow>(
        `${OFFICE_SCOPE}
         select ${INCIDENT_COLUMNS}
           ${INCIDENT_FROM}
          where i.office_id in (select id from scope)
          order by i.reported_at desc
          limit ${QUEUE_LIMIT}`,
        [officeId],
      );
      return rows.map(mapIncident);
    },

    async listAssignedTo(responderId) {
      const rows = await query<IncidentRow>(
        `select ${INCIDENT_COLUMNS}
           ${INCIDENT_FROM}
          where i.assigned_to_id = $1
          order by i.reported_at desc
          limit ${QUEUE_LIMIT}`,
        [responderId],
      );
      return rows.map(mapIncident);
    },

    findById,

    async isInOfficeScope(incidentId, officeId) {
      const row = await queryOne<{ id: string }>(
        `${OFFICE_SCOPE}
         select i.id
           from public.incidents i
          where i.id = $2
            and i.office_id in (select id from scope)
          limit 1`,
        [officeId, incidentId],
      );
      return row !== null;
    },

    async listRoutingCandidates(officeId) {
      const rows = await query<{
        id: string;
        callsign: string;
        role: string;
        officeId: string;
        officeName: string;
        agencyCode: string | null;
        agencyName: string | null;
        lat: number | null;
        lon: number | null;
      }>(
        `${OFFICE_SCOPE}
         select r.id,
                r.callsign,
                r.role,
                r.office_id as "officeId",
                o.name as "officeName",
                a.code as "agencyCode",
                a.name as "agencyName",
                o.lat,
                o.lon
           from public.responders r
           join public.offices o on o.id = r.office_id
           left join public.agencies a on a.id = r.agency_id
          where r.active
            and r.role = 'RESPONDER'
            and r.office_id in (select id from scope)
          order by r.callsign asc`,
        [officeId],
      );

      return rows.map((row) => ({
        id: row.id,
        callsign: row.callsign,
        role:
          row.role === 'RESPONDER'
            ? 'RESPONDER'
            : row.role === 'DISPATCHER'
              ? 'DISPATCHER'
              : 'ADMIN',
        officeId: row.officeId,
        officeName: row.officeName,
        agencyCode: row.agencyCode,
        agencyName: row.agencyName,
        base: row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : null,
      }));
    },

    async create(input) {
      return withTransaction(async (client) => {
        const inserted = await client.query(
          `insert into public.incidents
             (category, lat, lon, status, source, reported_at, office_id, reporter_citizen_id)
           values ($1::emergency_category, $2, $3, 'QUEUED', $4::incident_source, $5, $6, $7)
           returning id`,
          [
            input.category,
            input.lat,
            input.lon,
            input.source ?? 'mesh',
            new Date(input.at),
            input.officeId,
            input.reporterCitizenId ?? null,
          ],
        );

        const id = (inserted.rows[0] as { id: string } | undefined)?.id;
        if (!id) {
          throw new Error('incident_insert_failed');
        }

        await client.query(
          `insert into public.incident_events (incident_id, event, to_status, detail)
           values ($1, 'INTAKE', 'QUEUED', 'mesh intake')`,
          [id],
        );

        const created = await findByIdOn(client, id);
        if (!created) {
          throw new Error('incident_read_after_insert_failed');
        }
        return created;
      });
    },

    async assign(input) {
      return withTransaction(async (client): Promise<AssignOutcome> => {
        const current = await client.query(
          `select i.id, i.status, i.assigned_to_id as "assignedToId", i.office_id as "officeId"
             from public.incidents i
            where i.id = $1
            for update`,
          [input.incidentId],
        );

        const row = current.rows[0] as
          { status: IncidentStatus; assignedToId: string | null; officeId: string } | undefined;

        if (!row) {
          return { status: 'not_found' };
        }
        if (row.status === 'RESOLVED') {
          return { status: 'final' };
        }

        const assignee = await client.query(
          `select id from public.responders where id = $1 and active limit 1`,
          [input.responderId],
        );
        if (assignee.rowCount === 0) {
          return { status: 'assignee_not_found' };
        }

        const nextStatus: IncidentStatus = row.status === 'QUEUED' ? 'DISPATCHED' : row.status;
        const event = row.assignedToId ? 'REASSIGNED' : 'ASSIGNED';

        await client.query(
          `update public.incidents
              set assigned_to_id = $2,
                  assigned_by_id = $3,
                  assigned_at = $4,
                  status = $5::incident_status
            where id = $1`,
          [input.incidentId, input.responderId, input.actorId, new Date(input.at), nextStatus],
        );

        // ROUTED records the dispatch decision (which unit was routed to the
        // incident); ASSIGNED/REASSIGNED records the resulting assignment. Both are
        // append-only and never carry coordinates (SECURITY.md §4.5/§5).
        await client.query(
          `insert into public.incident_events
             (incident_id, actor_id, event, from_status, to_status, detail)
           values ($1, $2, 'ROUTED', $3, $4, 'routed to unit')`,
          [input.incidentId, input.actorId, row.status, nextStatus],
        );

        await client.query(
          `insert into public.incident_events
             (incident_id, actor_id, event, from_status, to_status, detail)
           values ($1, $2, $3, $4, $5, 'assignment')`,
          [input.incidentId, input.actorId, event, row.status, nextStatus],
        );

        const updated = await findByIdOn(client, input.incidentId);
        if (!updated) {
          throw new Error('incident_read_after_assign_failed');
        }
        return { status: 'ok', incident: updated };
      });
    },

    async updateStatus(input) {
      return withTransaction(async (client): Promise<StatusOutcome> => {
        const rows = await client.query(
          `update public.incidents
              set status = $3::incident_status,
                  resolved_at = case when $3::incident_status = 'RESOLVED' then $4 else null end
            where id = $1
              and status = $2::incident_status
          returning id`,
          [input.incidentId, input.from, input.to, new Date(input.at)],
        );

        if (rows.rowCount === 0) {
          // Either the row is gone or another operator moved it first.
          const exists = await findByIdOn(client, input.incidentId);
          return exists ? { status: 'conflict' } : { status: 'not_found' };
        }

        await client.query(
          `insert into public.incident_events
             (incident_id, actor_id, event, from_status, to_status, detail)
           values ($1, $2, 'STATUS', $3::incident_status, $4::incident_status, 'status update')`,
          [input.incidentId, input.actorId, input.from, input.to],
        );

        const updated = await findByIdOn(client, input.incidentId);
        if (!updated) {
          throw new Error('incident_read_after_status_failed');
        }
        return { status: 'ok', incident: updated };
      });
    },

    async recordMedicalAccess(input) {
      await query(
        `insert into public.incident_events (incident_id, actor_id, event, detail)
         values ($1, $2, 'MEDICAL_ACCESS', 'medical snapshot revealed')`,
        [input.incidentId, input.actorId],
      );
    },

    async createTrackingToken(input) {
      await query(
        `insert into public.incident_tracking_tokens (incident_id, token_hash, created_at, expires_at)
         values ($1, $2, $3, $4)`,
        [input.incidentId, input.tokenHash, new Date(input.createdAt), new Date(input.expiresAt)],
      );
    },

    async resolveTrackingToken(tokenHash, now) {
      const row = await queryOne<{ incidentId: string }>(
        `select incident_id as "incidentId"
           from public.incident_tracking_tokens
          where token_hash = $1 and expires_at > $2
          limit 1`,
        [tokenHash, new Date(now)],
      );
      return row?.incidentId ?? null;
    },
  };
}
