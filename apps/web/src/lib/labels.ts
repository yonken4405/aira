/**
 * Display labels for roles and statuses. Copy lives in `@aira/ui` i18n
 * (PRODUCT.md §3), never inline in components.
 */

import { t } from '@aira/ui';

import type { IncidentStatus } from './incidents';
import type { PrincipalRole } from './auth/rbac';

export function roleLabel(role: PrincipalRole): string {
  switch (role) {
    case 'RESPONDER':
      return t('roleResponder');
    case 'DISPATCHER':
      return t('roleDispatcher');
    case 'ADMIN':
      return t('roleAdmin');
    case 'CITIZEN':
      return t('roleCitizen');
  }
}

export function statusLabel(status: IncidentStatus): string {
  switch (status) {
    case 'QUEUED':
      return t('statusQueued');
    case 'DISPATCHED':
      return t('statusDispatched');
    case 'EN_ROUTE':
      return t('statusEnRoute');
    case 'ON_SCENE':
      return t('statusOnScene');
    case 'RESOLVED':
      return t('statusResolved');
  }
}
