/**
 * Localization seam (PRODUCT.md §3).
 *
 * English is the shipped, primary language. Bisaya (`ceb`) and Tagalog (`tl`) are
 * planned: their dictionaries exist so copy is centralized today, but only `en` is in
 * `AVAILABLE_LOCALES`. When a locale ships, add it there and translate the missing keys
 * - every untranslated key falls back to English rather than showing a raw token.
 *
 * Rules: no UI string literals in components; add new copy here.
 */

import type { EmergencyCategory, EmergencyCategoryId } from './categories';
import { getCategory } from './categories';

export type Locale = 'en' | 'ceb' | 'tl';

export const DEFAULT_LOCALE: Locale = 'en';

/** Locales currently offered in the product UI. Localization is a later phase. */
export const AVAILABLE_LOCALES: readonly Locale[] = ['en'];

/** Locales with dictionaries scaffolded but not yet shipped. */
export const PLANNED_LOCALES: readonly Locale[] = ['ceb', 'tl'];

const EN_MESSAGES = {
  appName: 'AIRA',
  consoleTitle: 'Responder console',
  queued: 'Queued',
  meshStandby: 'Mesh link: standby',
  refresh: 'Refresh',
  refreshCached: 'Cached',
  incomingQueue: 'Incoming queue',
  filterAll: 'All',
  noQueued: 'No queued incidents in this category.',
  loadingIncidents: 'Loading incidents',
  loadFailed: 'Could not load incidents. Showing the last cached data.',
  retry: 'Retry',
  responderRouting: 'Responder routing',
  noIncident: 'No incident selected.',
  meshPayload: 'Mesh payload',
  sourceMesh: 'Mesh relay',
  sourceManual: 'Manual entry',
  notifications: 'Notifications',
  dismissNotification: 'Dismiss notification',
  responderStation: 'Responder station (mock origin)',
  responderUnit: 'Unit',
  lastSeen: 'last seen',
  incidentMarker: '{category} incident {id}',

  // Civilian tracking view (DESIGN.md §5a)
  trackTitle: 'Tracking your report',
  trackSubtitle: 'This page updates automatically.',
  trackStatusLabel: 'Status',
  trackUnitLabel: 'Responding unit',
  trackUnitEnRoute: 'A unit is on the way.',
  trackNoUnitYet: 'Waiting for a unit to be assigned.',
  trackExpiredTitle: 'This tracking link has expired',
  trackExpiredBody: 'For your safety, tracking links are only active for a short time.',
  trackUnavailableTitle: 'Tracking is unavailable',
  trackUnavailableBody: 'No signal right now. This page will keep trying.',
  trackResolvedTitle: 'This emergency has been resolved',
  timelineQueued: 'Report received',
  timelineDispatched: 'Unit assigned',
  timelineEnRoute: 'Unit en route',
  timelineOnScene: 'Unit on scene',
  timelineResolved: 'Resolved',
  distance: 'Distance',
  eta: 'ETA (straight line)',
  coordinates: 'Coordinates',
  status: 'Status',
  assign: 'Assign',
  assigned: 'Assigned',
  dispatchMock: 'Assignment is recorded in the incident log under your account.',
  confirmTitle: 'Assign this incident?',
  confirmBody: 'Assign {unit} to incident {id}?',
  confirmAction: 'Confirm assignment',
  cancelAction: 'Cancel',
  toastAssignedTitle: 'Dispatch confirmed',
  toastAssignedBody: '{unit} assigned to {id}.',
  toastAssignErrorTitle: 'Assignment failed',
  toastAssignErrorBody: 'Could not assign {unit}. Try again.',
  confirmStatusTitle: 'Update incident status?',
  confirmStatusBody: 'Move incident {id} to {status}?',
  confirmStatusAction: 'Confirm update',
  toastStatusTitle: 'Status updated',
  toastStatusBody: '{id} is now {status}.',
  toastStatusErrorTitle: 'Status update failed',
  toastStatusErrorBody: 'Could not update {id}. Try again.',
  assignTo: 'Assign to',
  advancingStatus: 'Updating',
  routingSuggestions: 'Nearest units',
  routingCapable: 'Capable',
  routingNotCapable: 'Other agency',
  routingNoSuggestions: 'No nearby units to suggest.',
  routingNearest: 'Nearest',
  toastCachedTitle: 'Serving cached incidents',
  toastCachedBody: 'Live refresh failed; showing data from the local cache.',
  toastLoadErrorTitle: 'Could not refresh incidents',
  emergencyPrompt: 'What is your emergency?',
  emergencyHint: 'Tap one. It sends instantly, even offline.',
  lastTransmission: 'Last transmission',
  mockGps: 'Mock GPS',
  selectLanguageSoon: 'Bisaya / Tagalog coming soon',

  // Offline-first mesh states (DESIGN.md §5a, PRODUCT.md §1b)
  meshBroadcasting: 'Mesh: broadcasting',
  meshOfflineQueued: 'Offline - queued ({count})',
  meshOffline: 'Offline',
  outboxTitle: 'Pending alerts',
  outboxQueuedHint: 'Will broadcast over the mesh when a link is found.',
  outboxSent: 'Broadcast',
  outboxQueuedState: 'Queued',
  noPendingAlerts: 'No pending alerts.',

  // Authentication (SECURITY.md §4)
  signIn: 'Sign in',
  signingIn: 'Signing in',
  signOut: 'Sign out',
  signOutTitle: 'Sign out of AIRA?',
  signOutBody: 'You will need to sign in again to return to this area.',
  signedOut: 'Signed out',
  signOutFailed: 'Sign out failed',
  callsign: 'Callsign',
  password: 'Password',
  loginTitle: 'Responder sign-in',
  loginSubtitle: 'Authorised DRRM personnel only.',
  loginInvalid: 'Email or password is incorrect.',
  loginLocked: 'Too many attempts. Try again in {minutes} minutes.',
  loginRateLimited: 'Too many attempts from this device. Wait a minute and try again.',
  loginUnavailable: 'Authentication is unavailable. Try again shortly.',
  callsignHint: 'Optional radio/display label.',
  email: 'Email',
  emailHint: 'Used to sign in.',
  callsignOptional: 'Callsign (optional)',
  emailTaken: 'That email is already in use.',
  responderLabel: 'Responder',
  loginEmailHint: 'Your work email address.',
  signedInAs: 'Signed in as',
  roleResponder: 'Responder',
  roleDispatcher: 'Dispatcher',
  roleAdmin: 'DRRM administrator',
  roleCitizen: 'Resident (app only)',
  sessionExpiredTitle: 'Session ended',
  sessionExpiredBody: 'Sign in again to continue.',
  changePassword: 'Change password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  confirmPassword: 'Confirm new password',
  passwordMismatch: 'Passwords do not match.',
  passwordTooShort: 'Use at least 12 characters.',
  passwordWeak: 'Choose a stronger password.',
  passwordCurrentInvalid: 'The current password is incorrect.',
  passwordUpdated: 'Password updated',
  passwordUpdateFailed: 'Could not update the password.',
  mustChangePasswordNotice: 'Set a new password before continuing.',
  save: 'Save',
  forbiddenTitle: 'Not authorised',
  forbiddenBody: 'This account does not have access to this area.',
  backToConsole: 'Back to console',

  // Dispatcher / responder actions
  assignUnit: 'Assign',
  reassignUnit: 'Reassign',
  assigning: 'Assigning',
  selectUnit: 'Unit',
  noUnits: 'No responders available in this office.',
  enRoute: 'En route',
  onScene: 'On scene',
  resolve: 'Resolve',
  navigate: 'Navigate',
  navigateHint: 'Opens Google Maps directions to the scene.',
  statusQueued: 'Queued',
  statusDispatched: 'Dispatched',
  statusEnRoute: 'En route',
  statusOnScene: 'On scene',
  statusResolved: 'Resolved',
  noAssigned: 'No incidents assigned to you.',
  assignedToLabel: 'Assigned to',
  unassigned: 'Unassigned',
  assignFailedTitle: 'Assignment failed',
  assignFailedBody: 'Could not assign {unit}. Try again.',
  statusFailedTitle: 'Status update failed',
  statusFailedBody: 'Could not update {id}. Try again.',
  actionNotAllowed: 'This account cannot perform that action.',

  // Administration
  adminTitle: 'DRRM administration',
  adminAccounts: 'Accounts',
  adminOverview: 'Live map',
  adminDashboards: 'Dashboards',
  adminAudit: 'Audit log',

  // Admin oversight (DESIGN.md §5a)
  overviewTitle: 'Operations overview',
  overviewReadOnly: 'Read-only. Dispatching is handled by duty dispatchers.',
  metricsTitle: 'Response metrics',
  metricTotal: 'Total incidents',
  metricActive: 'Active',
  metricActiveUnits: 'Active units',
  metricAvgResolve: 'Avg. resolution',
  metricsByStatus: 'By status',
  metricsByCategory: 'By category',
  metricsByOffice: 'By barangay',
  metricMinutes: '{value} min',
  metricNone: 'n/a',
  respondersTitle: 'Responders',
  newResponder: 'New responder',
  createResponder: 'Create responder',
  role: 'Role',
  office: 'Office',
  agency: 'Agency',
  agencyNone: 'No agency',
  activeLabel: 'Status',
  activeValue: 'Active',
  inactiveValue: 'Inactive',
  lockedValue: 'Locked',
  lastLogin: 'Last login',
  never: 'Never',
  sessions: 'Sessions',
  deactivateAction: 'Deactivate',
  activateAction: 'Activate',
  unlockAction: 'Unlock',
  revokeSessionsAction: 'Revoke sessions',
  deactivateTitle: 'Deactivate this account?',
  deactivateBody: '{callsign} is signed out immediately and cannot sign in.',
  revokeTitle: 'Revoke all sessions?',
  revokeBody: '{callsign} must sign in again on every device.',
  confirmDeactivate: 'Deactivate account',
  oneTimePassword: 'One-time password',
  oneTimePasswordHint: 'Copy it now. It is shown once and never stored in readable form.',
  dismiss: 'Dismiss',
  accountCreated: 'Account created',
  accountUpdated: 'Account updated',
  updateFailed: 'Update failed',
  saving: 'Saving',
  callsignTaken: 'That callsign is already in use.',
  createFailedTitle: 'Could not create the account',
  createFailedBody: 'Check the callsign, office and try again.',
  weakPasswordBody: 'Use at least 12 characters and do not reuse the callsign.',
  sessionsRevokedTitle: 'Sessions revoked',
  sessionsRevokedBody: '{callsign} must sign in again on every device.',
  accountUnlocked: 'Account unlocked',
  accountActivated: 'Account activated',
  accountDeactivated: 'Account deactivated',
  roleChangedTitle: 'Role updated',
  roleChangedBody: '{callsign} is now {role}.',
  roleChangeTitle: 'Change this role?',
  roleChangeBody: '{callsign} becomes {role} and is signed out to pick up the new permissions.',
  confirmRoleChange: 'Change role',
  unlockTitle: 'Unlock this account?',
  unlockBody: '{callsign} can sign in again immediately.',
  auditEmpty: 'No authentication events yet.',

  // Platform operator / superadmin console (multi-tenant)
  platformTitle: 'Platform operations',
  platformTenants: 'Partner offices',
  platformMap: 'Nationwide map',
  newTenant: 'Onboard office',
  tenantName: 'Office name',
  tenantRegion: 'Region',
  tenantProvince: 'Province',
  tenantLgu: 'LGU office name',
  tenantLat: 'Latitude',
  tenantLon: 'Longitude',
  tenantStatus: 'Status',
  tenantActive: 'Active',
  tenantSuspended: 'Suspended',
  suspendTenant: 'Suspend',
  activateTenant: 'Activate',
  suspendTenantTitle: 'Suspend this office?',
  suspendTenantBody: '{tenant} loses access immediately until it is reactivated.',
  activateTenantTitle: 'Activate this office?',
  activateTenantBody: '{tenant} regains access to the platform.',
  createTenantAction: 'Onboard office',
  tenantCreated: 'Office onboarded',
  tenantExists: 'An office with that name already exists.',
  tenantInvalid: 'Check the office details and try again.',
  bootstrapAdmin: 'Create first admin',
  bootstrapAdminTitle: 'Create the first DRRM admin',
  bootstrapAdminBody: 'Provision the first administrator account for {tenant}.',
  adminEmail: 'Admin email',
  adminProvisioned: 'Admin account created',
  noTenants: 'No partner offices yet.',
  pinFilterRegion: 'Region',
  pinFilterAll: 'All regions',
  pinSearch: 'Search office or tenant',
  mapOfficeCount: '{count} offices',
  eventLabel: 'Event',
  timeLabel: 'Time',
  actorLabel: 'Actor',
  detailLabel: 'Detail',

  // Theme preference control (R2)
  themeLabel: 'Appearance',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',

  // App shell header (R3)
  shellProfile: 'Profile',
  shellSettings: 'Settings',
  shellNotificationsBell: 'Notifications',
  shellNotificationsBellCount: 'Notifications, {count} unread',
  shellPrimaryNav: 'Primary navigation',

  // Notification Center bell island (R8, R20.5)
  notificationsEmpty: 'No notifications yet.',
  markAllRead: 'Mark all read',

  // Account password area under App_Shell (R5)
  accountPasswordHeading: 'Account security',
  accountPasswordSubtitle: 'Update the password for your account.',

  // Profile common feature under App_Shell (R6)
  profileTitle: 'Profile',
  profileSubtitle: 'Your account details.',
  profileEmailLabel: 'Email',
  displayNameLabel: 'Display name',
  callsignLabel: 'Callsign',
  displayNameRequired: 'Enter a display name.',
  profileSaved: 'Profile updated',
  profileSaveFailed: 'Could not update your profile.',

  // Settings common feature under App_Shell (R7)
  settingsTitle: 'Settings',
  settingsSubtitle: 'Appearance and notification delivery.',
  settingsAppearanceHeading: 'Appearance',
  settingsNotificationsHeading: 'Notifications',
  settingsNotificationsHint: 'Choose how AIRA delivers alerts to you.',
  channelInApp: 'In-app notifications',
  channelInAppLocked: 'Always on for critical warnings.',
  channelEmail: 'Email notifications',
  channelWebPush: 'Web push notifications',
  pushDenied:
    'Web push is blocked. Allow notifications for this site in your browser settings to enable it.',
  pushUnsupported: 'This browser does not support web push notifications.',
  prefsSaved: 'Preferences updated',
  prefsSaveFailed: 'Could not update your preferences.',

  // Notification event copy (R10–R12). Titles/bodies carry no PII — recipient
  // identity comes from the addressed principal, not the rendered text.
  notifyIncidentAssignedTitle: 'New incident assigned',
  notifyIncidentAssignedBody:
    'You have been assigned to a new incident. Open the console for details.',
  notifyAccountRoleChangedTitle: 'Your role has changed',
  notifyAccountRoleChangedBody: 'An administrator updated your role. Sign in again to continue.',
  notifyAccountDeactivatedTitle: 'Your account was deactivated',
  notifyAccountDeactivatedBody:
    'Your account has been deactivated. Contact your administrator for assistance.',
  notifyAccountUnlockedTitle: 'Your account was unlocked',
  notifyAccountUnlockedBody: 'An administrator unlocked your account. You can sign in again.',
  notifyAccountLockedTitle: 'Your account was locked',
  notifyAccountLockedBody:
    'Too many failed sign-in attempts locked your account. It will unlock automatically, or ask an administrator to unlock it.',
  notifyTenantOnboardedTitle: 'New partner office onboarded',
  notifyTenantOnboardedBody: 'A new partner office has been onboarded to the platform.',
  notifyTenantSuspendedTitle: 'Partner office suspended',
  notifyTenantSuspendedBody: 'A partner office has been suspended on the platform.',

  // Mobile citizen account + medical profile (mobile-citizen-account spec).
  // Tier-2 enrichment surfaces reached from the SOS grid; English-primary Operate-Mode copy.

  // Error -> copy mapping (design "Error -> Copy_Catalog mapping" table).
  citizenInvalidEmail: 'Enter a valid email address.',
  citizenWeakPassword: 'Choose a stronger password.',
  citizenRegistrationUnavailable: 'Registration is unavailable right now. Try again shortly.',
  citizenRateLimited: 'Too many attempts. Wait a moment and try again.',
  citizenInvalidCredentials: 'Email or password is incorrect.',
  citizenAccountLocked: 'Too many attempts. Try again in {minutes} minutes.',
  citizenDeviceRetryFailed: 'Could not set up this device. Try again.',
  citizenDeviceUnavailable: 'Could not reach the server. Try again shortly.',
  citizenMedicalLoadFailed: 'Could not load your medical profile.',
  citizenMedicalSaveFailed: 'Could not save your medical profile. Your edits are kept.',
  citizenMedicalInvalid: 'Check the highlighted fields and try again.',
  citizenContactInvalid: 'Each contact needs a name and a phone number.',
  citizenOfflineUnavailable: 'Unavailable offline. The SOS grid still works.',
  citizenSessionExpired: 'Your session ended. Sign in again to continue.',
  citizenGenericError: 'Something went wrong. Try again.',

  // Account hub + register/login screen copy.
  citizenAccountTitle: 'Account',
  citizenRegister: 'Create account',
  citizenLogin: 'Sign in',
  citizenUseDeviceKey: 'Continue without an email',
  citizenEmailLabel: 'Email',
  citizenPasswordLabel: 'Password',
  citizenSignOut: 'Sign out',
  citizenSignOutConfirmTitle: 'Sign out?',
  citizenSignOutConfirmBody: 'You can sign in again any time. The SOS grid stays available.',
  citizenDeleteAccount: 'Delete account',
  citizenDeleteAccountConfirmTitle: 'Delete your account?',
  citizenDeleteAccountConfirmBody:
    'This removes your account and medical profile for good. Your past SOS reports stay anonymous.',

  // Offline treatment on Tier-2 surfaces.
  citizenOfflineTitle: 'Unavailable offline',

  // Medical profile screen copy.
  citizenMedicalTitle: 'Medical profile',
  citizenMedicalEmpty: 'No medical details yet. Add what a responder should know.',
  citizenBloodType: 'Blood type',
  citizenAgeBand: 'Age range',
  citizenAllergies: 'Allergies',
  citizenConditions: 'Conditions',
  citizenMedications: 'Medications',
  citizenNotes: 'Notes',
  citizenContacts: 'Emergency contacts',
  citizenContactName: 'Name',
  citizenContactPhone: 'Phone',
  citizenContactRelation: 'Relation',
  citizenAddContact: 'Add contact',
  citizenRemoveContact: 'Remove contact',
  citizenDeleteProfile: 'Delete profile',
  citizenDeleteProfileConfirmTitle: 'Delete medical profile?',
  citizenDeleteProfileConfirmBody: 'This removes all of your medical details.',
} as const;

export type MessageKey = keyof typeof EN_MESSAGES;
export type Messages = Record<MessageKey, string>;

/** Bisaya dictionary - preview entries only; not shipped (AVAILABLE_LOCALES = ['en']). */
const CEB_MESSAGES: Partial<Messages> = {
  emergencyPrompt: 'Unsa ang imong emerhensya?',
  emergencyHint: 'Pilia ang usa. Ipadala dayon, bisan walay internet.',
  lastTransmission: 'Katapusang transmission',
};

/** Tagalog dictionary - placeholder; not shipped. */
const TL_MESSAGES: Partial<Messages> = {};

const DICTIONARIES: Record<Locale, Partial<Messages>> = {
  en: EN_MESSAGES,
  ceb: CEB_MESSAGES,
  tl: TL_MESSAGES,
};

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ceb' || value === 'tl';
}

/**
 * Looks up a message. Missing locale entries fall back to English so the UI never
 * renders a raw key.
 */
export function t(
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const message = DICTIONARIES[locale][key] ?? EN_MESSAGES[key];

  if (!params) {
    return message;
  }

  return message.replace(/\{(\w+)\}/g, (raw, name: string) => {
    const value = params[name];
    return value === undefined ? raw : String(value);
  });
}

/**
 * Display label for a category in a given locale.
 * English (shipped) → `label`; Bisaya (when it ships) → `localizedLabel`.
 */
export function categoryLabel(id: EmergencyCategoryId, locale: Locale = DEFAULT_LOCALE): string {
  return categoryLabels(getCategory(id), locale);
}

export function categoryLabels(
  category: EmergencyCategory,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return locale === 'ceb' ? category.localizedLabel : category.label;
}
