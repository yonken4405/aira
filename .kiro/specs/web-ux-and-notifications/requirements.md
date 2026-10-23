# Requirements Document

## Introduction

This feature is a two-part overhaul of the AIRA responder/admin/platform web console (`apps/web`):

1. A **UI/UX and information-architecture overhaul** — a shared app shell with unified navigation and consistent active state, a proper visual hierarchy, consolidation of redundant routes into single tabbed surfaces, a light/dark theme toggle backed by a CSS-variable token refactor, net-new common features (Profile, Settings, Notification Center) on every authenticated tier, and closing the known polish gaps in toasts, confirmation dialogs, and loading states.
2. A **full three-channel notification system** — in-app (persisted), email (Gmail SMTP), and web push (VAPID) — sent synchronously within the originating request with fail-soft semantics, covering responder operational/account events, platform-operator events, tenant-scoped civilian broadcasts, and system-wide notices, with per-channel user preferences and tenant-isolation enforcement on all targeting.

The overhaul must preserve AIRA's established security posture: three isolated identity tiers (responders, platform admins, citizens), application-owned authentication (argon2id + opaque session cookies; no Supabase Auth), multi-tenant office-subtree isolation, separation of duties (platform operators hold no incident/citizen data access beyond the explicitly granted broadcast/notice capability), SQL migrations as the schema source of truth, English-primary UI routed through the `t()` i18n helper, TDD, and a green `pnpm check`. Governing documents (PRODUCT.md, DESIGN.md, SECURITY.md, and the `apps/web` README) are updated as part of this feature.

## Glossary

- **AIRA_Web**: The Next.js 16 App Router console at `apps/web` serving responders, admins, and platform operators.
- **App_Shell**: A single shared layout component providing the header, navigation, and content frame for all authenticated surfaces.
- **NavLink**: A single shared navigation-link component that computes active state consistently (replacing the copy-pasted `usePathname` exact-match logic in `AdminHeader` and `PlatformHeader`).
- **Identity_Tier**: One of the three isolated principal populations — Responder_Tier (`responders` table; roles RESPONDER/DISPATCHER/ADMIN), Platform_Tier (`platform_admins`), Citizen_Tier (`citizens`). Each has separate tables, sessions, and cookies.
- **Authenticated_Surface**: Any AIRA_Web area reachable only with a valid session for an Identity_Tier (admin, console, platform, and citizen authenticated areas).
- **Tenant**: An LGU or barangay DRRM office. Offices form a tenant-scoped subtree of LGU and BARANGAY kinds.
- **Office_Subtree**: The set of offices rooted at a given office within a single Tenant, used as the authorization boundary for scoped reads and targeting (`OFFICE_SCOPE` / `tenant_id` bounding).
- **Theme_Token**: A named design color exposed as a CSS custom property that resolves to a concrete value per active theme.
- **Theme_Preference**: A user's selected theme mode — `light`, `dark`, or `system`.
- **Notification**: A persisted message addressed to a recipient principal, carrying a type, payload, read state, and delivery outcomes.
- **Notification_Channel**: One delivery mechanism — In_App, Email, or Web_Push.
- **In_App_Channel**: Persisted notifications shown in the Notification_Center with unread state.
- **Email_Channel**: Delivery via Gmail SMTP configured through `SMTP_*` environment variables.
- **Web_Push_Channel**: Delivery via the Web Push protocol using VAPID keys and a stored browser push subscription.
- **Notification_Center**: The in-app UI (bell icon + unread badge + list + mark-read controls) present on every Authenticated_Surface.
- **Channel_Preference**: A recipient's per-channel opt-in/opt-out setting for a category of notifications.
- **Push_Subscription**: A server-stored browser push subscription (endpoint + keys) bound to a principal.
- **Civilian_Broadcast**: A warning or advisory sent by an authorized Tenant principal to citizens within that sender's Office_Subtree.
- **System_Notice**: A platform-team notification delivered to all users (e.g. maintenance).
- **Critical_Warning**: A Civilian_Broadcast or System_Notice flagged as safety-critical, subject to the forced-delivery decision in Requirement 14.
- **Fail_Soft**: A send behavior where failure of a Notification_Channel is recorded but never aborts or rolls back the originating transaction.
- **Toast**: A transient, aria-live status message (tones info/success/error, auto-dismiss) from the existing `ToastProvider`/`useToast`.
- **Confirm_Dialog**: The existing Radix AlertDialog confirmation component (tone default/destructive).
- **Skeleton_Loader**: A layout-shaped placeholder shown while an async surface loads.

## Requirements

### Requirement 1: Theme token refactor to CSS variables

**User Story:** As a maintainer, I want design colors expressed as theme-aware CSS variables, so that AIRA_Web can switch between light and dark appearances without recompiling color literals.

#### Acceptance Criteria

1. THE AIRA_Web SHALL define each design color currently written as a hex literal in `packages/tailwind-config/index.js` as a CSS custom property, and SHALL reference that custom property from the Tailwind preset rather than the hex literal.
2. THE AIRA_Web SHALL keep the existing Tailwind utility class names (`bg-ink`, `text-fg`, `border-line`, `text-status-*`, and `emergency-*`) resolving to the same tokens after the refactor, so that no component class name referencing those tokens requires change.
3. THE AIRA_Web SHALL define, for every Theme_Token, a concrete value under the light theme and a concrete value under the dark theme.
4. WHEN the dark theme is active, THE AIRA_Web SHALL resolve each Theme_Token to the exact hex value that `packages/tailwind-config/index.js` assigns to that color before this refactor.
5. THE AIRA_Web SHALL enable theme selection through a `class` or `data-theme` attribute on the document root element, replacing the fixed `color-scheme: dark` declaration in `globals.css`.
6. THE AIRA_Web SHALL preserve the emergency, status, and notification-tone semantic colors as Theme_Tokens, each with a light-theme value and a dark-theme value, where the dark-theme value equals the current hex literal.
7. THE AIRA_Web SHALL meet WCAG 2.1 AA contrast (4.5:1 for normal text, 3:1 for large text and UI component boundaries) for each foreground-on-surface Theme_Token pairing under the light theme and under the dark theme.

### Requirement 2: Light/dark theme toggle with persistence and system default

**User Story:** As any authenticated user, I want to choose light, dark, or system-matched appearance, so that AIRA_Web is comfortable to use in my environment.

#### Acceptance Criteria

1. THE AIRA_Web SHALL provide a theme control that allows selection of `light`, `dark`, or `system` as the Theme_Preference.
2. WHEN a user selects a Theme_Preference, THE AIRA_Web SHALL apply the corresponding theme by updating the document-root `class` or `data-theme` attribute within 120ms without a full page reload.
3. WHEN a user selects a Theme_Preference, THE AIRA_Web SHALL persist that Theme_Preference on the same browser using `localStorage` or a cookie so that it survives across sessions.
4. WHERE no Theme_Preference has been persisted for the browser, THE AIRA_Web SHALL default the Theme_Preference to `system` and render the theme matching the operating-system `prefers-color-scheme` setting.
5. WHILE the Theme_Preference is `system`, WHEN the operating-system `prefers-color-scheme` setting changes, THE AIRA_Web SHALL update the active theme to match the changed setting without a page reload.
6. WHEN a themed page first loads, THE AIRA_Web SHALL apply the persisted Theme_Preference to the document root before first paint, by executing an inline script in the document head, so that no flash of the non-selected theme occurs.

### Requirement 3: Unified app shell and shared navigation

**User Story:** As any authenticated user, I want a single consistent header and navigation across every surface, so that AIRA_Web feels coherent and I always know where I am.

#### Acceptance Criteria

1. THE AIRA_Web SHALL render every Authenticated_Surface inside a single shared App_Shell that provides the header, the primary navigation, and the content frame.
2. THE AIRA_Web SHALL replace `AdminHeader`, `PlatformHeader`, and the inline console header in `Dashboard.tsx` with the shared App_Shell header, leaving zero remaining usages of those three hand-rolled headers.
3. THE AIRA_Web SHALL compute navigation active state through a single shared NavLink component used by every Authenticated_Surface, with no per-surface copies of `usePathname` active-link logic remaining.
4. WHEN the current pathname exactly equals a NavLink destination that is configured for exact matching, THE NavLink SHALL render that destination in its active visual state and SHALL set `aria-current="page"`.
5. WHEN the current pathname equals, or begins with the destination path followed by `/`, for a NavLink destination that is configured for nested (prefix) matching, THE NavLink SHALL render that destination in its active visual state and SHALL set `aria-current="page"`.
6. IF the current pathname does not match a NavLink destination under the destination's configured match mode, THEN THE NavLink SHALL render that destination in its inactive visual state and SHALL omit `aria-current`.
7. THE App_Shell SHALL display a navigation entry only when `can()` in `rbac.ts` grants the signed-in principal the permission mapped to that entry, and SHALL omit every entry whose mapped permission the principal lacks.
8. THE App_Shell SHALL derive the set of navigation entries from the signed-in principal's Identity_Tier such that RESPONDER and DISPATCHER principals (console surface) and ADMIN principals (admin surface) MAY receive different navigation entries.
9. THE App_Shell SHALL expose the Notification_Center, Profile, and Settings entry points within the shared App_Shell header for every Identity_Tier, in the same header region across all Authenticated_Surfaces.

### Requirement 4: Consolidate redundant admin routes into one tabbed surface

**User Story:** As an admin (DRRM officer), I want the admin area as one surface with tabs, so that related management content is in one place instead of scattered sibling pages.

#### Acceptance Criteria

1. THE AIRA_Web SHALL consolidate `/admin` (accounts), `/admin/dashboards` (metrics), and `/admin/audit` into a single tabbed admin surface in which accounts, oversight metrics, and the audit trail are presented as tabs within one App_Shell content frame.
2. THE AIRA_Web SHALL preserve `/admin`, `/admin/dashboards`, and `/admin/audit` as deep-linkable URLs such that requesting one of these URLs opens the consolidated admin surface with the corresponding tab selected, keeping existing bookmarks valid.
3. THE AIRA_Web SHALL remove `/admin/overview` as a distinct map-plus-queue page and SHALL respond to a request for `/admin/overview` with a redirect to the surviving map-plus-queue view, so that existing `/admin/overview` bookmarks resolve without a not-found result.
4. THE AIRA_Web SHALL define the live map and queue once and reuse that single definition for both the `/console` view and any admin consumption, with no duplicate map-plus-queue implementation remaining.
5. WHEN an admin selects a different admin tab, THE AIRA_Web SHALL update the selected tab and the displayed content while retaining the same App_Shell header and navigation instance, without rendering a separate per-page header.
6. THE AIRA_Web SHALL render the accounts tab only for a principal holding `responder:manage`, the oversight-metrics tab only for a principal holding `metrics:read`, and the audit-trail tab only for a principal holding `audit:read`, per `can()` in `rbac.ts`.
7. IF the signed-in principal lacks the permission mapped to a given admin tab, THEN THE AIRA_Web SHALL omit that tab from the admin surface and SHALL NOT render its content.
8. WHEN an admin opens the admin surface, THE AIRA_Web SHALL select as the initial tab the tab indicated by the requested deep-linked URL when present, and otherwise the first tab for which the principal holds the mapped permission.
9. IF the signed-in principal holds none of `responder:manage`, `metrics:read`, or `audit:read`, THEN THE AIRA_Web SHALL NOT render any admin tab content and SHALL present a not-authorized indication instead.

### Requirement 5: Restore surface chrome to the password/account page

**User Story:** As a responder changing my password, I want the account page to keep the normal header and navigation, so that I am not dropped onto a chrome-less screen.

#### Acceptance Criteria

1. THE AIRA_Web SHALL render the account password-change page inside the shared App_Shell with the standard App_Shell header and navigation.
2. WHEN a user reaches the password-change page by any entry path, including direct deep link, admin navigation, or in-app navigation, THE AIRA_Web SHALL render it with the full App_Shell header and navigation rather than as a chrome-less screen.
3. THE AIRA_Web SHALL present the password-change page within the Profile or Settings area of the App_Shell rather than as a standalone route lacking App_Shell chrome.
4. WHEN the password-change page is displayed, THE AIRA_Web SHALL render the shared NavLink navigation entries authorized for the signed-in principal, identical to those shown on other Authenticated_Surfaces for that principal.

### Requirement 6: Profile common feature on every tier

**User Story:** As any authenticated user, I want to view and edit my own account basics, so that my identifying details stay current.

#### Acceptance Criteria

1. THE AIRA_Web SHALL provide a Profile page on every Authenticated_Surface for all three Identity_Tiers.
2. THE Profile page SHALL display the signed-in principal's email as read-only.
3. WHERE the principal is a responder, THE Profile page SHALL allow editing the display name and callsign.
4. WHEN a user submits a valid Profile change, THE AIRA_Web SHALL persist the change and show a success Toast.
5. IF a Profile change submission is invalid, THEN THE AIRA_Web SHALL reject the submission and display the validation error wired to the relevant field for assistive technology.
6. THE Profile page SHALL allow a principal to change the principal's own password where the principal holds `account:change-password`.

### Requirement 7: Settings common feature with theme and notification preferences

**User Story:** As any authenticated user, I want a settings page for appearance and notification choices, so that I control how AIRA_Web looks and how it reaches me.

#### Acceptance Criteria

1. THE AIRA_Web SHALL provide a Settings page on every Authenticated_Surface for all three Identity_Tiers.
2. THE Settings page SHALL include the Theme_Preference control defined in Requirement 2.
3. THE Settings page SHALL present per-channel notification preferences allowing opt-in/opt-out for In_App_Channel, Email_Channel, and Web_Push_Channel.
4. WHEN a user changes a Channel_Preference, THE AIRA_Web SHALL persist the change for that principal and confirm with a success Toast.
5. WHERE the user enables Web_Push_Channel, THE AIRA_Web SHALL request browser push permission and register a Push_Subscription stored server-side bound to that principal.
6. IF browser push permission is denied, THEN THE AIRA_Web SHALL leave Web_Push_Channel disabled for that principal and display an explanatory message.

### Requirement 8: Notification Center (in-app)

**User Story:** As any authenticated user, I want an in-app notification center with unread counts, so that I can see and manage messages addressed to me.

#### Acceptance Criteria

1. THE App_Shell SHALL display a notification bell with an unread-count badge on every Authenticated_Surface.
2. THE Notification_Center SHALL list notifications addressed to the signed-in principal in reverse-chronological order.
3. WHEN unread notifications exist for the signed-in principal, THE App_Shell SHALL display the count of unread notifications on the bell badge.
4. WHEN a user opens a notification, THE Notification_Center SHALL mark that notification read and decrement the unread count.
5. WHEN a user selects mark-all-read, THE Notification_Center SHALL mark every notification for that principal read and SHALL set the unread count to zero.
6. THE Notification_Center SHALL show only notifications addressed to the signed-in principal and SHALL NOT expose notifications addressed to any other principal or Identity_Tier.

### Requirement 9: Notification data model and persistence

**User Story:** As a maintainer, I want notifications persisted with a typed schema and delivery outcomes, so that in-app state and channel results are durable and auditable.

#### Acceptance Criteria

1. THE AIRA_Web SHALL persist each Notification with a recipient principal reference, a notification type, a payload, a read state, and a creation timestamp recorded in UTC, defined via a SQL migration in `packages/db`.
2. THE AIRA_Web SHALL record, per Notification per attempted Notification_Channel, a delivery outcome drawn from exactly the set {sent, failed, skipped, not_attempted} together with the UTC timestamp at which that outcome was recorded.
3. WHEN a Notification is created, THE AIRA_Web SHALL set the initial read state to unread.
4. THE AIRA_Web SHALL bind each Push_Subscription record to exactly one Identity_Tier principal using the same tier discriminator and tier-scoped principal identifier as a Notification, with no foreign key shared across tiers, and SHALL store the subscription endpoint and keys.
5. THE AIRA_Web SHALL model the recipient of each Notification and each Channel_Preference as the pair (Identity_Tier discriminator with value in {responders, platform_admins, citizens}, tier-scoped principal identifier), binding every such record to exactly one Identity_Tier principal with no foreign key referencing a shared users table and no record shared across tiers.
6. THE AIRA_Web SHALL define the notification schema through SQL migrations in `packages/db` as the source of truth without using Supabase Auth.
7. THE AIRA_Web SHALL store the payload of each Notification containing the notification type, a structured data object, and the rendered presentation title and body strings.

### Requirement 10: Synchronous multi-channel send with fail-soft delivery

**User Story:** As a maintainer, I want notifications sent during the originating request across the enabled channels without a queue, while guaranteeing a channel failure never breaks the underlying action.

#### Acceptance Criteria

1. WHEN a notification-triggering event occurs, THE AIRA_Web SHALL attempt delivery synchronously within the originating request across each Notification_Channel the recipient has enabled in Channel_Preference, without enqueuing to a background worker or queue.
2. WHEN a Notification is addressed to a recipient, THE AIRA_Web SHALL persist the In_App_Channel copy before attempting any Email_Channel or Web_Push_Channel send, regardless of the outcome of those other channels.
3. IF an Email_Channel send fails or raises an exception, THEN THE AIRA_Web SHALL record a failed outcome for the Email_Channel and SHALL commit the originating transaction successfully without rolling back (Fail_Soft).
4. IF a Web_Push_Channel send fails or raises an exception, THEN THE AIRA_Web SHALL record a failed outcome for the Web_Push_Channel and SHALL commit the originating transaction successfully without rolling back (Fail_Soft).
5. WHEN onboarding a Tenant triggers a notification and the Email_Channel send fails, THE AIRA_Web SHALL complete the Tenant onboarding and commit its transaction successfully.
6. THE AIRA_Web SHALL read Email_Channel SMTP credentials and Web_Push_Channel VAPID keys from environment variables (`SMTP_*`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) and SHALL NOT embed any such secret in source.
7. WHERE a required credential for a Notification_Channel is absent from the environment, THE AIRA_Web SHALL skip that Notification_Channel, record its outcome as not_attempted, and continue the originating request without raising an error.
8. WHEN sending a Notification, THE AIRA_Web SHALL process the enabled Notification_Channels in a fixed order with the In_App_Channel first, SHALL record exactly one delivery outcome per channel per Notification, and SHALL guarantee the persisted In_App_Channel copy is retained even if an Email_Channel or Web_Push_Channel send raises an exception during the same request.

### Requirement 11: Responder operational and account notification events

**User Story:** As a responder, I want to be notified about incidents assigned to me and changes to my account, so that I react promptly and stay aware of my access state.

#### Acceptance Criteria

1. WHEN an incident is assigned to a responder, THE AIRA_Web SHALL create a Notification addressed to that responder.
2. WHEN a responder's account is locked, unlocked, role-changed, or deactivated, THE AIRA_Web SHALL create a Notification addressed to that responder.
3. THE AIRA_Web SHALL deliver each responder notification across only the channels that responder has enabled via Channel_Preference, subject to Requirement 14.
4. THE AIRA_Web SHALL address responder operational and account notifications only to the affected responder principal within the Responder_Tier.

### Requirement 12: Platform-operator notification events

**User Story:** As a platform operator, I want to be notified about tenant lifecycle changes, so that I stay aware of onboarding and suspension activity.

#### Acceptance Criteria

1. WHEN a Tenant is onboarded, THE AIRA_Web SHALL create a Notification addressed to the appropriate Platform_Tier principals.
2. WHEN a Tenant is suspended, THE AIRA_Web SHALL create a Notification addressed to the appropriate Platform_Tier principals.
3. THE AIRA_Web SHALL deliver platform-operator notifications across only the channels each recipient has enabled via Channel_Preference, subject to Requirement 14.
4. THE AIRA_Web SHALL NOT include incident content or citizen personal data in platform-operator notifications, preserving platform separation of duties.

### Requirement 13: Tenant-scoped civilian broadcasts

**User Story:** As an authorized DRRM office principal, I want to send a warning or advisory to the citizens in my area, so that residents receive timely safety information — while never reaching citizens outside my jurisdiction.

#### Acceptance Criteria

1. THE AIRA_Web SHALL allow a Civilian_Broadcast to be created and sent only by a Tenant principal whose role is DISPATCHER or ADMIN, as authorized server-side by `can()` for the civilian-broadcast action.
2. IF a principal without the DISPATCHER or ADMIN role attempts to send a Civilian_Broadcast, THEN THE AIRA_Web SHALL deny the request, SHALL NOT deliver to any recipient, and SHALL return an authorization-failure indication.
3. THE AIRA_Web SHALL allow the sender to target either (a) the sender's entire Tenant or (b) a single barangay (office) node within the sender's Office_Subtree, and no other granularity.
4. WHEN a Civilian_Broadcast is sent, THE AIRA_Web SHALL resolve recipients to exactly the set of citizens whose area membership (resolved tenant_id and office/barangay) falls within the sender's Office_Subtree as computed by the `OFFICE_SCOPE` CTE bounded by `tenant_id`.
5. IF a Civilian_Broadcast targets any citizen, office, or Tenant outside the sender's Office_Subtree, THEN THE AIRA_Web SHALL deny the send atomically, SHALL NOT deliver to any recipient (no partial delivery), and SHALL return a rejection indication identifying the targeting violation.
6. WHEN a Civilian_Broadcast is accepted, THE AIRA_Web SHALL deliver it to each targeted citizen across only the channels that citizen has enabled via Channel_Preference, subject to Requirement 14.
7. THE AIRA_Web SHALL record for each Civilian_Broadcast attempt an audit entry containing the sending principal identifier and role, the Tenant, the targeting granularity (whole-Tenant or specific barangay), the UTC timestamp, the resolved recipient count, and the accepted/denied outcome including any cross-subtree targeting that was rejected.

### Requirement 14: Per-channel preferences and forced critical warnings (decision point)

**User Story:** As a product owner, I want user channel preferences respected for routine messages but a defined rule for safety-critical warnings, so that opt-out never silently suppresses life-safety information.

#### Acceptance Criteria

1. WHEN a Notification is not flagged as a Critical_Warning, THE AIRA_Web SHALL deliver it only through the channels the recipient has enabled via Channel_Preference, and SHALL suppress delivery on every channel the recipient has disabled.
2. WHERE a Civilian_Broadcast or System_Notice is flagged as a Critical_Warning, THE AIRA_Web SHALL always deliver the In_App_Channel copy to every targeted recipient regardless of that recipient's Channel_Preference.
3. THE AIRA_Web SHALL expose exactly one documented, configurable policy constant that governs whether a Critical_Warning overrides Email_Channel and Web_Push_Channel opt-out; the constant SHALL be a single system-wide value that applies uniformly to all Critical_Warnings, SHALL have a documented default, and SHALL NOT be overridable on a per-send basis.
4. WHILE the policy constant enables forced delivery, WHEN a Critical_Warning is delivered on the Email_Channel or Web_Push_Channel to a recipient who had disabled that channel, THE AIRA_Web SHALL record per Notification and per recipient that the Channel_Preference opt-out was overridden.
5. IF a recipient attempts to opt out of the In_App_Channel for Critical_Warnings, THEN THE AIRA_Web SHALL reject the change and SHALL retain the In_App_Channel as enabled for Critical_Warnings.

### Requirement 15: System-wide notices

**User Story:** As a platform operator, I want to send a notice to all users, so that I can communicate platform events such as maintenance.

#### Acceptance Criteria

1. THE AIRA_Web SHALL allow a System_Notice to be created and sent only by a Platform_Tier principal authorized server-side by `can()` for the system-notice action.
2. IF a principal that is not a Platform_Tier principal attempts to send a System_Notice, THEN THE AIRA_Web SHALL deny the request and SHALL NOT deliver to any recipient.
3. WHEN a System_Notice is sent, THE AIRA_Web SHALL address it to every user across all three Identity_Tiers.
4. THE AIRA_Web SHALL deliver a System_Notice to each recipient across only the channels that recipient has enabled via Channel_Preference, subject to Requirement 14.
5. THE AIRA_Web SHALL NOT grant the sending Platform_Tier principal any read access to citizen or incident data as a result of sending a System_Notice.
6. THE AIRA_Web SHALL record for each System_Notice the sending Platform_Tier principal identifier and the UTC timestamp.

### Requirement 16: Tenant isolation for notification targeting

**User Story:** As a security owner, I want all notification targeting bounded by the tenant/office-subtree model, so that multi-tenant isolation is never crossed by the notification system.

#### Acceptance Criteria

1. THE AIRA_Web SHALL resolve recipients for every tenant-scoped send using the existing Office_Subtree bounding computed by the `OFFICE_SCOPE` CTE constrained by `tenant_id`, and SHALL treat that bound as the authoritative recipient set.
2. IF a send would address any principal, citizen, office, or Tenant outside the sender's authorized Office_Subtree, THEN THE AIRA_Web SHALL deny the send atomically and SHALL NOT deliver to any recipient (no partial delivery).
3. THE AIRA_Web SHALL NOT grant any Platform_Tier principal read access to citizen or incident data through the notification system beyond issuing Civilian_Broadcast and System_Notice sends, preserving separation of duties.
4. THE AIRA_Web SHALL enforce notification authorization on the server side through both `can()` and the Office_Subtree boundary, and SHALL NOT accept any send authorized only by client-side checks.

### Requirement 17: Toast coverage for all transactions

**User Story:** As any authenticated user, I want every significant action to confirm its outcome, so that I am never left guessing whether an action succeeded or failed.

#### Acceptance Criteria

1. WHEN a user-initiated create, update, or delete transaction succeeds, THE AIRA_Web SHALL display a success Toast.
2. IF a user-initiated transaction fails, THEN THE AIRA_Web SHALL display an error Toast describing the failure.
3. WHEN a platform operator logs out, THE AIRA_Web SHALL display a logout confirmation Toast (closing the current silent `PlatformHeader` logout gap).
4. WHEN a console user logs out, THE AIRA_Web SHALL display a logout confirmation Toast (closing the current silent console-logout gap).
5. THE AIRA_Web SHALL route all Toast copy through the `t()` i18n helper.
6. THE AIRA_Web SHALL render Toasts with an aria-live region so screen readers announce the outcome.

### Requirement 18: Confirmation gating for destructive and high-impact actions

**User Story:** As any authenticated user, I want a confirmation step before destructive or high-impact actions, so that I do not trigger irreversible or wide-reaching changes by a single click.

#### Acceptance Criteria

1. WHEN a user initiates suspend-tenant, THE AIRA_Web SHALL present a destructive-tone Confirm_Dialog before executing the suspension.
2. WHEN a user initiates an incident status transition, including marking an incident RESOLVED, THE AIRA_Web SHALL present a Confirm_Dialog before applying the transition.
3. WHEN a user initiates unlock-account, activate-tenant, or a logout, THE AIRA_Web SHALL present a Confirm_Dialog before executing the action.
4. WHEN a user initiates sending a Civilian_Broadcast or a System_Notice, THE AIRA_Web SHALL present a Confirm_Dialog summarizing the audience before sending.
5. IF a user cancels a Confirm_Dialog, THEN THE AIRA_Web SHALL abort the action and leave state unchanged.
6. THE AIRA_Web SHALL preserve the existing confirmation gating on deactivate, role-change, revoke-sessions, and unit-assign actions.

### Requirement 19: Consistent loading states across async surfaces

**User Story:** As any authenticated user, I want layout-shaped loading indicators on every async surface, so that AIRA_Web communicates progress instead of showing blank or jumping content.

#### Acceptance Criteria

1. THE AIRA_Web SHALL display a layout-shaped Skeleton_Loader for each async surface while its data loads.
2. THE AIRA_Web SHALL provide a route-level `loading.tsx` for each async route segment in the App Router.
3. THE AIRA_Web SHALL provide Skeleton_Loaders for the platform map and the citizen tracking surfaces, closing their current weak/absent loading states.
4. IF an async surface fails to load, THEN THE AIRA_Web SHALL display an error state with a retry control, consistent with the existing console `LoadError` pattern.
5. THE AIRA_Web SHALL shape each Skeleton_Loader to match the layout it replaces to minimize layout shift on load.

### Requirement 20: Accessible UI primitives

**User Story:** As a user relying on assistive technology, I want the new and existing UI primitives to be accessible, so that I can operate AIRA_Web fully.

#### Acceptance Criteria

1. THE AIRA_Web SHALL provide accessible form primitives for Textarea, Checkbox, Radio, and Switch in `@aira/ui/web`.
2. THE AIRA_Web SHALL wire the `Field` error message to its associated input via accessible error association so assistive technology announces validation errors.
3. THE AIRA_Web SHALL render all interactive primitives with visible focus states.
4. THE AIRA_Web SHALL keep Confirm_Dialogs operable by keyboard with focus trapped within the dialog while open.
5. THE AIRA_Web SHALL expose the Notification_Center unread count to assistive technology.
6. THE AIRA_Web SHALL route all user-facing copy for new primitives and features through the `t()` i18n helper.

### Requirement 21: Governing documentation updates

**User Story:** As a maintainer, I want the governing documents updated alongside this overhaul, so that the documentation stays consistent with the shipped behavior.

#### Acceptance Criteria

1. THE AIRA_Web SHALL update PRODUCT.md to describe the UI/UX overhaul and the notification system.
2. THE AIRA_Web SHALL update DESIGN.md to describe the Theme_Token CSS-variable model, the theme strategy, the App_Shell, and the new primitives.
3. THE AIRA_Web SHALL update SECURITY.md to describe notification tenant-isolation, targeting authorization, the forced-critical-warning policy, and platform separation of duties for broadcasts and notices.
4. THE AIRA_Web SHALL update the `apps/web` README and `.env.example` to document the new `SMTP_*` and `VAPID_*` environment variables without exposing secret values.

### Requirement 22: Testing and quality gate

**User Story:** As a maintainer, I want this feature delivered under TDD with a green quality gate, so that the overhaul and notification system remain verifiable.

#### Acceptance Criteria

1. THE AIRA_Web SHALL include component tests for new UI components, integration tests for new API routes, and unit tests for new utilities.
2. THE AIRA_Web SHALL keep `pnpm check` (typecheck + tests) green after the changes.
3. THE AIRA_Web SHALL include integration tests proving tenant-isolation denial for cross-tenant notification targeting.
4. THE AIRA_Web SHALL include tests proving Fail_Soft behavior so that a failed Email_Channel or Web_Push_Channel send does not fail the originating transaction.
