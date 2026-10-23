# Implementation Plan: Web UX and Notifications

## Overview

This plan turns the approved design into incremental, test-first coding steps for `apps/web`, `packages/ui`, `packages/tailwind-config`, and `packages/db`. Every task is a concrete coding change, names the files to create or modify, states the tests to write first, and cites the acceptance criteria it satisfies.

The work follows the design's established seams:

- `@aira/ui/web` primitive library with `t()` i18n (`@aira/ui`), tested with vitest + `@testing-library/react`.
- The `types.ts (ports + domain) → service.ts (pure rules) → memory-store.ts / postgres-store.ts → runtime.ts (env wiring)` triad used by `auth`/`platform`/`citizen`, wired into `AppDeps` via `getAppDeps()`.
- The `*-handlers.ts` + `app/api/**/route.ts` handler pattern.
- SQL migrations in `packages/db/supabase/migrations` as the schema source of truth (no Supabase Auth).

**Test seams (used throughout):** the notification core is tested against an in-memory `NotificationStore` plus injected fake `EmailSender`/`WebPushSender`; `null` senders exercise the missing-credential path. Web tests live in `apps/web/tests/**/*.test.{ts,tsx}` (jsdom); ui tests are colocated in `packages/ui/src/**`. Property tests use `fast-check` (already in the lockfile), min 100 iterations, tagged `Feature: web-ux-and-notifications, Property {n}`.

**TDD discipline:** each task writes failing tests first, then the implementation, and keeps `pnpm check` (turbo typecheck + test) green before the task is considered done.

---

## Tasks

### Phase 1 — Theming foundation (R1, R2)

- [x] 1. Refactor the Tailwind preset to CSS-variable tokens
  - [x] 1.1 Write failing tests for the channelized token preset
    - Add `packages/tailwind-config/index.test.js` (and register `*.test.js` in `packages/tailwind-config/vitest.config.mts`, creating it if absent) asserting that `require('./index')` exposes every existing color key (`ink`, `surface`, `raised`, `line`, `fg`, `muted`, `emergency.{sunog,medikal,krimen,baha}`, `status.{queued,dispatched,enroute,onscene,resolved,success,error,info}`) and that each value is the string `rgb(var(--color-<name>) / <alpha-value>)` rather than a hex literal.
    - Assert a `darkMode` strategy key equal to `['class', '[data-theme="dark"]']` is present.
    - _Requirements: 1.1, 1.2, 1.5, 1.6_
  - [x] 1.2 Refactor `packages/tailwind-config/index.js` to satisfy the tests
    - Replace every hex literal under `theme.extend.colors` with the `rgb(var(--color-<name>) / <alpha-value>)` form via a `withAlpha` helper, preserving all existing key names and nesting so utility class names (`bg-ink`, `text-fg`, `border-line`, `text-status-*`, `emergency-*`) resolve unchanged.
    - Add `darkMode: ['class', '[data-theme="dark"]']` to register the strategy (tokens still resolve through CSS variables, not the `dark:` variant).
    - _Requirements: 1.1, 1.2, 1.5, 1.6_

- [x] 2. Define theme variable sets and bind color-scheme in globals.css
  - Edit `apps/web/app/globals.css`: in `@layer base`, define `:root, [data-theme='dark']` with every `--color-*` channel set to the exact current hex (channelized to space-separated RGB: ink `11 15 20`, surface `18 24 31`, raised `26 34 44`, line `42 52 65`, fg `242 245 248`, muted `147 161 176`, plus all emergency and status tones); define `[data-theme='light']` with WCAG 2.1 AA pairings (4.5:1 normal text, 3:1 large text / UI boundaries) for every foreground-on-surface token.
  - Replace the fixed `color-scheme: dark` with per-theme binding: `:root { color-scheme: dark }` and `[data-theme='light'] { color-scheme: light }`.
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 3. Add the pre-paint theme script to the root layout
  - Edit `apps/web/app/layout.tsx` to inject an inline `<script dangerouslySetInnerHTML>` in `<head>` that reads `localStorage['aira-theme']` (default `system`), resolves `system` via `matchMedia('(prefers-color-scheme: dark)')`, and sets `document.documentElement.setAttribute('data-theme', ...)` synchronously before paint; fall back to `dark` on any error.
  - _Requirements: 2.6_

- [x] 4. Enable React component testing in `@aira/ui`
  - Update `packages/ui/vitest.config.mts` to set `environment: 'jsdom'`, add `setupFiles` for `@testing-library/jest-dom` (create `packages/ui/vitest.setup.ts`), and extend `include` to `src/**/*.test.{ts,tsx}`; add `@testing-library/react`, `@testing-library/dom`, `jsdom`, and `@vitejs/plugin-react` to `packages/ui/package.json` devDependencies and wire the react plugin in the config.
  - This is infrastructure required before any `.tsx` primitive test below can run; no product code yet.
  - _Requirements: 22.1, 22.2_

- [x] 5. Implement the theme runtime in `@aira/ui/web`
  - [x] 5.1 Write failing tests for ThemeProvider / useTheme / ThemeToggle
    - Add `packages/ui/src/web/theme.test.tsx`: default preference is `system` when nothing persisted and resolves via `matchMedia` (Property 10); `setPreference('light'|'dark'|'system')` writes `localStorage['aira-theme']` and updates `document.documentElement[data-theme]`; a `system` preference re-resolves live on a `matchMedia` change event without reload; a no-flash test asserting the provider adopts the `data-theme` already present on `<html>` rather than overwriting it on mount.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 5.2 Implement the theme module and export it
    - Create `packages/ui/src/web/theme.tsx` with `ThemePreference`, `ResolvedTheme`, `ThemeContextValue`, `ThemeProvider`, `useTheme`, `ThemeToggle` per the design; apply changes within the `duration-fast` (120ms) transition budget and route all control copy through `t()`. Export them from `packages/ui/src/web/index.ts`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x]* 5.3 Write property test for the theme-preference resolver
    - **Property 10: Theme preference resolves deterministically**
    - **Validates: Requirements 2.1, 2.4, 2.5**

### Phase 2 — Accessible primitives + Field a11y (R20)

- [x] 6. Add accessible form primitives to `@aira/ui/web`
  - [x] 6.1 Write failing tests for Textarea, Checkbox, Radio, Switch
    - Add `packages/ui/src/web/ui/controls.test.tsx`: each primitive renders a visible focus state, is keyboard operable, and routes its label/copy through `t()`; `Switch` exposes `role="switch"` with `aria-checked` and toggles via keyboard; `Radio`/`Checkbox` associate their label with the input.
    - _Requirements: 20.1, 20.3, 20.6_
  - [x] 6.2 Implement the primitives and export them
    - Create `packages/ui/src/web/ui/controls.tsx` with `Textarea`, `Checkbox`, `Radio`, `Switch` reusing the shared `CONTROL` focus-ring classes from `field.tsx`; export from `packages/ui/src/web/index.ts`.
    - _Requirements: 20.1, 20.3, 20.6_

- [x] 7. Auto-wire Field error association
  - [x] 7.1 Write a failing test for Field error wiring
    - Add `packages/ui/src/web/ui/field.test.tsx`: when `error` is set, the child control receives `aria-invalid="true"` and `aria-describedby` referencing `${id}-error` (and `${id}-hint` when a hint is present); existing `Field` usages without error keep working.
    - _Requirements: 20.2_
  - [x] 7.2 Upgrade `Field` to clone the child control with a11y props
    - Edit `packages/ui/src/web/ui/field.tsx` to `cloneElement` the child, injecting `aria-describedby` and `aria-invalid` without breaking existing callers.
    - _Requirements: 20.2_

### Phase 3 — App_Shell + NavLink + IA consolidation (R3, R4, R5)

- [x] 8. Implement the shared NavLink
  - [x] 8.1 Write failing tests for NavLink active-state computation
    - Add `packages/ui/src/web/ui/nav-link.test.tsx`: `exact` active iff `pathname === href`; `nested` active iff `pathname === href` or `pathname.startsWith(href + '/')`; active sets `aria-current="page"` and applies the active visual, inactive omits `aria-current` (mock `next/navigation` `usePathname`).
    - _Requirements: 3.4, 3.5, 3.6_
  - [x] 8.2 Implement `NavLink` and export it
    - Create `packages/ui/src/web/ui/nav-link.tsx` with `NavMatch`, `NavLinkProps`, `NavLink`; export from `packages/ui/src/web/index.ts`.
    - _Requirements: 3.3, 3.4, 3.5, 3.6_
  - [x]* 8.3 Write property test for NavLink active-state
    - **Property 9: NavLink active-state computation**
    - **Validates: Requirements 3.4, 3.5, 3.6**

- [x] 9. Implement App_Shell and its header island
  - [x] 9.1 Write failing tests for AppShellHeader
    - Add `apps/web/tests/app-shell.test.tsx`: nav entries whose mapped permission the principal lacks are omitted (`can()` gated); the Notification bell, Profile, and Settings entry points and the theme toggle always render in the header region for every tier; entries derive from the identity tier (RESPONDER/DISPATCHER vs ADMIN vs platform differ).
    - _Requirements: 3.1, 3.7, 3.8, 3.9_
  - [x] 9.2 Implement `AppShell` (server) + `AppShellHeader` (client island)
    - Create `apps/web/src/components/AppShell.tsx` (server) rendering `apps/web/src/components/AppShellHeader.tsx` (`'use client'`) with `NavEntry`, `ShellIdentity`, `AppShellProps`; the header uses `NavLink`, filters entries by `can(role, permission)` / `platformOnly`, and exposes bell + Profile + Settings + ThemeToggle slots.
    - _Requirements: 3.1, 3.2, 3.7, 3.8, 3.9, 5.4_

- [x] 10. Extract the shared IncidentConsole
  - [x] 10.1 Write a failing test for IncidentConsole reuse
    - Add `apps/web/tests/incident-console.test.tsx`: the extracted map+queue component renders the queue and map regions from injected incident data so both `/console` and admin can mount the single definition.
    - _Requirements: 4.4_
  - [x] 10.2 Extract map+queue into `IncidentConsole` and dedupe
    - Create `apps/web/src/components/IncidentConsole.tsx` from the shared map+queue logic currently duplicated in `Dashboard.tsx` and `AdminOverview.tsx`; update `Dashboard.tsx` to consume it and remove the duplicated map+queue body from `AdminOverview.tsx`.
    - _Requirements: 4.4_

- [x] 11. Build the tabbed Admin surface
  - [x] 11.1 Write failing tests for AdminSurface tab gating and deep-linking
    - Add `apps/web/tests/admin-surface.test.tsx`: accounts tab renders only with `responder:manage`, metrics only with `metrics:read`, audit only with `audit:read`; a tab and its content are omitted when the permission is absent; initial tab is the deep-linked tab when present, else the first permitted tab; when the principal holds none of the three, a not-authorized indication (reusing `Forbidden`) renders and no tab content shows; switching tabs keeps the same shell instance.
    - _Requirements: 4.1, 4.5, 4.6, 4.7, 4.8, 4.9_
  - [x] 11.2 Implement `AdminSurface` and route it from the three admin URLs
    - Create `apps/web/src/components/AdminSurface.tsx` presenting accounts (`AdminResponders`), oversight metrics (`AdminDashboards`), and audit as tabs within the App_Shell content frame, deriving the selected tab from the URL. Point `apps/web/app/admin/page.tsx`, `apps/web/app/admin/dashboards/page.tsx`, and `apps/web/app/admin/audit/page.tsx` at `AdminSurface` with the matching initial tab (bookmarks stay valid).
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.7, 4.8, 4.9_
  - [x] 11.3 Redirect `/admin/overview` to the surviving map+queue view
    - Replace `apps/web/app/admin/overview/page.tsx` with a redirect to the surviving map+queue view (no not-found); remove the standalone overview page body.
    - _Requirements: 4.3_

- [x] 12. Replace the three hand-rolled headers with App_Shell
  - [x] 12.1 Write a failing test asserting no legacy header usages remain
    - Add `apps/web/tests/shell-adoption.test.ts`: statically assert there are zero imports of `AdminHeader`, `PlatformHeader`, and the inline `Dashboard.tsx` header across `apps/web` source (e.g. scan files for the identifiers), and that console/admin/platform layouts render `AppShell`.
    - _Requirements: 3.2_
  - [x] 12.2 Adopt App_Shell in console/admin/platform layouts and delete the old headers
    - Update `apps/web/app/console/layout.tsx`, `apps/web/app/admin/layout.tsx`, and `apps/web/app/platform/layout.tsx` to render `AppShell` with tier-derived nav entries; remove the inline header from `apps/web/src/components/Dashboard.tsx`; delete `apps/web/src/components/AdminHeader.tsx` and `apps/web/src/components/PlatformHeader.tsx`. Preserve the existing sign-out behavior by moving it into the shell header.
    - _Requirements: 3.1, 3.2, 3.9_

- [x] 13. Move the account/password page under the shell
  - [x] 13.1 Write a failing test for shell chrome on the password page
    - Add `apps/web/tests/account-password-shell.test.tsx`: the password-change page renders inside `AppShell` with the principal's authorized NavLinks (not chrome-less), regardless of entry path.
    - _Requirements: 5.1, 5.2, 5.4_
  - [x] 13.2 Relocate `/account/password` into the Profile/Settings area under App_Shell
    - Update `apps/web/app/account/password/page.tsx` to render within `AppShell`, reusing the existing `ChangePasswordForm`; present it within the Profile/Settings area rather than as a standalone chrome-less route.
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

### Phase 4 — Common features: Profile, Settings, Notification Center shells (R6, R7, R8)

> Notification data/endpoints land in Phase 5. Here the UI is built and wired to the notification service interface; store calls are stubbed behind that interface until Phase 5 provides the real routes.

- [x] 14. Build the Profile pages
  - [x] 14.1 Write failing tests for the Profile view
    - Add `apps/web/tests/profile-view.test.tsx`: email renders read-only; for a responder, display name and callsign are editable; a valid submit triggers persistence and a success Toast; an invalid submit surfaces the error wired to the field (via upgraded `Field`); the embedded password-change is present only when `account:change-password` holds.
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_
  - [x] 14.2 Implement `ProfileView` and per-tier Profile routes
    - Create `apps/web/src/components/ProfileView.tsx` (`ProfileViewProps`) and routes `apps/web/app/console/profile/page.tsx`, `apps/web/app/admin/profile/page.tsx`, `apps/web/app/platform/profile/page.tsx` (+ citizen equivalent), each under `AppShell`, embedding `ChangePasswordForm` where permitted.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 15. Build the Settings pages
  - [x] 15.1 Write failing tests for the Settings view
    - Add `apps/web/tests/settings-view.test.tsx`: the Theme_Preference control (from Phase 1) is present; per-channel preference toggles (in_app/email/web_push) render; changing a preference persists and shows a success Toast; enabling Web_Push drives permission-request flow states (`unsupported`/`default`/`granted`/`denied`), and a denied result leaves Web_Push disabled with an explanatory message.
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_
  - [x] 15.2 Implement `SettingsView` and per-tier Settings routes
    - Create `apps/web/src/components/SettingsView.tsx` (`SettingsViewProps`, `ChannelPreferenceView`) using the new `Switch`/`Checkbox` primitives and `ThemeToggle`; add routes `apps/web/app/console/settings/page.tsx`, `apps/web/app/admin/settings/page.tsx`, `apps/web/app/platform/settings/page.tsx` (+ citizen equivalent) under `AppShell`; implement the browser push-permission + subscription-registration client flow calling the Phase-5 subscribe endpoint.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 16. Build the Notification Center bell island
  - [x] 16.1 Write failing tests for the NotificationCenter
    - Add `apps/web/tests/notification-center.test.tsx`: lists items reverse-chronologically; the unread badge shows the count and is exposed to assistive tech via `aria-live`/`aria-label`; opening an item marks it read and decrements the count; mark-all-read zeroes the count; 30s polling with `visibilitychange` pause and an immediate refetch after mark-read (fake timers + mocked fetch).
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 20.5_
  - [x] 16.2 Implement `NotificationCenter` and mount it in the shell header
    - Create `apps/web/src/components/NotificationCenter.tsx` (`NotificationCenterProps`, `NotificationView`) calling `GET /api/notifications?unread=1` on mount, polling every 30s with visibility pause, and posting mark-read / mark-all-read; mount it in `AppShellHeader`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 20.5_

### Phase 5 — Notification engine, data model, channels, events (R9–R16, R22)

- [x] 17. Add the notification schema and citizen area linkage migration
  - Create `packages/db/supabase/migrations/<timestamp>_notifications.sql` defining enums (`notification_tier`, `notification_channel`, `delivery_outcome`) and tables `notifications`, `notification_deliveries` (PK `(notification_id, channel)` → one outcome per channel, `overridden` flag), `channel_preferences`, `push_subscriptions`, `civilian_broadcasts`, `system_notices`; and `alter table public.citizens add column tenant_id`, `office_id` with the partial area index. Use `timestamptz default now()` (UTC), the `(tier, principal_id)` pair with no cross-tier FK, and least-privilege grants mirroring existing migrations (`revoke all` from `anon/authenticated/service_role`; grant to `aira_app`). No Supabase Auth.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 14.4_

- [x] 18. Define notification ports and domain types
  - Create `apps/web/src/lib/notifications/types.ts` with `NotificationTier`, `NotificationChannel`, `DeliveryOutcome`, `PrincipalRef`, `NotificationPayload`, `NotificationRecord`, `DeliveryRecord`, `ChannelPreference`, `PushSubscriptionRecord`, the `EmailSender`/`WebPushSender` sender ports (+ message types), the `NotificationStore` port (incl. `resolveCitizensInOfficeScope`, `isOfficeInScope`, `listAllPrincipals`, `listPlatformAdmins`, `recordBroadcastAudit`, `recordSystemNoticeAudit`), and `BroadcastAudit`/`SystemNoticeAudit`.
  - _Requirements: 9.4, 9.5, 9.7, 13.7, 15.6_

- [x] 19. Implement the in-memory NotificationStore (test seam)
  - Create `apps/web/tests/support/memory-notification-store.ts` implementing `NotificationStore` in memory (notifications, deliveries, preferences defaulting all-enabled, subscriptions, configurable office-scope resolution for targeting tests, principal lists, audit capture), mirroring `memory-incidents-store.ts`.
  - _Requirements: 22.1, 22.3, 22.4_

- [x] 20. Implement the notification service core
  - [x] 20.1 Write failing unit tests for `notifyOne`/`notifyMany`
    - Add `apps/web/tests/notification-service.test.ts` using the memory store + fake senders: In_App persisted first; fixed order In_App → Email → Web_Push; exactly one outcome per channel; preference honored for routine (`skipped` on disabled) and In_App forced for critical; `CRITICAL_FORCES_ALL_CHANNELS` toggles forced Email/Web_Push with `overridden` recorded; `null` sender → `not_attempted`; thrown sender → `failed` and `notifyOne` returns normally with the In_App row retained; no stored subscription → Web_Push `skipped`.
    - _Requirements: 10.2, 10.3, 10.4, 10.6, 10.7, 10.8, 14.1, 14.2, 14.3, 14.4, 14.5_
  - [x] 20.2 Implement `service.ts` (pure rules)
    - Create `apps/web/src/lib/notifications/service.ts` with `NotificationServiceDeps`, `CHANNEL_ORDER`, the documented `CRITICAL_FORCES_ALL_CHANNELS` constant (single system-wide, not per-send), `notifyOne`, and `notifyMany`, implementing the fail-soft algorithm from the design.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.7, 10.8, 14.1, 14.2, 14.3, 14.4, 14.5_
  - [x]* 20.3 Write property test — fixed channel order, one outcome per channel
    - **Property 1: Fixed channel order with In_App first and exactly one outcome per channel**
    - **Validates: Requirements 10.2, 10.8**
  - [x]* 20.4 Write property test — fail-soft dispatch never throws
    - **Property 2: Fail-soft — a channel failure never throws out of dispatch**
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.8**
  - [x]* 20.5 Write property test — missing credential yields not_attempted
    - **Property 3: Missing credential yields not_attempted, not an error**
    - **Validates: Requirements 10.6, 10.7**
  - [x]* 20.6 Write property test — preference honored, In_App forced for critical
    - **Property 4: Preference honored for routine, In_App forced for critical**
    - **Validates: Requirements 14.1, 14.2, 14.5**
  - [x]* 20.7 Write property test — forced-critical policy is uniform and records overrides
    - **Property 5: Forced-critical policy is uniform and records overrides**
    - **Validates: Requirements 14.3, 14.4**

- [x] 21. Implement the Postgres NotificationStore
  - [x] 21.1 Write failing store tests for recipient isolation and scope resolution
    - Add `apps/web/tests/notification-store.test.ts` (memory-backed where the DB is unavailable) asserting `listForRecipient`/`countUnread` return only the queried `(tier, principal_id)` and never leak other principals/tiers; and that `resolveCitizensInOfficeScope`/`isOfficeInScope` behave as the authoritative `OFFICE_SCOPE` bound.
    - _Requirements: 8.6, 11.4, 12.4, 13.4, 16.1_
  - [x] 21.2 Implement `postgres-store.ts`
    - Create `apps/web/src/lib/notifications/postgres-store.ts` implementing `NotificationStore` over `pg`, reusing the `OFFICE_SCOPE` recursive CTE (bounded by `tenant_id`) from `incidents-store.ts` for `resolveCitizensInOfficeScope`/`isOfficeInScope`.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 13.4, 16.1_
  - [x]* 21.3 Write property test — recipient isolation
    - **Property 8: Recipient isolation — a notification is only ever visible to its addressee**
    - **Validates: Requirements 8.6, 11.4, 12.4**

- [x] 22. Wire the notification runtime into AppDeps
  - Create `apps/web/src/lib/notifications/runtime.ts` with `getNotificationDeps()` building the postgres store and constructing `email`/`webPush` senders only when `SMTP_*` / `VAPID_*` env vars are present (else `null`), plus `emailAddressFor`. Add `notifications: NotificationServiceDeps` to `AppDeps` in `apps/web/src/lib/api/deps.ts` and populate it in `getAppDeps()`.
  - _Requirements: 10.6, 10.7_

- [x] 23. Implement the real channel senders and push client assets
  - [x] 23.1 Write failing tests for the EmailSender port contract
    - Add `apps/web/tests/email-sender.test.ts` exercising the fake `EmailSender` used by the service and asserting the port contract (resolve → no throw; reject → throws so the service records `failed`); add `nodemailer` to `apps/web/package.json`.
    - _Requirements: 10.3, 10.6_
  - [x] 23.2 Implement `EmailSender` (nodemailer Gmail SMTP) behind the port
    - Create `apps/web/src/lib/notifications/email-sender.ts` reading `SMTP_*` env only, constructed inside `runtime.ts`; keep `nodemailer` imported solely here.
    - _Requirements: 10.3, 10.6_
  - [x] 23.3 Implement `WebPushSender` (web-push VAPID) + service worker + subscribe endpoint
    - Create `apps/web/src/lib/notifications/web-push-sender.ts` (reads `VAPID_*` only), `apps/web/public/sw.js` to receive push events, and the subscription-registration endpoint `apps/web/app/api/notifications/subscriptions/route.ts` + handler; add `web-push` to `apps/web/package.json`. Write a failing handler test first asserting a subscription is stored bound to the caller's `(tier, principal_id)` and only the owner can read/modify it.
    - _Requirements: 7.5, 9.4, 10.4, 10.6_

- [x] 24. Add RBAC entries for broadcast and system-notice
  - [x] 24.1 Write a failing RBAC test
    - Extend `apps/web/tests/rbac.test.ts`: `civilian-broadcast` is granted to DISPATCHER and ADMIN and denied to RESPONDER/CITIZEN; document `PLATFORM_CAN_SYSTEM_NOTICE` as the platform-tier capability (not a responder permission).
    - _Requirements: 13.1, 15.1_
  - [x] 24.2 Add `civilian-broadcast` permission and platform capability constant
    - Edit `apps/web/src/lib/auth/rbac.ts`: add `'civilian-broadcast'` to `PERMISSIONS`, grant it to `DISPATCHER` and `ADMIN` in `ROLE_PERMISSIONS`, and add the documented `PLATFORM_CAN_SYSTEM_NOTICE` constant.
    - _Requirements: 13.1, 15.1_

- [x] 25. Implement the notifications API (list/unread/mark-read/mark-all-read, preferences)
  - [x] 25.1 Write failing integration tests for the notifications routes
    - Add `apps/web/tests/api-notifications.test.ts`: `GET /api/notifications` (list + `?unread=1` count) returns only the signed-in principal's items; mark-read / mark-all-read mutate only the caller's notifications; preferences get/set persist per principal and reject an attempt to disable In_App for critical. Follow the same-origin/auth/rate-limit patterns in `http.ts`.
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 7.3, 7.4, 14.5_
  - [x] 25.2 Implement notifications handlers and routes
    - Create `apps/web/src/lib/api/notifications-handlers.ts` and routes `apps/web/app/api/notifications/route.ts`, `apps/web/app/api/notifications/mark-all-read/route.ts` (and mark-read), `apps/web/app/api/notifications/preferences/route.ts`.
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 7.3, 7.4, 14.5_

- [x] 26. Implement the civilian-broadcast API
  - [x] 26.1 Write failing integration tests for broadcasts incl. tenant-isolation denial
    - Add `apps/web/tests/api-broadcasts.test.ts`: a RESPONDER/CITIZEN send is denied 403 with zero delivery; whole-tenant and single-barangay targeting resolve recipients via `OFFICE_SCOPE`; a target office/tenant outside the sender's subtree is denied atomically (zero deliveries) with a `violation` and a `denied` audit row; an accepted send delivers per preference subject to R14 and writes an accepted audit row with sender id/role, tenant, granularity, UTC, resolved count.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 16.1, 16.2, 16.4, 22.3_
  - [x] 26.2 Implement `broadcast-handlers.ts` and `/api/broadcasts`
    - Create `apps/web/src/lib/api/broadcast-handlers.ts` and `apps/web/app/api/broadcasts/route.ts`: authorize with `can('civilian-broadcast')`, validate targeting with `isOfficeInScope` before sending, resolve via `resolveCitizensInOfficeScope`, deny out-of-subtree atomically, then `notifyMany` + `recordBroadcastAudit`.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 16.1, 16.2, 16.4_
  - [x]* 26.3 Write property test — tenant-scope targeting is authoritative
    - **Property 6: Tenant-scope targeting is the authoritative recipient set**
    - **Validates: Requirements 13.4, 16.1**
  - [x]* 26.4 Write property test — out-of-subtree targeting denied atomically
    - **Property 7: Out-of-subtree targeting is denied atomically with no partial delivery**
    - **Validates: Requirements 13.5, 16.2**

- [x] 27. Implement the system-notice API
  - [x] 27.1 Write failing integration tests for system notices
    - Add `apps/web/tests/api-system-notices.test.ts`: only a Platform_Tier principal may send (responders/citizens denied with no delivery); an accepted notice fans out to all three tiers via `listAllPrincipals` and delivers per preference subject to R14; the sender gains no citizen/incident read access; sender id + UTC are recorded.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 16.3, 16.4_
  - [x] 27.2 Implement `system-notice-handlers.ts` and `/api/system-notices`
    - Create `apps/web/src/lib/api/system-notice-handlers.ts` and `apps/web/app/api/system-notices/route.ts`: authorize via `authenticatePlatform` + `PLATFORM_CAN_SYSTEM_NOTICE`, fan out with `listAllPrincipals`, `notifyMany` subject to R14, and `recordSystemNoticeAudit`.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 16.3, 16.4_

- [x] 28. Wire notification events into existing handlers (fail-soft)
  - [x] 28.1 Write failing tests for each event hook
    - Extend `apps/web/tests/api-incidents.test.ts` / `apps/web/tests/auth-service.test.ts` / `apps/web/tests/api-platform.test.ts`: incident assign notifies the assigned responder; account lock/unlock/role-change/deactivate notify the affected responder only; tenant onboard/suspend notify platform admins with no incident/citizen data; and each hook is fail-soft (the originating transaction still commits when a channel fake throws — e.g. tenant onboard commits on email failure).
    - _Requirements: 10.5, 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4_
  - [x] 28.2 Call `notify*` at the verified hook points
    - Edit `handleAssignIncident` (`apps/web/src/lib/api/incidents-handlers.ts`), the account lock path and `updateResponder` (`apps/web/src/lib/auth/service.ts`), and `handleCreateTenant`/`handleSetTenantStatus` (`apps/web/src/lib/api/platform-handlers.ts`) to call `notifyOne`/`notifyMany` after their own success, never altering the HTTP result.
    - _Requirements: 10.5, 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4_

- [x] 29. Checkpoint — notification engine
  - Ensure all tests pass, ask the user if questions arise.

### Phase 6 — Toast / confirm / loader polish (R17, R18, R19)

- [x] 30. Add toast coverage for logout and audit mutation flows
  - [x] 30.1 Write failing tests for logout and transaction toasts
    - Add `apps/web/tests/toast-coverage.test.tsx`: platform logout and console logout each show a success Toast routed through `t()`; a representative failing mutation shows an error Toast; toasts use the existing aria-live `ToastProvider`.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_
  - [x] 30.2 Implement logout toasts and audit remaining mutations for coverage
    - Add success/error toasts to the shell-header logout (platform + console, migrated from the deleted headers) and verify every user-initiated create/update/delete flow emits a success/error Toast via `t()`.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [x] 31. Add confirmation gating to high-impact actions
  - [x] 31.1 Write failing tests for the new confirm dialogs
    - Add `apps/web/tests/confirm-gating.test.tsx`: suspend-tenant uses a destructive-tone `ConfirmDialog`; incident status transitions (incl. RESOLVED), unlock-account, activate-tenant, and logout present a `ConfirmDialog`; broadcast/system-notice send present a `ConfirmDialog` summarizing the audience; cancel aborts leaving state unchanged; existing deactivate/role-change/revoke-sessions/unit-assign gating still present.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_
  - [x] 31.2 Wire `ConfirmDialog` into the listed actions
    - Add `ConfirmDialog` to suspend-tenant, incident status transitions (incl. RESOLVED), unlock-account, activate-tenant, logout, and broadcast/system-notice send (audience summary), preserving existing gated actions.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

- [x] 32. Add route-level loading and skeletons
  - [x] 32.1 Write failing tests for map/tracking skeletons and LoadError retry
    - Add `apps/web/tests/loading-states.test.tsx`: `PlatformMapSkeleton` and `CitizenTrackingSkeleton` render layout-shaped placeholders; an async surface failure shows the console `LoadError` pattern with a retry control.
    - _Requirements: 19.3, 19.4_
  - [x] 32.2 Add `loading.tsx` for each async segment and the two new skeletons
    - Add route-level `loading.tsx` to each async admin/platform/console/account segment (console, admin tabs, platform, platform/map, track, profile, settings) rendering layout-shaped skeletons; add `PlatformMapSkeleton` and `CitizenTrackingSkeleton` to `apps/web/src/components/loading.tsx`; ensure failures reuse the `LoadError` retry pattern.
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

### Phase 7 — Documentation (R21)

- [x] 33. Update governing documentation
  - [x] 33.1 Update PRODUCT.md and DESIGN.md
    - Edit `PRODUCT.md` to describe the UI/UX overhaul and the notification system; edit `DESIGN.md` to describe the Theme_Token CSS-variable model, the `data-theme` theme strategy, the App_Shell, and the new primitives.
    - _Requirements: 21.1, 21.2_
  - [x] 33.2 Update SECURITY.md, apps/web README, .env.example, and AGENTS.md
    - Edit `SECURITY.md` for notification tenant-isolation, targeting authorization, the forced-critical policy, and platform separation of duties; update `apps/web/README.md` and `apps/web/.env.example` to document `SMTP_*` and `VAPID_*` without secret values; add a change-log entry to `AGENTS.md`.
    - _Requirements: 21.3, 21.4_

### Final gate

- [x] 34. Final checkpoint — run the quality gate
  - Run `pnpm check`, ensure typecheck + tests are green, then run `pnpm format`. Ask the user if questions arise.
  - _Requirements: 22.1, 22.2, 22.3, 22.4_

## Notes

- Tasks marked with `*` are optional property-based tests and can be skipped for a faster MVP; all other sub-tasks are implemented.
- The first actionable task (1.1) establishes failing tests before implementation, setting the TDD pattern for every subsequent task.
- Each task references the specific acceptance criteria it satisfies for traceability.
- Checkpoints (29, 34) ensure incremental validation; `pnpm check` must stay green after every task.
- Property tests validate the universal correctness properties (1–10) from the design; unit/component/integration tests cover examples, edge cases, and route behavior.
- The notification core is tested entirely against the in-memory store + fake Email/WebPush senders — no DB, SMTP, or VAPID credentials required.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4"] },
    { "id": 1, "tasks": ["1.2", "2", "3", "5.1", "6.1", "7.1", "8.1"] },
    { "id": 2, "tasks": ["5.2", "6.2", "7.2", "8.2", "17", "18", "24.1"] },
    { "id": 3, "tasks": ["5.3", "8.3", "9.1", "10.1", "19", "20.1", "24.2"] },
    { "id": 4, "tasks": ["9.2", "10.2", "20.2", "21.1", "23.1"] },
    {
      "id": 5,
      "tasks": [
        "11.1",
        "12.1",
        "13.1",
        "20.3",
        "20.4",
        "20.5",
        "20.6",
        "20.7",
        "21.2",
        "22",
        "23.2"
      ]
    },
    { "id": 6, "tasks": ["11.2", "11.3", "12.2", "13.2", "16.1", "21.3", "23.3", "25.1"] },
    { "id": 7, "tasks": ["14.1", "15.1", "16.2", "25.2", "26.1", "27.1"] },
    { "id": 8, "tasks": ["14.2", "15.2", "26.2", "27.2", "28.1"] },
    { "id": 9, "tasks": ["26.3", "26.4", "28.2"] },
    { "id": 10, "tasks": ["30.1", "31.1", "32.1"] },
    { "id": 11, "tasks": ["30.2", "31.2", "32.2"] },
    { "id": 12, "tasks": ["33.1", "33.2"] }
  ]
}
```
