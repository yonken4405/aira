/**
 * @vitest-environment node
 *
 * Oversight metrics aggregation (PRODUCT.md §5). Pure counts + durations, no PII.
 */

import { describe, expect, it } from 'vitest';

import { computeMetrics } from '../src/lib/metrics';
import { makeIncident, OFFICE_ID } from './support/fixtures';

describe('computeMetrics', () => {
  it('returns zeroed metrics for an empty office', () => {
    const m = computeMetrics([]);
    expect(m.total).toBe(0);
    expect(m.active).toBe(0);
    expect(m.activeUnits).toBe(0);
    expect(m.avgResolveMinutes).toBeNull();
    expect(m.byStatus.QUEUED).toBe(0);
  });

  it('counts by status and category', () => {
    const m = computeMetrics([
      makeIncident({ id: 'a', category: 'SUNOG', status: 'QUEUED' }),
      makeIncident({ id: 'b', category: 'SUNOG', status: 'DISPATCHED', assignedToId: 'r1' }),
      makeIncident({
        id: 'c',
        category: 'MEDIKAL',
        status: 'RESOLVED',
        resolvedAt: '2026-10-22T08:10:00.000Z',
      }),
    ]);
    expect(m.total).toBe(3);
    expect(m.byCategory.SUNOG).toBe(2);
    expect(m.byCategory.MEDIKAL).toBe(1);
    expect(m.byStatus.QUEUED).toBe(1);
    expect(m.byStatus.RESOLVED).toBe(1);
  });

  it('counts active incidents and distinct active units', () => {
    const m = computeMetrics([
      makeIncident({ id: 'a', status: 'DISPATCHED', assignedToId: 'r1' }),
      makeIncident({ id: 'b', status: 'EN_ROUTE', assignedToId: 'r1' }), // same unit
      makeIncident({ id: 'c', status: 'ON_SCENE', assignedToId: 'r2' }),
      makeIncident({
        id: 'd',
        status: 'RESOLVED',
        assignedToId: 'r3',
        resolvedAt: '2026-10-22T08:05:00.000Z',
      }),
    ]);
    expect(m.active).toBe(3);
    expect(m.activeUnits).toBe(2); // r1, r2 - resolved r3 excluded
  });

  it('averages resolution minutes over resolved incidents only', () => {
    const m = computeMetrics([
      makeIncident({
        id: 'a',
        reportedAt: '2026-10-22T08:00:00.000Z',
        status: 'RESOLVED',
        resolvedAt: '2026-10-22T08:10:00.000Z', // 10 min
      }),
      makeIncident({
        id: 'b',
        reportedAt: '2026-10-22T08:00:00.000Z',
        status: 'RESOLVED',
        resolvedAt: '2026-10-22T08:20:00.000Z', // 20 min
      }),
      makeIncident({ id: 'c', status: 'QUEUED' }), // ignored
    ]);
    expect(m.avgResolveMinutes).toBe(15);
  });

  it('builds a per-office count for the barangay heatmap', () => {
    const m = computeMetrics([
      makeIncident({ id: 'a', officeId: OFFICE_ID }),
      makeIncident({ id: 'b', officeId: OFFICE_ID }),
      makeIncident({ id: 'c', officeId: 'barangay-2' }),
    ]);
    expect(m.byOffice[OFFICE_ID]).toBe(2);
    expect(m.byOffice['barangay-2']).toBe(1);
  });
});
