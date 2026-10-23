# Requirements Document

## Introduction

This feature adds the missing **citizen-facing account and medical-profile UI** to the AIRA mobile app
(`apps/mobile`, React Native / Expo). Today the app ships exactly one screen — the four-button SOS grid
(`EmergencyGridScreen`) backed by a mock mesh transport — and no account, login, or profile screens exist.

The backend for this feature **already exists** in `apps/web` and is consumed, not re-specified, here:

- Citizen identity HTTP routes: `/api/citizen/register`, `/api/citizen/login`, `/api/citizen/device`,
  `/api/citizen/session`, `/api/citizen/logout` (email + opaque device-key identity, opaque session
  tokens issued as an `HttpOnly` cookie, argon2id passwords, lockout + timing-equalisation, mocked email
  verification — SECURITY.md §7).
- Medical profile HTTP routes: `GET` / `PUT` / `DELETE` `/api/citizen/medical`, owner-only, AES-256-GCM
  encrypted at rest via `MEDICAL_ENCRYPTION_KEY`, with on-incident need-to-know reveal already wired
  server-side (SECURITY.md §8). Canonical fields are defined by `MedicalProfile` in
  `apps/web/src/lib/medical/profile.ts`.

The product law that frames every requirement below: the **SOS grid is the first screen and is never
gated** by an account (PRODUCT.md §6); registration and the medical profile are **optional, Tier-2
online enrichment** reached from a *secondary* surface and must **degrade honestly to "unavailable"
offline** without ever blocking a Tier-0 SOS action (PRODUCT.md §1a/§1b). The anonymous mesh SOS path is
frozen and unchanged by this feature.

This spec covers the mobile UI, its on-device session persistence, and its consumption of the existing
APIs. It identifies exactly one minimal backend gap — a citizen **account-deletion** endpoint required by
SECURITY.md §7.5 but not yet exposed — and specifies it to match existing handler patterns. It explicitly
does **not** add emergency categories, telco/SMS, real email verification, WebSockets, or any
voice/chat/AI surface.

## Glossary

- **Mobile_App**: The AIRA citizen application in `apps/mobile` (React Native / Expo), entry `App.tsx`.
- **SOS_Grid**: The existing `EmergencyGridScreen` — the four-button (SUNOG/MEDIKAL/KRIMEN/BAHA) emergency
  grid that is the first and primary screen. A frozen Tier-0 surface; out of scope to change.
- **Secondary_Surface**: Any account/medical screen reached from a non-primary affordance on the Mobile_App.
  Never placed ahead of, over, or as a precondition to the SOS_Grid.
- **Citizen**: A person using the Mobile_App. May be anonymous (default) or a Registered_Citizen.
- **Registered_Citizen**: A Citizen who holds an optional account via email identity or device-key identity.
- **Email_Identity**: Account identity established by email + password (argon2id server-side). Email
  verification is mocked in this phase (SECURITY.md §7.1).
- **Device_Key_Identity**: Zero-friction, passwordless identity established by an opaque 43-character
  URL-safe device key (base64url of 32 bytes). Register-or-login in one step; the server stores only a
  hash (SECURITY.md §7.3).
- **Citizen_Session**: The authenticated session issued by the backend as an opaque token in the
  `aira_citizen_session` `HttpOnly` cookie. Only a hash is stored server-side; it is idle- and
  absolute-expiring and server-revocable (SECURITY.md §7.4).
- **Session_Store**: The Mobile_App's on-device secure storage holding the Citizen_Session credential and
  the device key so the session survives app restarts.
- **Medical_Profile**: The owner-controlled, opt-in health record defined by the `MedicalProfile` type:
  `bloodType`, `ageBand`, `allergies[]`, `conditions[]`, `medications[]`, `notes`, and `contacts[]`.
  Encrypted at rest; empty by default (SECURITY.md §8).
- **Emergency_Contact**: An entry in `Medical_Profile.contacts` with `name`, `phone`, and optional
  `relation`.
- **Blood_Type**: One of the closed set `A+ A- B+ B- AB+ AB- O+ O-`.
- **Age_Band**: One of the closed set `0-12 13-17 18-39 40-64 65+` (coarse band, never a birth date).
- **Citizen_Backend**: The existing `/api/citizen/*` HTTP routes in `apps/web` consumed by the Mobile_App.
- **Account_Delete_Endpoint**: The minimal new citizen account-deletion HTTP endpoint required by
  SECURITY.md §7.5 (see Requirement 10).
- **Tier_0_Action**: An anonymous mesh SOS compose/broadcast action — the survival core that works with
  zero connectivity (PRODUCT.md §1b).
- **Tier_2_Feature**: An online-enrichment feature (accounts, Medical_Profile) that must degrade to an
  honest "unavailable offline" state (PRODUCT.md §1b).
- **Connectivity_Unavailable**: The state in which the Mobile_App cannot reach the Citizen_Backend.
- **Copy_Catalog**: The shared i18n message dictionary in `packages/ui/src/i18n.ts`, accessed via `t()`.
  All user-visible strings originate here; components contain no string literals (DESIGN.md language policy).

## Requirements

### Requirement 1: SOS grid is never gated by an account

**User Story:** As a panicked or accountless Citizen, I want the SOS grid to be the first thing I see and
to work without any account, so that I never lose the survival core to a login wall.

#### Acceptance Criteria

1. WHEN the Mobile_App launches, THE Mobile_App SHALL present the SOS_Grid as the first interactive screen.
2. THE Mobile_App SHALL allow every Tier_0_Action on the SOS_Grid without a Citizen_Session.
3. THE Mobile_App SHALL expose account and Medical_Profile entry points only from a Secondary_Surface.
4. WHILE no Citizen_Session exists, THE Mobile_App SHALL keep the SOS_Grid fully interactive.
5. WHILE the Secondary_Surface is open, THE Mobile_App SHALL allow the Citizen to return to the SOS_Grid
   without signing in.
6. IF the Citizen_Backend is unreachable, THEN THE Mobile_App SHALL keep every Tier_0_Action on the
   SOS_Grid available.
7. THE Mobile_App SHALL preserve the SOS_Grid's existing four-category closed enum (SUNOG, MEDIKAL,
   KRIMEN, BAHA) and its frozen mesh wire format without modification.

### Requirement 2: Optional registration with email identity

**User Story:** As a Citizen, I want to optionally create an account with my email and a password, so that
I can later attach an opt-in Medical_Profile and track my own incidents.

#### Acceptance Criteria

1. WHERE the Citizen opens the registration Secondary_Surface, THE Mobile_App SHALL present an email field
   and a password field using Copy_Catalog strings.
2. WHEN the Citizen submits an email and a password, THE Mobile_App SHALL send them to `/api/citizen/register`.
3. WHEN registration returns `201`, THE Mobile_App SHALL persist the issued Citizen_Session in the
   Session_Store and display the Registered_Citizen state.
4. IF `/api/citizen/register` returns `400 invalid_email`, THEN THE Mobile_App SHALL display an
   invalid-email message from the Copy_Catalog and retain the entered email.
5. IF `/api/citizen/register` returns `400 weak_password`, THEN THE Mobile_App SHALL display a
   weak-password message from the Copy_Catalog.
6. IF `/api/citizen/register` returns `409 registration_unavailable`, THEN THE Mobile_App SHALL display a
   generic registration-unavailable message that does not reveal whether the email is already in use.
7. IF `/api/citizen/register` returns `429 rate_limited`, THEN THE Mobile_App SHALL display a rate-limited
   message and SHALL re-enable submission after the response `retry-after` seconds elapse.
8. THE Mobile_App SHALL NOT persist, log, or display the entered password after the registration request
   completes.

### Requirement 3: Optional device-key identity (zero-friction)

**User Story:** As a Citizen who does not want to type an email, I want to create an account with a single tap, so that I get enrichment without friction.

#### Acceptance Criteria

1. WHEN the Citizen chooses the device-key option and no device key exists in the Session_Store, THE Mobile_App SHALL generate a device key consisting of 32 bytes from a cryptographically secure random source encoded as a 43-character base64url string and store it only in the Session_Store.
2. WHEN the Citizen chooses the device-key option and a device key already exists in the Session_Store, THE Mobile_App SHALL reuse the existing stored device key without generating a new one.
3. WHEN the Citizen chooses the device-key option, THE Mobile_App SHALL send the stored device key to `/api/citizen/device` and SHALL await a response for a maximum of 10 seconds.
4. WHEN `/api/citizen/device` returns `200` within 10 seconds, THE Mobile_App SHALL persist the issued Citizen_Session in the Session_Store and display the Registered_Citizen state.
5. IF `/api/citizen/device` returns `400 invalid_device_key`, THEN THE Mobile_App SHALL discard the stored device key, regenerate a new 43-character base64url device key, retry the request to `/api/citizen/device` up to a maximum of 1 retry, and WHEN the retry also fails THE Mobile_App SHALL display a retry message from the Copy_Catalog and retain no Citizen_Session.
6. IF `/api/citizen/device` returns any response other than `200` or `400 invalid_device_key`, or does not respond within 10 seconds, or the request fails due to a network error, THEN THE Mobile_App SHALL retain the stored device key, display an error message from the Copy_Catalog indicating the request could not be completed, and remain in the pre-registration state.
7. THE Mobile_App SHALL store the device key only in the Session_Store and SHALL NOT transmit the device key to any destination other than `/api/citizen/device`.

### Requirement 4: Login with email identity

**User Story:** As a Registered_Citizen with an Email_Identity, I want to sign in on this or another
device, so that I can reach my own Medical_Profile.

#### Acceptance Criteria

1. WHEN the Citizen submits an email and a password on the login Secondary_Surface, THE Mobile_App SHALL
   send them to `/api/citizen/login`.
2. WHEN `/api/citizen/login` returns `200`, THE Mobile_App SHALL persist the issued Citizen_Session in the
   Session_Store and display the Registered_Citizen state.
3. IF `/api/citizen/login` returns `401 invalid_credentials`, THEN THE Mobile_App SHALL display an
   invalid-credentials message from the Copy_Catalog that does not distinguish between a wrong email and a
   wrong password.
4. IF `/api/citizen/login` returns `423 account_locked`, THEN THE Mobile_App SHALL display a locked
   message from the Copy_Catalog stating the retry window derived from the response `retryAfterSeconds`.
5. IF `/api/citizen/login` returns `429 rate_limited`, THEN THE Mobile_App SHALL display a rate-limited
   message and SHALL re-enable submission after the response `retry-after` seconds elapse.
6. THE Mobile_App SHALL NOT persist, log, or display the entered password after the login request completes.

### Requirement 5: Logout

**User Story:** As a Registered_Citizen, I want to sign out, so that my session is removed from this device.

#### Acceptance Criteria

1. WHEN the Citizen confirms sign-out, THE Mobile_App SHALL send a request to `/api/citizen/logout`.
2. WHEN the logout request completes, THE Mobile_App SHALL remove the Citizen_Session from the
   Session_Store and display the anonymous state.
3. IF the Citizen_Backend is unreachable during logout, THEN THE Mobile_App SHALL remove the local
   Citizen_Session from the Session_Store and display the anonymous state.
4. WHEN logout completes, THE Mobile_App SHALL return the Citizen to the SOS_Grid.
5. THE Mobile_App SHALL confirm sign-out with the Citizen before removing the Citizen_Session.

### Requirement 6: On-device session persistence

**User Story:** As a Registered_Citizen, I want my session to survive app restarts, so that I do not
re-authenticate every time I open the app.

#### Acceptance Criteria

1. WHEN the Mobile_App launches AND a Citizen_Session exists in the Session_Store, THE Mobile_App SHALL
   validate the session against `/api/citizen/session`.
2. WHEN `/api/citizen/session` returns `200`, THE Mobile_App SHALL display the Registered_Citizen state
   without prompting for credentials.
3. IF `/api/citizen/session` returns `401 unauthenticated`, THEN THE Mobile_App SHALL remove the stored
   Citizen_Session from the Session_Store and display the anonymous state.
4. IF the Citizen_Backend is unreachable during session validation at launch, THEN THE Mobile_App SHALL
   present the SOS_Grid and SHALL defer session validation until connectivity returns.
5. THE Mobile_App SHALL store the Citizen_Session credential only in the Session_Store and SHALL NOT write
   it to application logs, analytics, or any URL.
6. THE Session_Store SHALL use the device's secure storage facility for the Citizen_Session credential and
   the device key.

### Requirement 7: Optional medical profile create and edit

**User Story:** As a Registered_Citizen, I want to optionally add and edit my medical information, so that
an assigned responder can see triage-relevant details during my emergency.

#### Acceptance Criteria

1. WHILE a valid Citizen_Session exists, THE Mobile_App SHALL load the Medical_Profile from
   `GET /api/citizen/medical` when the Medical_Profile Secondary_Surface opens, and SHALL await a response for a maximum of 10 seconds.
2. WHEN `GET /api/citizen/medical` returns an empty profile, THE Mobile_App SHALL display an empty-profile
   state and SHALL treat an absent profile as normal.
3. IF `GET /api/citizen/medical` returns a status other than `200` and other than `401 unauthenticated`, or does not respond within 10 seconds, or fails due to a network error, THEN THE Mobile_App SHALL display a load-failure message from the Copy_Catalog, SHALL keep the Medical_Profile Secondary_Surface open, and SHALL present a control to retry the load.
4. THE Mobile_App SHALL present `bloodType` as a selection limited to the Blood_Type closed set plus an
   unset option.
5. THE Mobile_App SHALL present `ageBand` as a selection limited to the Age_Band closed set plus an unset
   option.
6. THE Mobile_App SHALL present `allergies`, `conditions`, and `medications` as editable lists of text
   entries.
7. IF the Citizen saves the Medical_Profile WHILE any text field exceeds its bounded maximum length or any editable list exceeds its bounded maximum entry count, THEN THE Mobile_App SHALL display a validation message from the Copy_Catalog and SHALL NOT send the `PUT /api/citizen/medical` request.
8. WHEN the Citizen saves the Medical_Profile AND client-side validation passes, THE Mobile_App SHALL send the edited profile to
   `PUT /api/citizen/medical`, SHALL await a response for a maximum of 10 seconds, and SHALL replace the displayed profile with the canonical profile returned
   in the response.
9. IF `PUT /api/citizen/medical` returns `401 unauthenticated`, THEN THE Mobile_App SHALL remove the
   stored Citizen_Session from the Session_Store and return the Citizen to the login Secondary_Surface.
10. IF `PUT /api/citizen/medical` returns a status other than `200` and other than `401 unauthenticated`, or does not respond within 10 seconds, or fails due to a network error, THEN THE Mobile_App SHALL preserve the Citizen's in-progress edits and SHALL display a save-failure message from the Copy_Catalog.
11. THE Mobile_App SHALL NOT write any Medical_Profile field to application logs, analytics, or error reports.
12. THE Mobile_App SHALL NOT request device-contacts, microphone, camera, photo/media, or SMS permissions
   while editing the Medical_Profile.

### Requirement 8: Emergency-contact management

**User Story:** As a Registered_Citizen, I want to add, edit, and remove emergency contacts in my
Medical_Profile, so that responders can reach the people I designate.

#### Acceptance Criteria

1. THE Mobile_App SHALL present the Medical_Profile's `contacts` as an editable list of Emergency_Contact
   entries, each with a name field, a phone field, and an optional relation field.
2. WHEN the Citizen adds an Emergency_Contact, THE Mobile_App SHALL include it in the next
   `PUT /api/citizen/medical` request.
3. WHEN the Citizen removes an Emergency_Contact, THE Mobile_App SHALL omit it from the next
   `PUT /api/citizen/medical` request.
4. IF the Citizen saves an Emergency_Contact with an empty name or an empty phone, THEN THE Mobile_App
   SHALL display a Copy_Catalog message and SHALL NOT submit that Emergency_Contact.
5. WHEN `PUT /api/citizen/medical` returns the canonical profile, THE Mobile_App SHALL display the
   contacts exactly as returned, reflecting any server-side normalization.

### Requirement 9: Delete medical profile

**User Story:** As a Registered_Citizen, I want to delete my Medical_Profile, so that my health data no
longer exists at rest.

#### Acceptance Criteria

1. WHEN the Citizen confirms Medical_Profile deletion, THE Mobile_App SHALL send
   `DELETE /api/citizen/medical`.
2. WHEN `DELETE /api/citizen/medical` returns `204`, THE Mobile_App SHALL display the empty-profile state.
3. THE Mobile_App SHALL confirm deletion with the Citizen before sending the delete request.
4. IF the Citizen_Backend is unreachable during deletion, THEN THE Mobile_App SHALL display a
   Connectivity_Unavailable message and SHALL retain the local displayed profile unchanged.

### Requirement 10: Delete citizen account (minimal backend endpoint)

**User Story:** As a Registered_Citizen, I want to delete my account, so that my identity, Medical_Profile,
and emergency contacts are removed, while my already-submitted anonymous incidents stay anonymous
(SECURITY.md §7.5).

#### Acceptance Criteria

1. THE Account_Delete_Endpoint SHALL expose a citizen-authenticated HTTP route that removes the
   authenticated Citizen's identity, Medical_Profile, and Emergency_Contacts.
2. WHEN the Account_Delete_Endpoint receives a request without a valid Citizen_Session, THE
   Account_Delete_Endpoint SHALL respond `401 unauthenticated`.
3. WHEN the Account_Delete_Endpoint receives a request from a cross-site origin, THE Account_Delete_Endpoint
   SHALL respond `403 forbidden_origin`, consistent with existing `/api/citizen/*` mutation handlers.
4. WHEN account deletion succeeds, THE Account_Delete_Endpoint SHALL revoke the Citizen_Session and clear
   the `aira_citizen_session` cookie.
5. THE Account_Delete_Endpoint SHALL leave previously submitted anonymous incidents anonymous and unchanged.
6. WHEN the Citizen confirms account deletion in the Mobile_App, THE Mobile_App SHALL call the
   Account_Delete_Endpoint, remove the Citizen_Session and device key from the Session_Store on success,
   and return the Citizen to the SOS_Grid in the anonymous state.
7. THE Account_Delete_Endpoint SHALL NOT write identity, Medical_Profile, or Emergency_Contact values to
   logs or error reports.

### Requirement 11: Tier-2 offline degradation

**User Story:** As a Citizen, I want the account and medical surfaces to tell me honestly when they are offline, so that I am never misled and the SOS core still works.

#### Acceptance Criteria

1. WHILE Connectivity_Unavailable holds, THE Mobile_App SHALL display an "unavailable offline" state on every account and Medical_Profile Secondary_Surface using Copy_Catalog strings, and SHALL NOT present stale or cached Tier_2_Feature data as current.
2. WHILE Connectivity_Unavailable holds, THE Mobile_App SHALL render the "unavailable offline" state on each affected Secondary_Surface within 1 second of the Citizen opening that surface.
3. WHILE Connectivity_Unavailable holds, THE Mobile_App SHALL NOT block, disable, delay, or add any latency to any Tier_0_Action on the SOS_Grid.
4. WHEN connectivity returns, THE Mobile_App SHALL present the Citizen with a retry control for the Tier_2_Feature action that was unavailable, and SHALL reuse any preserved in-progress edits without requiring the Citizen to re-enter them.
5. IF a Tier_2_Feature request fails due to Connectivity_Unavailable, THEN THE Mobile_App SHALL surface a non-blocking message indicating the failure was caused by lost connectivity, SHALL keep the current Secondary_Surface open and interactive, and SHALL preserve any in-progress edits the Citizen has entered for the duration of the app session.

### Requirement 12: Security and privacy constraints

**User Story:** As a Citizen, I want my identity and health data handled under strict isolation and
minimization rules, so that my sensitive information is protected (SECURITY.md §7/§8).

#### Acceptance Criteria

1. THE Mobile_App SHALL treat the Medical_Profile as sensitive health PII that is only ever displayed to
   its owning Registered_Citizen on that device.
2. THE Mobile_App SHALL keep the citizen identity tier isolated and SHALL NOT send Citizen_Session
   credentials to any responder or platform route.
3. THE Mobile_App SHALL NOT collect or transmit a phone number as an identity credential and SHALL NOT use
   SMS, OTP, or any telco channel for authentication.
4. THE Mobile_App SHALL send account and Medical_Profile requests only over HTTPS to the Citizen_Backend.
5. THE Mobile_App SHALL source every user-visible string from the Copy_Catalog via `t()` and SHALL NOT
   embed UI string literals in components.
6. THE Mobile_App SHALL render icons using the Lucide icon set and styling tokens from the shared
   NativeWind configuration (`@aira/tailwind-config`), consistent with Operate Mode (DESIGN.md §1).
7. THE Mobile_App SHALL NOT introduce any voice, chat, or AI affordance on any account or Medical_Profile
   Secondary_Surface.
8. THE Mobile_App SHALL NOT display incident coordinates or any PII beyond the owning Citizen's own account
   and Medical_Profile data.
