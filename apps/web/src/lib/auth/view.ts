/**
 * Server -> browser projections for account data.
 *
 * Anything that crosses into a client component or a JSON response goes through
 * here, so a password hash can never be serialised by accident (SECURITY.md §4.4).
 */

import type { AuthenticatedPrincipal, ResponderRecord, ResponderView, Viewer } from './types';

/**
 * Human label for a responder: the operational callsign when set, otherwise the email
 * local-part. Used on map markers, the queue, and audit text (email login replaced the
 * callsign; the callsign is now an optional display label).
 */
export function displayName(record: {
  readonly callsign: string | null;
  readonly email: string;
}): string {
  if (record.callsign && record.callsign.trim().length > 0) {
    return record.callsign;
  }
  const local = record.email.split('@')[0] ?? record.email;
  return local;
}

export function toResponderView(record: ResponderRecord, sessionCount = 0): ResponderView {
  return {
    id: record.id,
    email: record.email,
    callsign: record.callsign,
    displayName: displayName(record),
    role: record.role,
    active: record.active,
    officeId: record.officeId,
    officeName: record.officeName,
    agencyId: record.agencyId,
    agencyName: record.agencyName,
    mustChangePassword: record.mustChangePassword,
    lockedUntil: record.lockedUntil,
    lastLoginAt: record.lastLoginAt,
    sessionCount,
  };
}

export function viewerOfPrincipal(principal: AuthenticatedPrincipal): Viewer {
  return {
    id: principal.responderId,
    email: principal.email,
    callsign: principal.callsign,
    displayName: displayName({ callsign: principal.callsign, email: principal.email }),
    role: principal.role,
    tenantId: principal.tenantId,
    officeName: principal.officeName,
    mustChangePassword: principal.mustChangePassword,
  };
}
