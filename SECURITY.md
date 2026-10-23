# SECURITY.md: AIRA Security Baseline

> Binding security rules for every agent and engineer working in this repository. Violations block
> merge. Companion files: [PRODUCT.md](./PRODUCT.md), [DESIGN.md](./DESIGN.md),
> [TESTING.md](./TESTING.md), [AGENTS.md](./AGENTS.md).

Context: AIRA handles **live GPS coordinates of people in emergencies**. Treat location data as
health data. The citizen sends nothing else - there is no account, no voice, no chat (PRODUCT.md §2).

---

> **2026-10-22 revamp.** AIRA now has a two-tier citizen model (PRODUCT.md §1a): an anonymous,
> zero-PII mesh path (Tier 0) that is unchanged and frozen, plus an **optional** registered-citizen
> tier that deliberately introduces PII (identity, health data, live location). That new PII is
> permitted only under the strict, minimised, need-to-know controls added in §7-§11 below. The mesh
> frame itself stays anonymous forever; PII rides out-of-band, online only.

## 1. Personally Identifiable Information (PII)

1. **The mesh payload carries zero PII.** `["SUNOG", lat, lon]` only; never name, phone, device ID,
   IP, account ID, or free text (PRODUCT.md §4). This is absolute and applies to every tier: a
   registered citizen's online submission attaches identity out-of-band (§7), never inside the frame.
2. **Data minimization by construction.** The citizen app must not request contacts, microphone,
   camera, photo/media, or SMS permissions. GPS use is deferred to a future phase; until then only the
   documented mock coordinates exist (in code, clearly marked `MOCK_LOCATION`).
3. **Location is sensitive PII.** When live coordinates are implemented: round to 4 dp at the edge,
   keep raw traces in memory only, never write coordinates to logs/analytics/error reports.
4. **Retention:** incidents retain coordinates only as long as the response needs them; define & enforce
   a retention window before real persistence ships. Pseudonymous incident IDs only (`mesh-<ts>`).
5. **No third-party trackers** (analytics, ads, crash SDKs) in either app.
6. Secrets live in `.env` (git-ignored) via `.env.example` templates; never in source, never in the
   client bundle.

## 2. Encryption (chat is removed; encryption now covers transport + mesh)

Chat/STT was removed (PRODUCT.md §2), so there is **no user messaging channel to encrypt end-to-end
today**. Encryption duties moved to:

1. **Transport:** all dashboard/API traffic is HTTPS/TLS only; no plaintext HTTP endpoints.
2. **Mesh (future):** Bluetooth/LoRa frames MUST be encrypted with an authenticated cipher
   (AES-256-GCM using a provisioned pre-shared key + rolling counter/nonce) before broadcast, so a
   sniffed frame cannot be replayed or read. Replay/dupe suppression at the receiver.
3. **At rest:** future PostgreSQL data encrypted at rest; DB credentials scoped least-privilege.
4. If a citizen↔responder text channel is ever added (requires a PRODUCT.md revision), it must be
   end-to-end encrypted before any message is stored, not as a follow-up.

## 3. Input handling & sanitization (post-STT rules)

There is **no STT input anymore**, which removes an entire class of audio-injection/transcription abuse
(PRODUCT.md §2). New rules that replace "sanitize STT transcripts":

1. **Citizen input surface is a closed enum.** The only citizen-originated value is one of four fixed
   category IDs. Enforce it server-side with `parseSosPayload()` (`packages/ui`); client validation
   is convenience, never security.
2. **All API input is validated (reject-by-default):** malformed JSON, wrong types, unknown category,
   out-of-range coordinates → `400`, nothing logged verbatim.
3. **Any free text that exists (responder notes, unit names, future incident descriptions) MUST be:**
   length-capped, control characters stripped, HTML-escaped at output, and never rendered with
   `dangerouslySetInnerHTML` / raw HTML injection.
4. **No reintroduction of LLMs = no prompt-injection surface.** If an AI feature is ever proposed, it
   requires a new threat-model section in this file first.

## 4. Authentication & Role-Based Access Control (responders)

**Auth is provider-agnostic and owned by AIRA.** Supabase is used strictly as a Postgres provider
(local dev + SQL migrations); **Supabase Auth is disabled** (`packages/db/supabase/config.toml`), there is
no `auth.users` reference, no Supabase JWT, and no RLS-as-authz assumption. Consequence: the database can
move to any Postgres host without rewriting authentication, and no Supabase client keys belong in either
app.

Responder identity lives in our own tables (`packages/db`):

- `responders`: callsign, role, `password_hash` (**argon2id**), active flag.
- `responder_sessions`: opaque session token **hash** only, expiry, revocation timestamp.

Roles (schema models them as `ResponderRole`):

| Role         | Permissions                                                                |
| ------------ | -------------------------------------------------------------------------- |
| `UNIT`       | View + accept dispatches assigned to their unit; update own status.        |
| `DISPATCHER` | Full queue view, routing, assignment, cross-unit visibility.               |
| `ADMIN`      | Responder account management, audit log access. No citizen PII by default. |

There is **no `CITIZEN` account**: citizens are unauthenticated by design and can only submit a payload.

Rules:

1. **Deny by default.** Every protected route checks role server-side; the UI hiding a control is not
   access control. Data API roles (`anon`, `authenticated`) are revoked from all tables and tables are
   not auto-exposed; the backend connects to Postgres directly with least-privilege credentials.
2. Unit responders see only their assigned incidents until dispatcher-level actions occur.
3. Sessions/tokens: short-lived, `HttpOnly`/`Secure`/`SameSite` cookies or rotating bearer tokens; only
   hashes at rest; no tokens in localStorage, no tokens in URLs. Sessions are revoked server-side.
4. Password hashing is argon2id with per-user salts; never reversible, never logged, never returned by
   any API.
5. Every assignment/view of an incident writes an audit event (actor, role, action, incident ID,
   timestamp; no coordinates in the audit payload).

## 5. Real-time GPS coordinates

1. Precision: 4 dp (~11 m) in transit and at rest; never full-precision GPS.
2. Never include coordinates in URLs, query strings, referrers, or analytics.
3. Map tiles/markers render coordinates client-side; do not mirror them into server logs.
4. Rotation/retention of stored coordinates: defined, minimized, documented before DB goes live.
5. WebSocket/SSE channels (future) require auth + per-role subscriptions (UNIT sees own assignments).
6. **Caching:** incident data is a private, short-lived resource. Client caches are memory-only with a
   TTL of seconds (10 s today) and hold no PII; API responses use `Cache-Control: private, max-age=5,
stale-while-revalidate=25`. `public`/CDN caching of coordinates is forbidden, and coordinates must
   never appear in toasts, console logs, analytics, or error reports.
7. **Database access:** schema changes go through `supabase/migrations/*.sql` (reviewed like code).
   Applications hold a least-privilege `DATABASE_URL` only; never a Supabase `service_role` key, and
   never the `anon` key (the Data API is not part of the architecture).

## 6. Engineering hygiene (enforced in this repo)

1. **Dependency discipline:** no AI/voice/media/telemetry packages (PRODUCT.md §2). All installs go
   through the pinned workspace; install/postinstall scripts are allow-listed in
   `pnpm-workspace.yaml` (`allowBuilds`); never widen that list without review.
2. **Strict TypeScript** everywhere (`packages/typescript-config`), reject-by-default validation at boundaries.
3. **No secrets in code or commits**; `.env*` is git-ignored.
4. **Errors:** generic messages to clients, details only in server console (without PII).
5. **Client libraries:** do not add `@supabase/supabase-js` to the apps (no Supabase Auth/Data API
   usage). UI additions stay minimal and static: currently Lucide icons, Radix primitives and CVA,
   with no telemetry or remote asset loading.
6. **Report responsibly:** file security issues privately to the maintainer, never in public issues.

## 7. Citizen identity (optional, email/device-key - no telco)

Registered citizen accounts (PRODUCT.md §1a) are **optional** and never gate the SOS (PRODUCT.md §6).

1. **Identity is email or an opaque device key.** No phone number, no SMS/OTP, no telco integration.
   Email verification is mocked in this phase (consistent with the mock mesh transport); a real
   verification channel is a later, reviewed change. No third-party identity provider.
2. **Separate from responder identity.** Citizen accounts live in their own table and issue their own
   session tier; a citizen session can never resolve to a responder principal or any `responder:*`
   permission. Citizens hold exactly one app-level capability: submit + track **their own** incidents.
3. **Passwords (if used) are argon2id** with per-user salts, same rules as responders (§4.4): never
   reversible, never logged, never returned. Device-key identity stores only a hash of the key.
4. **Sessions:** opaque tokens, only hashes at rest, `HttpOnly`/`Secure`/`SameSite`, short-lived and
   server-revocable; no tokens in localStorage or URLs (as §4.3).
5. **Deletion:** a citizen can delete their account; deletion removes identity, medical profile and
   contacts. Anonymous incidents already submitted stay anonymous (they never carried identity).

## 8. Medical profile (sensitive health PII, need-to-know)

A registered citizen may opt into a medical profile (allergies, conditions, medications, blood type,
age band) and emergency contacts. This is **health data** and gets the strictest handling in the repo.

1. **Opt-in and owner-controlled.** Empty by default; only the owning citizen can read or write their
   own profile in full. Absence is normal and must not degrade triage.
2. **Encrypted at rest** with an authenticated cipher; the plaintext profile is never returned to any
   actor other than the owner, never written to logs, analytics, or error reports, and never placed in
   a shared cache.
3. **On-incident, need-to-know reveal (deny by default).** A responder sees a citizen's medical
   snapshot **only while assigned to that citizen's active incident**. The reveal is a server-side
   access grant tied to the assignment; it is **auto-revoked when the incident reaches RESOLVED** (or
   on reassignment) and it is **audit-logged** (actor, citizen-less incident id, timestamp - never the
   coordinates, never the full profile body).
4. **Minimised payload.** The responder reveal returns only triage-relevant fields, not the entire
   account. Emergency-contact phone numbers are shown to the assigned responder only, under the same
   grant.
5. **Tier 1 cache exception:** an assigned responder's device may cache the snapshot locally so it
   survives a brief outage (PRODUCT.md §1b); the cache is incident-scoped, memory/secure-store only,
   and cleared on resolve/reassign.

## 9. Responder live location (ephemeral, incident-scoped)

Live responder tracking (PRODUCT.md §1a/§5) is real GPS and is therefore sensitive.

1. **Purpose-bound.** A responder streams position **only while holding an active assignment**; there
   is no ambient, always-on tracking of staff. No position is accepted or served outside an active,
   non-resolved incident the responder is assigned to.
2. **Ephemeral + precision-limited.** Positions are stored at 4 dp (§5.1), kept only as the latest
   fix(es) needed for the live view, and **auto-expire** (short TTL) so a stale position is never
   served as "live". Positions are pruned on resolve.
3. **Scoped visibility.** The assigned responder's current position is visible to dispatchers in the
   office subtree and to the **reporting citizen for that one incident** (via §10) - no cross-incident
   or cross-citizen exposure.
4. **Never logged.** Responder coordinates obey §5: not in logs, URLs, analytics, toasts, or shared
   caches.

## 10. Incident tracking tokens (anonymous follow)

So an **accountless** reporter can follow one incident (PRODUCT.md §1a/§5):

1. Intake returns an **opaque, unguessable** token (CSPRNG, ≥128 bits), **scoped to exactly one
   incident** and **expiring** (bounded lifetime, revoked on resolve + retention window).
2. The token grants **read-only status + assigned-responder live position for that incident only** -
   never the queue, never another incident, never any PII. Only a hash of the token is stored.
3. Tokens never appear in logs or analytics; they are delivered once to the submitting device. A
   registered citizen tracks their own incidents through their session instead of a token.

## 11. Navigation deep-link boundary (Google Maps)

The responder "Navigate" action opens an external Google Maps directions URL (PRODUCT.md §5).

1. **Coordinates only.** The link carries only the incident's already-authorised 4 dp destination
   coordinates - never a name, medical field, citizen id, token, or any PII.
2. It is an **outbound navigation hand-off, not a data channel**: AIRA sends nothing back through it and
   receives no position from it (responder live position comes from §9's own stream).
3. No Google SDK, key, or telemetry is embedded in the apps (keeps §6.1/§6.5 and the <30 MB budget).

## 12. Multi-tenancy & the platform-operator tier (2026-10-22)

AIRA is multi-tenant (PRODUCT.md §1-multitenant). Three isolation rules are binding:

1. **Cross-tenant deny-by-default.** A DRRM user (RESPONDER/DISPATCHER/ADMIN) sees only
   their own tenant. Incident/responder/office reads are scoped in SQL; the office-subtree
   recursive scope is hard-bounded to the starting office's `tenant_id`, so a scope can
   never cross tenants even if a `parent_id` were mis-set. UI filtering is never the
   control.
2. **Three disjoint identity tiers.** Responders, citizens and **platform operators** each
   have their own table, their own session cookie (`aira_session` /
   `aira_citizen_session` / `aira_platform_session`) and their own principal. A session in
   one tier can never authenticate a route in another. The platform tier holds **zero**
   `incident:*` and no citizen/medical access - it manages tenants and bootstraps a
   tenant's first DRRM admin, nothing operational (separation of duties).
3. **Login identity is email.** Responders and platform operators log in by email
   (argon2id, lockout, timing-equalisation as §4). The responder **callsign is an optional
   display label**, not a credential, and is not unique.

**Platform provisioning.** The first platform operator is CLI-provisioned
(`platform:create-admin`); there is no public signup. Tenant onboarding is in person; no
payment data is collected or stored on the site.

**Office location pins are not citizen PII.** The nationwide operator map plots office
centroids (LGU/barangay hall locations) at 4 dp with tenant status. These are public
facility locations, not citizen coordinates, and carry no incident or citizen data.

## 13. Notifications (three channels, tenant-isolated, fail-soft)

The console sends notifications over three channels — **in-app** (persisted), **email**
(Gmail SMTP) and **web push** (VAPID) — synchronously inside the originating request. The
following rules are binding.

1. **Three isolated notification tiers, no shared user FK.** Every notification, channel
   preference and push subscription is addressed to a `(tier, principal_id)` pair where
   `tier ∈ {responders, platform_admins, citizens}` and `principal_id` is that tier's bare
   UUID. There is **no** cross-tier foreign key and no shared users table — the data model
   mirrors the three disjoint identity tiers of §12.2. A recipient only ever sees
   notifications addressed to their own `(tier, principal_id)`; cross-tier/cross-principal
   reads are impossible by construction.
2. **Send authorization is server-side and capability-gated.**
   - **Civilian broadcasts** (warnings/advisories to citizens) are gated by the
     `civilian-broadcast` permission in `rbac.ts`, granted only to **DISPATCHER** and
     **ADMIN**; RESPONDER and CITIZEN are denied with zero delivery.
   - **System-wide notices** are a **platform-tier** capability
     (`PLATFORM_CAN_SYSTEM_NOTICE`), authorized via the platform session only — never a
     responder permission, keeping §12.2 separation of duties. A non-platform principal is
     denied with zero delivery.
   - Hidden UI controls are never access control (§4.1); authorization runs in the handler
     before any targeting.
3. **Tenant isolation on targeting (no cross-tenant reach).** Every tenant-scoped send
   resolves recipients through the existing `OFFICE_SCOPE` recursive CTE bounded by
   `tenant_id` (§12.1), treated as the authoritative recipient set. A send whose target
   office/tenant lies outside the sender's office-subtree is **denied atomically — zero
   partial delivery** — writes a `denied` audit row with the violation, and returns a
   rejection. The SQL bound is the authority; no notification query can widen scope.
4. **Forced critical warnings (one documented policy constant).** A single system-wide
   constant `CRITICAL_FORCES_ALL_CHANNELS` (documented default **true**, never overridable
   per send) governs whether a Critical_Warning overrides email/web-push opt-out. The
   in-app copy is **always** delivered for a critical warning regardless of preference, and
   a recipient cannot opt out of in-app for critical warnings. When a forced override sends
   on a channel the recipient had disabled, that override is recorded (`overridden`) per
   notification per recipient. Routine (non-critical) notifications honor opt-out on every
   channel.
5. **No PII in notification content.** Notification titles and bodies carry no personal
   data: the recipient's identity comes from the addressed `(tier, principal_id)`, never
   from rendered text. Platform-operator notifications in particular carry **no** incident
   content or citizen data (§12.2 separation of duties), and sending a broadcast/notice
   grants the sender **no** read access to citizen or incident data — the handlers only
   write notification/audit rows and resolve recipient ids. Coordinates never appear in a
   notification (§5).
6. **Secrets via env, never in source or logs.** SMTP (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
   `SMTP_PASS`/`SMTP_FROM`) and VAPID (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`)
   credentials are read **only** inside `src/lib/notifications/email-sender.ts` and
   `web-push-sender.ts` from the environment, never embedded in source, never logged, never
   returned in responses (§1.6 / §6.3). The VAPID **public** key is the one value shipped to
   the browser (required to register a push subscription under the Web Push protocol); the
   private key is server-only. Gmail requires an App Password, never the account password.
   A push subscription is bound to exactly one `(tier, principal_id)` and only its owner can
   read or modify it.
7. **Fail-soft delivery never changes an action's result.** The in-app copy is persisted
   first; email and web push are then attempted in a fixed order inside `try/catch`. A
   missing credential records `not_attempted`, a disabled channel records `skipped`, a
   thrown send records `failed` — and in every case dispatch returns normally so the
   originating transaction commits unchanged. A notification failure **never** alters the
   HTTP result of the action that triggered it (e.g. tenant onboarding still succeeds when
   the email send fails). Exactly one delivery outcome is recorded per channel per
   notification.

**Definition of done:** a feature that touches data, auth, or third-party boundaries also updates this
file and is covered by tests per [TESTING.md](./TESTING.md).
