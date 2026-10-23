# Implementation Plan: Mobile Citizen Account

## Overview

This plan turns the approved `requirements.md` and `design.md` into incremental, test-first coding
steps for `packages/ui`, `apps/web`, and `apps/mobile`. **Requirements and design are the source of
truth**; every task below implements the design exactly — no new scope, no new technology, no new
backend routes beyond the single account-deletion endpoint the design specifies.

**The quality gate is `pnpm check`** (turbo `typecheck` + `test` across all packages). Per-package while
iterating: `pnpm --filter @aira/ui test`, `pnpm --filter @aira/web test`, `pnpm --filter @aira/mobile test`,
plus `tsc --noEmit` per package. `pnpm check` MUST stay green before any task is considered done; run
`pnpm format` at the final checkpoint.

**TDD discipline:** every unit of behavior writes its failing test(s) first, then the implementation to
green. Test and implementation tasks are paired throughout.

**Seams this plan follows (from the design):**

- **DOM-free shared core in `@aira/ui`** — pure, platform-neutral helpers (`generateDeviceKey`,
  `MEDICAL_BOUNDS`, `validateMedicalDraft`, `errorToCopyKey`, the session-restore reducer, the device-auth
  sequence model, the cookie extractor) live here and are tested with `vitest` + `fast-check`. New copy is
  added to `packages/ui/src/i18n.ts` and read via `t()` — **no string literals in components** (R12.5).
  `apps/mobile` MUST NOT import `@aira/ui/web` (DOM-only).
- **The `types.ts → service.ts → memory-store / postgres-store → route.ts` triad** already used by the
  citizen tier in `apps/web`, plus the `*-handlers.ts` + `app/api/**/route.ts` handler pattern. The new
  `DELETE /api/citizen/account` endpoint is tested against the in-memory `CitizenStore` (no Postgres),
  mirroring `apps/web/tests/api-citizen.test.ts`.
- **Mobile UI** in `apps/mobile/src` tested with `jest-expo` + `@testing-library/react-native`
  (configured; `testMatch` is `src/**/__tests__/**/*.test.{ts,tsx}`), following the existing
  `EmergencyGridScreen.test.tsx` pattern (async `render`/`fireEvent`, `testID`s, console-spy leak
  assertions, fake timers for 10 s timeouts / retry-after countdowns). Icons via `lucide-react-native`;
  tokens via `@aira/tailwind-config` (NativeWind).

**Property-based tests** use `fast-check` (already a `packages/ui` devDependency; it must be added to
`apps/mobile` for the PBTs that run under `jest-expo` — an explicit setup subtask below, justified per
AGENTS.md rule 10). Each PBT: **minimum 100 iterations**, **one property per test**, tagged
`// Feature: mobile-citizen-account, Property {n}: {property text}`. PBT sub-tasks and genuinely optional
hardening are marked optional with `*`, consistent with `web-ux-and-notifications/tasks.md`.

**Frozen surface:** the SOS grid (`EmergencyGridScreen`), its four-category closed enum
(SUNOG/MEDIKAL/KRIMEN/BAHA), and the mesh wire format are **not changed** (R1.7). `App.tsx` changes only
to render `AppNavigator` whose default screen is the grid, which keeps its current props/behaviour
verbatim.

---

## Tasks

### Phase 1 — DOM-free shared helpers in `@aira/ui` (pure, unblock everything)

- [x] 1. Add the citizen copy keys and device-key generator to `@aira/ui`
  - [x] 1.1 Add the error→copy and offline/validation keys to the Copy_Catalog
    - Add every new `MessageKey` from the design's error→copy table to `EN_MESSAGES` in
      `packages/ui/src/i18n.ts`: `citizenInvalidEmail`, `citizenWeakPassword`,
      `citizenRegistrationUnavailable`, `citizenRateLimited`, `citizenInvalidCredentials`,
      `citizenAccountLocked` (uses `{minutes}`), `citizenDeviceRetryFailed`, `citizenDeviceUnavailable`,
      `citizenMedicalLoadFailed`, `citizenMedicalSaveFailed`, `citizenMedicalInvalid`,
      `citizenContactInvalid`, `citizenOfflineUnavailable`, `citizenSessionExpired`,
      `citizenGenericError`, plus the screen/label copy for register/login/account-hub/medical screens and
      the sign-out and delete-account confirmation prompts. Extend `packages/ui/src/i18n.test.ts` to
      assert each new key resolves to a non-empty string via `t()` and that `citizenAccountLocked`
      interpolates `{minutes}`.
    - _Requirements: 12.5; supports 2.4, 2.5, 2.6, 2.7, 4.3, 4.4, 7.3, 7.10, 11.1_
  - [x] 1.2 Write failing tests for `generateDeviceKey`
    - Add `packages/ui/src/citizen/deviceKey.test.ts`: with an injected deterministic
      `randomBytes(n): Uint8Array`, the result matches `/^[A-Za-z0-9_-]{43}$/` (the server's
      `DEVICE_KEY_PATTERN`), is pure base64url (no `+`, `/`, or `=` padding), and is a function only of
      the 32 injected bytes.
    - _Requirements: 3.1_
  - [x] 1.3 Implement `generateDeviceKey` and export it
    - Create `packages/ui/src/citizen/deviceKey.ts` exporting
      `generateDeviceKey(randomBytes: (n: number) => Uint8Array): string` — 32 bytes → 43-char base64url;
      export from `packages/ui/src/index.ts`. The randomness source stays injected (no `expo-crypto`
      import in `@aira/ui`).
    - _Requirements: 3.1_
  - [-]* 1.4 Write property test for `generateDeviceKey`
    - **Property 6 (key-format piece): Generated device keys always match the server pattern**
    - **Validates: Requirements 3.1**
    - For any 32 injected random bytes, `generateDeviceKey` returns a 43-char base64url string matching
      `/^[A-Za-z0-9_-]{43}$/`.

- [x] 2. Mirror the medical bounds and implement client-side validation
  - [x] 2.1 Write failing tests for `MEDICAL_BOUNDS` mirror + server cross-check
    - Add `packages/ui/src/citizen/medicalBounds.test.ts`: assert `MEDICAL_BOUNDS` equals
      `{MAX_ITEMS:20, MAX_ITEM_LEN:80, MAX_NOTES_LEN:1000, MAX_CONTACTS:5, MAX_NAME_LEN:80,
      MAX_PHONE_LEN:32, MAX_RELATION_LEN:40}` and that `BLOOD_TYPES`/`AGE_BANDS` re-exported here equal the
      server's. Cross-check against `apps/web/src/lib/medical/profile.ts` so the two can never drift
      (import the server module in the test and assert equality / non-exceedance).
    - _Requirements: 7.7, 8.5_
  - [x] 2.2 Implement `MEDICAL_BOUNDS` and the mirrored enums, export them
    - Create `packages/ui/src/citizen/medicalBounds.ts` exporting the `MEDICAL_BOUNDS` constant and the
      `BloodType`/`AgeBand` closed sets; export from `packages/ui/src/index.ts`.
    - _Requirements: 7.7, 8.5_
  - [-]* 2.3 Write property test — client bounds never exceed server bounds
    - **Property 11: Client bounds never exceed server bounds**
    - **Validates: Requirements 7.7, 8.5**
    - For each bound in `MEDICAL_BOUNDS`, its value equals the corresponding constant in
      `apps/web/src/lib/medical/profile.ts` and never exceeds it.
  - [x] 2.4 Write failing tests for `validateMedicalDraft`
    - Add `packages/ui/src/citizen/validateMedicalDraft.test.ts`: a draft is valid iff `bloodType` is in
      `BLOOD_TYPES ∪ {null}`, `ageBand` in `AGE_BANDS ∪ {null}`, each list ≤ `MAX_ITEMS` entries each ≤
      `MAX_ITEM_LEN`, `notes` ≤ `MAX_NOTES_LEN`, ≤ `MAX_CONTACTS` contacts each with non-empty name
      (≤ `MAX_NAME_LEN`), non-empty phone (≤ `MAX_PHONE_LEN`), relation ≤ `MAX_RELATION_LEN`; invalid
      inputs return per-field copy keys (`citizenMedicalInvalid` / `citizenContactInvalid`).
    - _Requirements: 7.7, 8.4_
  - [x] 2.5 Implement `validateMedicalDraft` and export it
    - Create `packages/ui/src/citizen/validateMedicalDraft.ts` exporting the `MedicalDraft` /
      `EmergencyContactDraft` types, `ValidationResult`, and the pure `validateMedicalDraft(draft)`
      function; export from `packages/ui/src/index.ts`.
    - _Requirements: 7.7, 8.4_
  - [-]* 2.6 Write property test — validation accepts iff within bounds, and gates the PUT
    - **Property 10: Client validation accepts a draft iff within mirrored bounds; rejection blocks PUT**
    - **Validates: Requirements 7.4, 7.5, 7.7, 8.4**

- [x] 3. Implement the error→copy mapping
  - [x] 3.1 Write failing tests for `errorToCopyKey`
    - Add `packages/ui/src/citizen/errorToCopyKey.test.ts`: for every `(route, status, code)` triple in
      the design's error contract table, `errorToCopyKey` returns the mapped `MessageKey` and that key
      resolves to a non-empty string via `t()`; an unknown code falls back to `citizenGenericError`
      (never a raw token or status number).
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 4.3, 4.4, 7.3, 11.1_
  - [x] 3.2 Implement `errorToCopyKey` and export it
    - Create `packages/ui/src/citizen/errorToCopyKey.ts` exporting the pure
      `errorToCopyKey(route, status, code): MessageKey`; export from `packages/ui/src/index.ts`.
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 4.3, 4.4, 7.3, 11.1_
  - [-]* 3.3 Write property test — every known API error maps to a defined copy key
    - **Property 7: Every known API error maps to a defined Copy_Catalog key**
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.7, 4.3, 4.4, 7.3, 11.1**

- [x] 4. Implement the session-restore reducer
  - [x] 4.1 Write failing tests for the launch session-restore reducer
    - Add `packages/ui/src/citizen/sessionRestore.test.ts`: a pure reducer mapping a launch
      session-validation outcome to the next `CitizenAuthState` + a token-clear flag — `200 → registered`;
      `401 unauthenticated → anonymous` with token cleared; `offline`/`timeout`/`network → unknown` with
      token retained; no stored token → `anonymous` with no request.
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 4.2 Implement the session-restore reducer and the auth-state types, export them
    - Create `packages/ui/src/citizen/sessionRestore.ts` exporting `CitizenView`, `CitizenAuthState`
      (`anonymous` | `registered` | `unknown`), `Connectivity`, and the pure reducer; export from
      `packages/ui/src/index.ts`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [ ]* 4.3 Write property test — session-restore maps each launch outcome correctly
    - **Property 2: Session-restore maps each launch outcome to the correct state**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

- [x] 5. Implement the device-auth request-sequence model and the cookie extractor
  - [x] 5.1 Write failing tests for the device-auth sequence model
    - Add `packages/ui/src/citizen/deviceAuthSequence.test.ts`: a pure model over an existing-or-absent
      stored key and a sequence of `/device` responses — it reuses an existing valid stored key rather
      than regenerating, issues at most two requests (one retry after a single `400 invalid_device_key`,
      discarding+regenerating the key on that retry), and ends holding a session iff some response was
      `200`; any other non-200/timeout/network keeps the existing key and stays pre-registration.
    - _Requirements: 3.2, 3.5, 3.6_
  - [x] 5.2 Implement the device-auth sequence model, export it
    - Create `packages/ui/src/citizen/deviceAuthSequence.ts` exporting the pure model used by the client;
      export from `packages/ui/src/index.ts`.
    - _Requirements: 3.2, 3.5, 3.6_
  - [ ]* 5.3 Write property test — device-key auth is a bounded, reuse-first retry
    - **Property 6: Device-key authentication is a bounded, reuse-first retry**
    - **Validates: Requirements 3.2, 3.5**
  - [x] 5.4 Write failing tests for the pure cookie extractor
    - Add `packages/ui/src/citizen/cookieJar.test.ts`: `extractSessionToken(setCookieHeader)` returns the
      `aira_citizen_session` value from a `Set-Cookie` header (ignoring attributes like `HttpOnly`,
      `Path`, `SameSite`), returns `null` when the cookie is absent, and never returns attribute text.
    - _Requirements: 6.5, 12.2_
  - [x] 5.5 Implement the cookie extractor, export it
    - Create `packages/ui/src/citizen/cookieJar.ts` exporting the pure `extractSessionToken` (and a
      `formatCookieHeader(token)` helper that produces `aira_citizen_session=<token>`); export from
      `packages/ui/src/index.ts`. This is the top design risk made pure and testable.
    - _Requirements: 6.5, 12.2_

### Phase 2 — Backend: `DELETE /api/citizen/account` (the one backend addition)

- [x] 6. Add the `deleteCitizen` store primitive
  - [x] 6.1 Write failing tests for `deleteCitizen` on the in-memory store
    - Extend `apps/web/tests/support/memory-citizen-store.ts` to add `deleteCitizen(id)` to the store, and
      add a test (e.g. in `apps/web/tests/citizen-service.test.ts` or a new
      `apps/web/tests/citizen-account-delete.test.ts`) asserting `deleteCitizen` removes the citizen row
      so `findById` returns `null` afterward, and leaves other citizens untouched.
    - _Requirements: 10.1_
  - [x] 6.2 Add `deleteCitizen` to the `CitizenStore` port and both implementations
    - Add `deleteCitizen(id: string): Promise<void>` to the `CitizenStore` interface in
      `apps/web/src/lib/citizen/types.ts`; implement it in `apps/web/tests/support/memory-citizen-store.ts`
      and in `apps/web/src/lib/citizen/postgres-store.ts` as a parameterised
      `delete from public.citizens where id = $1`.
    - _Requirements: 10.1_
  - [x] 6.3 Add the account-delete cascade migration note / decision
    - Add a SQL migration under `packages/db/supabase/migrations` (following the existing citizen
      migration naming) that ensures `citizen_sessions.citizen_id` has `ON DELETE CASCADE` (so session
      rows are reaped with the account); document in the migration that contacts live inside the encrypted
      medical row, so deleting identity + medical row removes contacts, and that anonymous incidents carry
      no `citizen_id` and are therefore untouched.
    - _Requirements: 10.1, 10.4, 10.5_

- [ ] 7. Implement the account-delete service and handler
  - [x] 7.1 Write failing tests for the service `deleteCitizenAccount`
    - Add tests (in `apps/web/tests/citizen-account-delete.test.ts`) over the in-memory citizen + medical
      stores: `deleteCitizenAccount` revokes the current session (reason recorded), removes the medical
      row via `deleteOwnProfile`/`MedicalStore.remove`, and deletes the citizen via `deleteCitizen`; after
      it runs, `resolveCitizenSession` with the old token returns `null`.
    - _Requirements: 10.1, 10.4, 10.5_
  - [x] 7.2 Implement `deleteCitizenAccount` in the citizen service
    - Add `deleteCitizenAccount(citizenDeps, medicalDeps, principal)` to `apps/web/src/lib/citizen/service.ts`:
      (1) `revokeSession(principal.sessionId, { at: now, reason: 'account_deleted' })`, (2)
      `deleteOwnProfile(medicalDeps, principal.citizenId)` (reusing `MedicalStore.remove`), (3)
      `store.deleteCitizen(principal.citizenId)`. No identity/profile/contact values logged.
    - _Requirements: 10.1, 10.4, 10.5, 10.7_
  - [~] 7.3 Write failing handler/route tests mirroring existing citizen-handler tests
    - Add tests to `apps/web/tests/api-citizen.test.ts` (in-memory store, no Postgres): no session → `401
      unauthenticated`; cross-site origin → `403 forbidden_origin`; success → `204` + cleared
      `aira_citizen_session` cookie + revoked session; a pre-existing anonymous incident is untouched; a
      console/log spy confirms no identity/profile/contact value is logged.
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.7_
  - [~] 7.4 Implement `handleCitizenAccountDelete` and the route
    - Add `handleCitizenAccountDelete(request, deps)` to `apps/web/src/lib/api/citizen-handlers.ts`
      (same-origin guard → 403; `authenticateCitizen` → 401; call `deleteCitizenAccount`; return `204`
      with `NO_STORE_HEADERS` + `serializeClearedCitizenSessionCookie`). Create
      `apps/web/app/api/citizen/account/route.ts` exposing `DELETE`, following the
      `getAppDeps()` → `503 service_unavailable` guard used by the other citizen routes.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.7_

- [~] 8. Checkpoint — shared helpers + backend endpoint
  - Ensure all tests pass (`pnpm check`), ask the user if questions arise.

### Phase 3 — Mobile infrastructure (deps, SessionStore, API client, auth provider)

- [~] 9. Add the mobile dependencies (justified per AGENTS.md rule 10)
  - Add to `apps/mobile/package.json`: `expo-secure-store` (R6.6 requires the device's secure storage
    facility for the session token + device key), `lucide-react-native` (R12.6 requires the Lucide icon
    set; `lucide-react` from `@aira/ui/web` is DOM-only), and `expo-crypto` (CSPRNG bytes for
    `generateDeviceKey` in the app). Add `fast-check` as a devDependency (needed for the property-based
    tests that run under `jest-expo` — Properties 1, 3, 4, 5, 8, 9, 12). Add the new native modules to the
    `jest.config.js` `transformIgnorePatterns` allow-list where required, and mock `expo-secure-store` /
    `expo-crypto` in tests. Do NOT add a navigation library or `@react-native-community/netinfo`
    (connectivity is outcome-derived, per the design).
  - _Requirements: 6.6, 12.6; enables all mobile tasks + PBTs_

- [ ] 10. Implement the `SessionStore` over `expo-secure-store`
  - [~] 10.1 Write failing tests for `SessionStore`
    - Add `apps/mobile/src/storage/__tests__/sessionStore.test.ts` with `expo-secure-store` mocked:
      get/set/clear round-trips for both the session token (`aira.citizen.session`) and device key
      (`aira.citizen.deviceKey`); absent values return `null`; a console spy confirms neither value is
      ever logged.
    - _Requirements: 6.5, 6.6_
  - [~] 10.2 Implement `SessionStore`
    - Create `apps/mobile/src/storage/sessionStore.ts` implementing the `SessionStore` interface over
      `SecureStore.setItemAsync`/`getItemAsync`/`deleteItemAsync`; it is the ONLY module that reads/writes
      the two secrets. Never passes a value to `console`, analytics, or a URL.
    - _Requirements: 6.5, 6.6_

- [ ] 11. Implement the `CitizenApiClient`
  - [~] 11.1 Write failing tests for the client (mocked `fetch` recorder)
    - Add `apps/mobile/src/api/__tests__/citizenClient.test.ts`: HTTPS-base enforcement (a non-HTTPS base
      is refused outside development, R12.4); every request uses a 10 s `AbortController` deadline and a
      timeout yields `{ok:false,kind:'timeout'}` (fake timers, R3.3/R7.1/R7.8); a network error yields
      `{ok:false,kind:'offline'}`; on register/login/device `2xx` the `set-cookie` session token is
      extracted (via the pure extractor) and persisted through `SessionStore`, then attached as
      `Cookie: aira_citizen_session=<token>` on subsequent requests; on logout/account-delete/`401` the
      jar + store are cleared; non-2xx responses parse into `{status, code, retryAfterSeconds}`; a console
      spy confirms no body, cookie, device key, or medical field is logged.
    - _Requirements: 3.3, 6.5, 7.1, 7.8, 7.11, 12.2, 12.4_
  - [~] 11.2 Implement `CitizenApiClient`
    - Create `apps/mobile/src/api/citizenClient.ts` implementing the `CitizenApiClient` /`ApiResult`
      contract: base-URL config from `app.json` `extra`/env (HTTPS-required in release), 10 s
      `AbortController` timeouts, the manual cookie jar (reuse the `@aira/ui` `extractSessionToken` /
      `formatCookieHeader`), outcome-derived connectivity, and non-2xx parsing routed through
      `errorToCopyKey`. Targets only `/api/citizen/*`; `logout` calls `DELETE /api/citizen/session`;
      `deleteAccount` calls `DELETE /api/citizen/account`.
    - _Requirements: 3.3, 3.7, 6.5, 7.1, 7.8, 7.11, 12.2, 12.4_

- [ ] 12. Implement `CitizenAuthProvider` + `useCitizenAuth`
  - [~] 12.1 Write failing tests for the auth provider
    - Add `apps/mobile/src/auth/__tests__/CitizenAuthContext.test.tsx` (injected mock client + store):
      `register`/`login`/`deviceAuth` success → `registered` + token persisted; `restore` drives the
      session-restore reducer (`200→registered`, `401→anonymous`+clear, offline→`unknown`+retain);
      `deviceAuth` reuses an existing stored key and retries once on `400 invalid_device_key`; the
      password is dropped as soon as the request resolves (never in state/store — console spy);
      `deleteAccount` on success clears token + device key.
    - _Requirements: 2.3, 2.8, 3.2, 3.4, 3.5, 4.2, 4.6, 6.1, 6.2, 6.3, 6.4, 10.6_
  - [~] 12.2 Implement `CitizenAuthProvider` and `useCitizenAuth`
    - Create `apps/mobile/src/auth/CitizenAuthContext.tsx` holding `CitizenAuthState` + `Connectivity`
      and exposing `register`/`login`/`deviceAuth`/`restore`/`logout`/`deleteAccount` returning
      `AuthOutcome`; it wraps `CitizenApiClient` and keeps `SessionStore` + state in sync, generating the
      device key via `generateDeviceKey(expo-crypto getRandomBytes)`. Never stores a password or device
      key in React state beyond the single call that uses it.
    - _Requirements: 2.3, 2.8, 3.1, 3.2, 3.4, 3.5, 4.2, 4.6, 6.1, 6.2, 6.3, 6.4, 10.6_

### Phase 4 — Mobile navigation + screens

- [ ] 13. Implement `AppNavigator` (grid is the never-gated root)
  - [~] 13.1 Write the grid-invariance test FIRST
    - Add `apps/mobile/src/navigation/__tests__/AppNavigator.test.tsx`: the SOS grid is the first
      interactive screen on mount and every Tier-0 action (all four categories) submits without being
      blocked/disabled/delayed; switching to a secondary screen and back requires no auth. Drive this with
      `fast-check`-generated `(CitizenAuthState × Connectivity)` combinations (Property 1), tagged
      `// Feature: mobile-citizen-account, Property 1: ...`, min 100 iterations.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 11.3_
  - [~] 13.2 Implement `AppNavigator`
    - Create `apps/mobile/src/navigation/AppNavigator.tsx` with the union-typed `Screen` state machine
      (default `{name:'grid'}`), rendering the grid as the always-mounted root with a single secondary
      affordance (a `lucide-react-native` account icon) switching to `accountHub`; runs the launch
      session-restore effect (grid renders before/during it); injectable `client`/`store` for tests.
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 6.1, 6.4_
  - [ ]* 13.3 Finalize the Property 1 grid-invariance property test
    - **Property 1: The SOS grid is interactive under every auth and connectivity state**
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.6, 11.3**

- [ ] 14. Implement `AccountHubScreen`
  - [~] 14.1 Write failing tests for the account hub
    - Add `apps/mobile/src/screens/__tests__/AccountHubScreen.test.tsx`: anonymous state offers
      Register / Login / device-key entries (R1.3/R2.1); registered state shows the citizen email (if
      any), Medical-profile entry, Sign out (confirm-first, R5.5) and Delete account (confirm-first, R10.6);
      every Tier-2 row renders the offline treatment when `connectivity === 'offline'` within the 1 s
      budget (R11.1/R11.2); all copy via `t()`.
    - _Requirements: 1.3, 5.1, 5.2, 5.4, 5.5, 10.6, 11.1, 11.2_
  - [~] 14.2 Implement `AccountHubScreen`
    - Create `apps/mobile/src/screens/AccountHubScreen.tsx`: the Secondary_Surface entry point wired to
      `useCitizenAuth`; sign-out confirms then clears local state and returns to the grid even if the
      backend is unreachable; delete-account confirms then calls `deleteAccount` and returns to the grid
      anonymous. Icons via `lucide-react-native`, tokens via NativeWind; no voice/chat/AI affordance.
    - _Requirements: 1.3, 5.1, 5.2, 5.3, 5.4, 5.5, 10.6, 11.1, 11.2, 12.6, 12.7_

- [ ] 15. Implement `RegisterScreen`
  - [~] 15.1 Write failing tests for registration
    - Add `apps/mobile/src/screens/__tests__/RegisterScreen.test.tsx`: email + password fields render with
      `t()` labels (R2.1); submit posts to register; `201` persists session + shows registered state
      (R2.3); `400 invalid_email` shows the message and retains the entered email (R2.4);
      `400 weak_password` (R2.5) and `409 registration_unavailable` generic message (R2.6);
      `429 rate_limited` disables submit then re-enables after `retry-after` (fake timers, R2.7); the
      password never appears in state/store/logs after the request resolves (console spy, R2.8).
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
  - [~] 15.2 Implement `RegisterScreen`
    - Create `apps/mobile/src/screens/RegisterScreen.tsx` wired to `useCitizenAuth.register`, mapping each
      error via `errorToCopyKey`, retaining the email on `invalid_email`, and running the retry-after
      countdown on `rate_limited`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [ ] 16. Implement `LoginScreen`
  - [~] 16.1 Write failing tests for login
    - Add `apps/mobile/src/screens/__tests__/LoginScreen.test.tsx`: email + password fields; `200` persists
      session + shows registered state (R4.2); `401 invalid_credentials` shows a single non-distinguishing
      message (R4.3); `423 account_locked` shows the retry window derived from `retryAfterSeconds` as
      `{minutes}` (R4.4); `429 rate_limited` disables then re-enables submit after `retry-after` (R4.5);
      the password never leaks after the request resolves (R4.6).
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [~] 16.2 Implement `LoginScreen`
    - Create `apps/mobile/src/screens/LoginScreen.tsx` wired to `useCitizenAuth.login`, mapping
      `invalid_credentials` / `account_locked` / `rate_limited` via `errorToCopyKey` with the lock/retry
      countdowns.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 17. Implement `MedicalProfileScreen` + contacts sub-editor
  - [~] 17.1 Write failing tests for the medical screen
    - Add `apps/mobile/src/screens/__tests__/MedicalProfileScreen.test.tsx`: loads via `GET` on open with a
      10 s timeout (fake timers, R7.1); empty-profile state treats an absent profile as normal (R7.2);
      a non-200/non-401 load failure keeps the surface open and shows a retry control (R7.3); `bloodType`
      is a selection limited to the closed set + unset (R7.4), `ageBand` likewise (R7.5); allergies /
      conditions / medications are editable text lists (R7.6); saving with any field over its bound shows
      the validation message and does NOT send the PUT (R7.7); a valid save PUTs and replaces the display
      with the canonical returned profile (R7.8); `401` on PUT drops the session and returns to login
      (R7.9); a non-200/non-401/timeout/network save failure preserves in-progress edits and shows the
      save-failure copy (R7.10/R11.5); delete-profile confirms then shows empty state on `204` (R9.1–R9.3),
      and an offline delete retains the displayed profile with an offline message (R9.4). Contacts
      sub-editor: add/edit/remove with name+phone+optional relation (R8.1); an empty name or phone blocks
      that contact with a copy message (R8.4); the next PUT body reflects adds/removes exactly (R8.2/R8.3);
      contacts render exactly as returned after `200` (R8.5). A console spy confirms no profile field is
      logged (R7.11); assert no device-contacts/mic/camera/media/SMS permission API import on this screen
      (R7.12).
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 11.5_
  - [~] 17.2 Implement `MedicalProfileScreen` + contacts sub-editor
    - Create `apps/mobile/src/screens/MedicalProfileScreen.tsx`: loads on open (10 s timeout), bounded
      editors for every field using `MEDICAL_BOUNDS` + `validateMedicalDraft`, PUT/DELETE flows, the
      preserved-draft buffer for the app session, and the contacts sub-editor. Never requests
      device-contacts/mic/camera/media/SMS permissions; no voice/chat/AI affordance; all copy via `t()`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 11.4, 11.5, 12.7_

- [ ] 18. Wire `App.tsx` to render `AppNavigator`
  - [~] 18.1 Write a failing test asserting grid behaviour is retained
    - Extend `apps/mobile/src/screens/__tests__/EmergencyGridScreen.test.tsx` (or add an `App` test) to
      assert `App` renders the grid as the first screen and `GRID_CATEGORIES` still equals the closed enum
      (SUNOG/MEDIKAL/KRIMEN/BAHA) with the mesh wire format unchanged (R1.7).
    - _Requirements: 1.1, 1.7_
  - [~] 18.2 Render `AppNavigator` from `App.tsx`
    - Update `apps/mobile/App.tsx` to render `AppNavigator` (wrapped in `CitizenAuthProvider`) instead of
      `EmergencyGridScreen` directly, keeping the `StatusBar` and the grid's props/behaviour verbatim.
    - _Requirements: 1.1, 1.7_

### Phase 5 — Cross-cutting PBTs + leak/structural assertions (jest-expo)

- [ ] 19. Property tests for client data-flow and secret non-leak
  - [ ]* 19.1 Write property test — client requests target only the citizen tier; device key leaves only via `/device`
    - **Property 3: Client requests target only the citizen tier and the device key leaves only via `/device`**
    - **Validates: Requirements 3.7, 12.2**
    - `apps/mobile` (client, mocked fetch recorder) + `fast-check`.
  - [ ]* 19.2 Write property test — credentials and session tokens never leak to logs or URLs
    - **Property 4: Credentials and session tokens never leak to logs or URLs**
    - **Validates: Requirements 2.8, 4.6, 6.5**
    - `apps/mobile` (client/provider, console spy) + `fast-check`.
  - [ ]* 19.3 Write property test — logout always clears the local session regardless of backend reachability
    - **Property 5: Logout always clears the local session regardless of backend reachability**
    - **Validates: Requirements 5.2, 5.3**
    - `apps/mobile` (provider, mocked outcomes) + `fast-check`.
  - [ ]* 19.4 Write property test — medical profile fields never leak to logs
    - **Property 8: Medical profile fields never leak to logs**
    - **Validates: Requirements 7.11**
    - `apps/mobile` (client, console spy) + `fast-check`.
  - [ ]* 19.5 Write property test — in-progress edits survive every non-success save outcome
    - **Property 9: In-progress edits survive every non-success save outcome**
    - **Validates: Requirements 7.10, 11.5**
    - `apps/mobile` (medical screen) + `fast-check`.
  - [ ]* 19.6 Write property test — contact edits are reflected exactly in the next PUT body
    - **Property 12: Contact edits are reflected exactly in the next PUT body**
    - **Validates: Requirements 8.2, 8.3**
    - `apps/mobile` / `@aira/ui` + `fast-check`.

- [ ] 20. Structural guards — grid regression + no-permission / no-AI / tier-isolation
  - [~] 20.1 Grid regression and no-permission / no-AI / privacy structural assertions
    - Confirm the existing `EmergencyGridScreen.test.tsx` passes verbatim (R1.7). Add a structural test
      (extending the existing grep-style assertion) that no new account/medical screen imports a
      device-contacts / microphone / camera / photo-media / SMS permission API (R7.12) and that no new
      screen introduces any voice / chat / AI / STT affordance import (R12.7). Assert the medical surface
      renders only the owning citizen's own profile data and no incident coordinates or other-party PII
      (R12.1/R12.8), and that no mobile source references a phone-number / SMS / OTP identity channel for
      authentication (R12.3).
    - _Requirements: 1.7, 7.12, 12.1, 12.3, 12.7, 12.8_

### Final gate

- [~] 21. Final checkpoint — run the quality gate
  - Run `pnpm check` (turbo typecheck + test across all packages); ensure it is green, then run
    `pnpm format`. Ask the user if questions arise.
  - _Requirements: all_

## Notes

- Tasks marked with `*` are optional property-based tests (and genuinely optional hardening) that can be
  skipped for a faster MVP, consistent with `web-ux-and-notifications/tasks.md`; all other sub-tasks are
  implemented.
- The first actionable task (1.1) adds copy; the first behavior task (1.2) writes failing tests before
  implementation, setting the TDD pattern for every subsequent task.
- Each task references the specific requirement sub-clauses (and property IDs for PBTs) it satisfies.
- Checkpoints (8, 21) ensure incremental validation; `pnpm check` must stay green after every task.
- Pure helpers (`generateDeviceKey`, `MEDICAL_BOUNDS`, `validateMedicalDraft`, `errorToCopyKey`,
  session-restore reducer, device-auth sequence model, cookie extractor) are DOM-free in `@aira/ui`,
  tested with `vitest` + `fast-check`. Grid-invariance (Property 1) and the secret-non-leak properties
  (4 & 8) drive the client/provider from `jest-expo` with `fast-check`.
- The backend addition is tested entirely against the in-memory `CitizenStore` + medical store — no
  Postgres required — mirroring the existing citizen handler tests.
- `apps/mobile` never imports `@aira/ui/web`; icons come from `lucide-react-native`, tokens from
  `@aira/tailwind-config` (NativeWind). The SOS grid and mesh wire format are left unchanged.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "6.1"] },
    { "id": 1, "tasks": ["1.3", "2.2", "3.1", "4.1", "5.1", "5.4", "6.2", "6.3"] },
    { "id": 2, "tasks": ["1.4", "2.3", "2.4", "3.2", "4.2", "5.2", "5.5", "7.1"] },
    { "id": 3, "tasks": ["2.5", "3.3", "4.3", "5.3", "7.2", "9"] },
    { "id": 4, "tasks": ["2.6", "7.3", "10.1"] },
    { "id": 5, "tasks": ["7.4", "10.2", "11.1"] },
    { "id": 6, "tasks": ["11.2"] },
    { "id": 7, "tasks": ["12.1"] },
    { "id": 8, "tasks": ["12.2"] },
    { "id": 9, "tasks": ["13.1", "14.1", "15.1", "16.1", "17.1"] },
    { "id": 10, "tasks": ["13.2", "14.2", "15.2", "16.2", "17.2"] },
    { "id": 11, "tasks": ["13.3", "18.1"] },
    { "id": 12, "tasks": ["18.2", "19.1", "19.2", "19.3", "19.4", "19.5", "19.6"] },
    { "id": 13, "tasks": ["20.1"] }
  ]
}
```
