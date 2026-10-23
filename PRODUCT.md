# PRODUCT.md: AIRA MVP Definition

> Canonical product definition for this repository. Every agent and engineer must read this file before
> writing code. Companion guardrails: [DESIGN.md](./DESIGN.md), [SECURITY.md](./SECURITY.md),
> [TESTING.md](./TESTING.md), [AGENTS.md](./AGENTS.md).

**AIRA** = **AI Responsive Alert** (brand name retained; see §2: there is currently no AI in the product).

---

## 1. What AIRA is

A resilient, **offline-first** emergency reporting and dispatch platform for Cebu (and similar
hyper-local contexts), modelled on how a Philippine DRRM office runs a 911 call - but better:

| Surface           | Package       | Purpose                                                                          |
| ----------------- | ------------- | -------------------------------------------------------------------------------- |
| Citizen App       | `apps/mobile` | React Native/Expo. One-tap emergency reporting that works with **zero** network. |
| Responder Console | `apps/web`    | Next.js. Dispatcher routing + live map + queue; admin oversight; responder work. |
| Shared Core       | `packages/ui` | Category model, mesh payload builder/validator, i18n strings, shared UI pieces.  |
| Persistence       | `packages/db` | Supabase CLI (local Postgres + SQL migrations); Prisma optional typed client.    |

Auth is provider-agnostic: Supabase is used as a Postgres provider, **not** as an auth provider (see
SECURITY.md §4), so the database can move to any Postgres host without touching the apps.

### 1-multitenant. Platform model (2026-10-22): AIRA is multi-tenant SaaS

AIRA is a platform: many LGU / barangay DRRM offices across the Philippines, each a
**tenant**. Tenants are onboarded **in person** by the AIRA team - there is **no
self-serve signup and no billing on the website**. A tenant is simply `active` or
`suspended`. Each tenant owns exactly one LGU office tree (the one-LGU rule is per-tenant).

Three identity tiers, fully isolated from one another:

1. **Platform operator (superadmin)** - the AIRA team. Manages tenants/offices and the
   nationwide office map, and bootstraps each tenant's first DRRM admin. Holds **zero**
   incident/citizen access (billing/ops, not emergency operations). Its first account is
   CLI-provisioned (`platform:create-admin`); there is no public signup.
2. **Responder (DRRM)** - RESPONDER / DISPATCHER / ADMIN, scoped to their tenant. **Login
   is by email**; the callsign is now an optional operational display label (radio/map),
   not a credential.
3. **Citizen** - anonymous (Tier 0 mesh) or optionally registered (§1a).

Cross-tenant isolation is deny-by-default: a DRRM user only ever sees their own tenant,
enforced in SQL (the office-subtree scope is hard-bounded to the tenant). A platform
session never resolves to a responder/citizen principal, and vice versa.

### 1a. Two tiers of citizen (2026-10-22 revamp)

AIRA serves one citizen two ways, and the product degrades gracefully between them:

1. **Anonymous SOS (Tier 0, the survival core).** No account, no PII, works with zero internet and
   zero cell signal over the Bluetooth/LoRa mesh. Tap one button → the frozen payload
   `["SUNOG",10.3157,123.8854]` is broadcast and relayed hop-by-hop. This is non-negotiable: in a
   disaster you cannot assume login, a server, or a tower is reachable. The anonymous path never
   depends on a reachable backend.
2. **Registered citizen (optional, online enrichment).** An optional account (email/device-key
   identity, **no telco/SMS** - SECURITY.md §7) unlocks an opt-in **medical profile** and emergency
   contacts, an in-app **tracking view** (status timeline + the assigned responder's live position),
   and online-enriched submissions. Registration is always optional and is **never a login wall**
   (§6): the button grid works the same whether signed in or not.

The frozen mesh payload (§4) stays anonymous and ≤64 bytes forever. All identity, medical, and
tracking data is **attached out-of-band when online**, keyed to the anonymous incident after the
fact - it never enters the mesh frame.

### 1b. Offline-first feature tiering (PRODUCT LAW)

Every feature is classified by the connectivity it requires. Lower tiers must keep working when
higher tiers are dark.

- **Tier 0 - mesh-only (zero connectivity):** anonymous SOS compose / broadcast / receive / relay.
  Never depends on a reachable server.
- **Tier 1 - local mesh (no cloud):** peer acknowledgement ("a unit has seen this"), a responder
  device receiving a nearby alert directly, relaying others' alerts, and a locally cached medical
  snapshot on an assigned responder's device so it survives a brief outage.
- **Tier 2 - online enrichment (degrades gracefully to "unavailable"):** citizen accounts + medical
  profile, live responder GPS tracking, the civilian tracking view, the dispatcher console and admin
  oversight dashboards, email/device identity, and the Google Maps navigation deep-link.

A Tier 2 outage must surface honest "no signal / unavailable" UI and must never block a Tier 0 action.

**Mesh transport:** Bluetooth / LoRa. Apps code to a `MeshTransport` abstraction (send/subscribe/relay)
with a mock implementation today; the real LoRa (paired radio module) + Bluetooth implementations are
a separate, flagged **hardware track** that never blocks app/console work. The frontend never blocks
on the mesh.

---

## 2. Architectural pivot: REMOVED FEATURES (authoritative)

> **All Voice-to-Text (STT) and local LLM/chatbot features have been REMOVED.**

Decision date: **2026-10-21**. Logged in [AGENTS.md](./AGENTS.md#change-log).

Hard requirements that forced this pivot:

1. **< 30 MB** final app size (APK/AAB): no speech models, no tokenizer/LLM weights.
2. **Flawless on low-end Android**: no audio capture pipeline, no model inference, no background
   transcription services.
3. **No reliable offline Cebuano (Bisaya) STT exists**: an unreliable voice path in an emergency
   product is worse than no voice path.

**Permanently out of scope unless this document is explicitly revised:**

- Microphone capture, recording, audio permissions, STT/transcription, voice waveforms.
- Chat bubbles, conversational UI, message threads with citizens.
- AI mascots, assistants, avatars, "smart" replies.
- On-device LLMs, cloud LLM calls, embeddings, RAG, prompt pipelines.

If any of the above is ever proposed again, it requires a written revision of this file **and** a security
review per [SECURITY.md](./SECURITY.md).

---

## 3. Core interaction: the zero-latency emergency button grid

The citizen app relies **100% on a hyper-localized, zero-latency emergency button grid.**

The entire citizen flow is: **open app → tap one giant button → alert exists.** Target: ≤ 2 taps, ≤ 1
second, zero reading beyond a single recognizable word, usable with shaking hands, in daylight, by a
panicked user who has never opened the app before.

### Categories (fixed, closed enum; no free text from citizens)

| Payload ID | Display (English, primary) | Secondary (Bisaya) | Meaning                 |
| ---------- | -------------------------- | ------------------ | ----------------------- |
| `SUNOG`    | **Fire**                   | Sunog              | Fire / structural blaze |
| `MEDIKAL`  | **Medical**                | Medikal            | Medical emergency       |
| `KRIMEN`   | **Crime**                  | Krimen             | Crime / security threat |
| `BAHA`     | **Flood**                  | Baha               | Flood / severe weather  |

The responder console (`apps/web`) consumes **exactly these four categories** as structured queue rows
and map markers. It never renders conversational text from citizens (there is none).

### Language policy (2026-10-22)

- **English is the primary product language** on both surfaces. Labels, buttons, empty states, toasts and
  errors are authored in English first.
- **Bisaya stays visible as the secondary label** on the citizen grid (and in the responder badge). The
  hyper-local words are not dropped; they are demoted to secondary until a full localization phase.
- **Tagalog and full Bisaya UI are later phases.** They must be a dictionary change, not a rewrite: all
  copy lives in `@aira/ui` (`t()`, `categoryLabel()`), and `AVAILABLE_LOCALES` currently ships only
  `['en']`. Adding a locale means translating keys, then adding it to that list.
- **Payload IDs remain Bisaya (`SUNOG`, `MEDIKAL`, `KRIMEN`, `BAHA`).** They are a frozen wire format
  (§4) and identifiers, not display strings; never rename them when the UI language changes.

---

## 4. Offline transmission payload (future Bluetooth/LoRa mesh)

Data sent over the future mesh must be a **hyper-compressed JSON array**: positional, no keys, no
whitespace, ASCII/UTF-8, **≤ 64 bytes**:

```json
["SUNOG", 10.3157, 123.8854]
```

Format: `["<CATEGORY>", <latitude>, <longitude>]`

Rules:

1. Exactly 3 positional elements: category, WGS84 latitude, WGS84 longitude.
2. Coordinates rounded to **4 decimal places** (≈ 11 m accuracy: enough to dispatch, small on air).
3. Category ∈ { `SUNOG`, `MEDIKAL`, `KRIMEN`, `BAHA` }: a closed set, never arbitrary strings.
4. **Zero PII**: no name, no phone number, no device ID, no IP, no free text (see SECURITY.md §1).
5. One alert = one array. No envelope, no metadata keys, no version field (see §5 for handshake).
6. Single-line JSON, UTF-8 encoded.

The IDs are the Bisaya words for wire stability, but they are identifiers; the UI renders the
English label (§3 language policy). Never localize the IDs themselves.

**Single source of truth:** `packages/ui` exports `buildSosPayload()`, `serializeSosPayload()` and
`parseSosPayload()`. The mobile app and the intake API must both use them; never re-implement.

---

## 5. MVP scope

**In scope (frontend skeleton only):**

- Mobile: the 4-button SOS grid (English primary, Bisaya secondary); pressing a button logs the exact
  compressed payload (`console.log` = mock transport) and shows it on screen.
- Web: live map (MapLibre) centered on Cebu with Lucide category markers, incident queue sidebar filtered
  by the four categories, responder routing panel (distance/ETA/dispatch mock) showing the decoded mesh
  payload.
- Web UX states: layout-shaped **skeletons** on first load, a **unified toast** surface for asynchronous
  outcomes, and a **confirmation dialog** before (mock) dispatch.
- **Caching:** short-TTL, browser-private caching of the queue (TTL cache + in-flight de-duplication in the
  client, `Cache-Control: private` on the API). Coordinates must never enter a shared cache.
- API: `GET/POST /api/incidents`: validates payloads with `parseSosPayload()`; **in-memory only.**
- Shared: category model + payload logic + i18n strings with unit tests.
- DB scaffold: Supabase CLI local stack and SQL migrations (schema only, not wired into the apps).

**Now in scope (2026-10-22 revamp - implemented behind the tiering in §1b):**

- `MeshTransport` abstraction + mock implementation; offline-aware citizen app (outbox queue, "no
  signal" states, local receive/relay store).
- Dispatcher **nearest-responder routing suggestions** (ranked by distance + category→agency
  capability + barangay jurisdiction, using office/responder base positions).
- Optional **citizen accounts** (email/device-key identity, mock email verification, no telco) with an
  opt-in **medical profile** + emergency contacts, encrypted at rest.
- **On-incident, need-to-know medical access:** revealed to the assigned responder only while they
  hold the active incident, audit-logged, auto-revoked on RESOLVED (SECURITY.md §8).
- **Live responder GPS tracking** via short-interval polling: responders PUT an ephemeral,
  incident-scoped position; dispatchers and the reporting citizen see it on the map (SECURITY.md §9).
- **Anonymous incident tracking token:** intake returns an opaque, unguessable, expiring code/deep-link
  so an accountless reporter can follow one incident's status (SECURITY.md §10).
- **Admin = DRRM officer oversight:** read-only live map + dashboards (volume, response-time metrics,
  active units, barangay heatmap). Dispatching stays with dispatchers (separation of duties).
- Responder **Google Maps navigation deep-link** (coordinates only, no PII) from an assigned incident.

**Still out of scope / separate tracks (do not attempt inline):**

- Real LoRa/Bluetooth radio transport (**hardware track**, flagged, non-blocking).
- The responder **mobile app/mode** (streaming position, in-field accept/navigate): **specced** this
  phase, built later; responders act from the web console until then.
- Telco/SMS identity, push notifications, any AI/voice feature (see §2).

---

## 6. Non-negotiable product law

> **The user flow must be immediately intuitive for panicked users.**

Practical consequences: one giant tap target per category, fixed wording (English label + Bisaya
secondary, never synonyms), high contrast, no menus, no onboarding carousel, **no login wall**, no
ambiguity between categories. When in doubt, remove.

**The account never gates the SOS.** Registration, the medical profile and the tracking view (§1a) are
optional enrichment reached from a secondary surface; the four-button grid is always the first screen
and always works unauthenticated and offline. A panicked or accountless user loses nothing on the core
flow. Offline-first (§1b) outranks every enrichment feature: when the network is down, the button grid
and the mesh still work, and everything online is allowed to go dark.
---

## 7. Responder/platform web experience (2026 UX overhaul)

The `apps/web` surfaces (responder console, DRRM admin, platform operator) share one coherent
chrome instead of four hand-rolled per-area headers. This is product law for every authenticated
web tier.

### 7a. Theming (light / dark / system)

- Every web user chooses **Light**, **Dark**, or **System** from a three-way **ThemeToggle** in the
  App_Shell header. Dark is the original Operate-Mode palette unchanged; Light is a WCAG-AA companion.
- The preference is persisted in `localStorage['aira-theme']`, defaults to **System**, and when set to
  System it follows the OS `prefers-color-scheme` live (no reload). See DESIGN.md §3a for the token
  model (`data-theme` + CSS variables) and the pre-paint, no-flash guarantee.

### 7b. One App_Shell, one information architecture

- A single shared **App_Shell** header wraps every authenticated web view. It always exposes the same
  fixed entry points in the same place for every tier: the **Notification bell**, **Profile**,
  **Settings**, the **ThemeToggle**, and **sign-out**.
- Primary navigation is tier-filtered: responder entries are gated by the Role's permissions (`can()`),
  platform-only entries appear only for platform operators. A tier never sees another tier's nav.
- The four previously flat admin routes are consolidated into **one tabbed `/admin` surface**
  (accounts / dashboards / audit), deep-linkable per tab; `/admin/overview` redirects to `/admin`. The
  password-change page, formerly chrome-less, now lives under the App_Shell like every other view.

### 7c. Profile & Settings (every tier)

- A **Profile** view shows display name, email, and callsign (callsign editable for responders; email
  is read-only identity).
- A **Settings** view holds appearance (the theme control) plus per-channel notification delivery
  preferences (in-app / email / web push).

### 7d. Unified UX primitives (product law)

- **Toasts:** every asynchronous outcome (success or failure) surfaces through one shared Toast system
  (`aria-live`, `role="status"`, auto-dismiss). No ad-hoc banners or alerts.
- **Confirmations:** high-impact actions are confirmation-gated through one shared ConfirmDialog —
  suspend/activate tenant, incident **RESOLVED** transition, unlock/deactivate/role-change account,
  revoke sessions, and logout. Suspend and resolve use the destructive tone.
- **Loading:** every async surface renders a route-level skeleton shaped like its real layout. No
  spinner-only blank screens and no layout shift on load.

---

## 8. Notification system (three channels)

AIRA delivers notifications over **three channels**:

1. **In-app** — persisted, surfaced in the App_Shell notification bell / Notification Center with an
   unread badge and short-interval polling.
2. **Email** — Gmail SMTP via `nodemailer`.
3. **Web push** — VAPID via `web-push` and a service worker.

**Synchronous, fail-soft, no queue.** Notifications are sent server-side inside the request that
triggers them; there is no background queue or new realtime infrastructure. Delivery is **fail-soft**:
a notification failure never changes the HTTP result of the action that triggered it. Channels are
attempted in the fixed order `CHANNEL_ORDER` = in-app → email → web push, and each records exactly one
delivery outcome.

**Recipient model — three isolated tiers.** A recipient is a `(tier, principalId)` pair across the
three fully isolated tiers (responders / platform_admins / citizens) with **no shared users FK** —
mirroring the identity isolation in §1-multitenant. A notification is only ever visible to its
addressee.

**Delivery preferences and critical override.** Each principal controls per-channel delivery in
Settings (§7c). In-app cannot be opted out of (an in-app opt-out is rejected). The system-wide policy
constant `CRITICAL_FORCES_ALL_CHANNELS = true` means a **critical warning** forces email and web push
through even when the recipient opted out; in-app is always forced.

**What triggers a notification.** Event hooks fire on: incident assignment; account role-change,
deactivate, unlock, and lock; and tenant onboard / suspend.

**Civilian broadcasts & system notices (tier-gated).**

- **Civilian broadcasts** (DRRM / barangay warnings to citizens) are gated by the `civilian-broadcast`
  capability (DISPATCHER + ADMIN). Targeting is bounded to the sender's tenant office-subtree
  (`OFFICE_SCOPE`); an out-of-subtree target is denied atomically with no partial delivery and an
  audited violation (see SECURITY.md).
- **System maintenance notices** are a platform-tier capability (platform operators only), fanning out
  across all tiers while granting the operator no citizen/incident access.
