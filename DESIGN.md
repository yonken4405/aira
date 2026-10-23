# DESIGN.md: Impeccable Design System (Operate Mode)

> Binding visual law for `apps/mobile`, `apps/web` and `packages/ui`. No component may ship that breaks
> these rules. Companion files: [PRODUCT.md](./PRODUCT.md), [SECURITY.md](./SECURITY.md),
> [AGENTS.md](./AGENTS.md).

---

## 1. Operate Mode

This product runs **strictly in Operate Mode**: interfaces behave like emergency equipment, not like a
marketing site. Every pixel either helps someone act faster or it is removed.

**Aesthetic:** high-contrast, strictly functional, utilitarian, accessible.

**It must not look "AI generated".** Banned outright:

- Glassmorphism, frosted/blurred panels, glassy gradients.
- Glowing borders, neon halos, drop shadows used as decoration, colored blur.
- Bouncy/springy/overshooting animations, parallax, floating orbs, shimmer skeletons.
- Emoji as icons, playful illustrations, mascots, gradients behind text.
- Rounded-everything "friendly SaaS" styling, pill-ness for its own sake.

If a UI element looks like a dribbble shot rather than equipment, delete it.

---

## 2. Core rules

1. **Visual hierarchy first.** One primary action per screen; hierarchy established by size, weight and
   contrast, never by decoration.
2. **Large tap targets (mobile).** SOS grid cells are effectively full-quadrant targets (min ~140×140
   dp on a 5.5" device). All other tappable elements are ≥ 48×48 dp with ≥ 8 dp separation.
3. **Dense but readable (web dashboard).** Tables/queues use tight spacing (8-12 px rhythm), tabular
   numerals for times/distances, 12-13 px body text minimum, visible hairline dividers.
4. **Typography:** system font stack only (see §3). No display fonts, no italics for decoration,
   uppercase + letter-spacing reserved for small labels.
5. **Motion:** only 100-150 ms opacity/color transitions, `ease-out` or linear. Nothing moves position.
   Function-only exceptions: a small `Loader2` spinner while a request is in flight and the subdued
   `animate-pulse` skeleton placeholder. No shimmer, no keyframe flourishes. Respect
   `prefers-reduced-motion` (web) by disabling all of it (`motion-reduce:animate-none`).
6. **Color is semantic, never decorative.** Category colors appear on badges, markers, icons, borders,
   and nowhere else.
7. **Accessibility:** WCAG AA (≥ 4.5:1 body, ≥ 3:1 large text) against the dark surface; every control
   has an accessible label; state is never conveyed by color alone (always pair with text/icon).
8. **Language hierarchy:** English label primary, Bisaya secondary (see PRODUCT.md §3). The payload IDs
   stay Bisaya but are never shown as raw identifiers in the UI.
9. **Icons:** Lucide (the shadcn icon set) only: `lucide-react` on web, imported through `@aira/ui/web`.
   Sizes 12-20 px, `strokeWidth={2}`, always `aria-hidden` when decorative and paired with a text label.
   Category icons: `Flame` (Fire), `HeartPulse` (Medical), `ShieldAlert` (Crime), `Waves` (Flood).
   **No emoji, no hand-drawn SVG, no colored div squares standing in for icons.**

---

## 3. Design tokens (shared)

Single source of truth: `packages/tailwind-config/index.js`, consumed by **both** apps through
`presets: [require("@aira/tailwind-config")]`. Do not fork tokens per app.

| Token               | Value     | Use                               |
| ------------------- | --------- | --------------------------------- |
| `ink`               | `#0B0F14` | App background                    |
| `surface`           | `#12181F` | Panels, sidebar                   |
| `raised`            | `#1A222C` | Cards, elevated rows              |
| `line`              | `#2A3441` | Hairline borders/dividers         |
| `fg`                | `#F2F5F8` | Primary text                      |
| `muted`             | `#93A1B0` | Secondary text (≥ 4.5:1 on `ink`) |
| `emergency.sunog`   | `#FF3B1F` | Fire                              |
| `emergency.medikal` | `#00D08A` | Medical                           |
| `emergency.krimen`  | `#FFC53D` | Crime                             |
| `emergency.baha`    | `#4CC2FF` | Flood                             |

Notification/status tones (toasts, queue state) - semantic only, never decorative:

| Token               | Value     | Use                            |
| ------------------- | --------- | ------------------------------ |
| `status.queued`     | `#FFC53D` | Waiting for dispatch           |
| `status.dispatched` | `#4CC2FF` | Unit assigned/en route         |
| `status.resolved`   | `#00D08A` | Closed                         |
| `status.success`    | `#00D08A` | Success toast                  |
| `status.error`      | `#FF3B1F` | Error toast / blocking failure |
| `status.info`       | `#4CC2FF` | Neutral/informational toast    |

Typography: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
(system stack = zero download, maximum legibility). Radius is near-zero (`0-4px`). Shadows: none.

---

## 3a. Theme tokens: the CSS-variable model (light / dark / system)

The tokens in §3 are no longer raw hex compiled into class names. Each color token is a **CSS
variable** consumed through `rgb(var(--color-*) / <alpha-value>)`, so Tailwind's opacity modifiers
(`bg-ink/85`, `text-muted/70`) keep working and every existing utility (`bg-ink`, `border-line`,
`text-fg`, `text-status-*`, `border-emergency-*`, …) resolves unchanged. The preset in
`packages/tailwind-config/index.js` stays the single source of truth; only the values move to
variables.

**`data-theme` is the single source of truth — not a `.dark` class.** The resolved theme is written as
`data-theme="light"` / `data-theme="dark"` on `<html>`. We do not use Tailwind's `dark:` variant; both
themes resolve purely through the variable cascade from `:root` / `[data-theme]` selectors. The
variables are defined as space-separated RGB channels (so `<alpha-value>` works):

- **Dark** = the exact §3 palette, channelized. It is the `:root` / `[data-theme='dark']` default.
- **Light** = a companion palette re-tuned so body text, UI boundaries, and the emergency/status tones
  still meet WCAG AA (§2 rule 7) on light surfaces.
- `color-scheme` is bound per theme (`dark` by default, `light` under `[data-theme='light']`).

**No FOUC.** A tiny inline pre-paint script in the root layout runs before first paint: it reads
`localStorage['aira-theme']` (default `system`), resolves `system` against `prefers-color-scheme`, and
sets `data-theme` synchronously so there is never a flash of the wrong theme.

**Preference runtime.** The preference (`light` | `dark` | `system`) is persisted in
`localStorage['aira-theme']`, defaults to `system`, and when `system` it subscribes to
`prefers-color-scheme` changes and re-resolves live with no reload. A **three-way ThemeToggle**
(light / dark / system) lives in the App_Shell header (§5b) and is also surfaced in Settings. Theme
state and the toggle are provided by `ThemeProvider` / `useTheme` / `ThemeToggle` in `@aira/ui/web`;
apps must not re-implement them.

---

## 4. Mobile UI spec (`apps/mobile`): the SOS grid

The **primary (and only MVP) screen** must feature **massive, high-contrast tap targets** using the fixed
English labels with the Bisaya word kept as the secondary line:

```
┌───────────────────────────────┐
│ AIRA          ● MESH: STANDBY │   ← header, hairline bottom border
├───────────────────────────────┤
│ What is your emergency?       │   ← one-line instruction (English first)
│ Tap one. It sends instantly  │
├────────────────┬──────────────┤
│   Fire         │   Medical    │   ← 2×2 grid, each cell = ~half screen
│   Sunog        │   Medikal    │     English word huge (≥ 36 px, extrabold)
├────────────────┼──────────────┤     category color on 2 px border only
│   Crime        │   Flood      │
│   Krimen       │   Baha       │
├────────────────┴──────────────┤
│ LAST TRANSMISSION             │
│ ["SUNOG",10.3157,123.8854]    │   ← monospace payload readout
└───────────────────────────────┘
```

Rules for this screen:

- English label is the largest element on the cell; the Bisaya word is a small uppercase hint under it
  (swap the emphasis when the `ceb` locale ships - same components, no redesign).
- Category color appears **only** as a 2 px border and the label color; no fills, no gradients.
- Press feedback: instant opacity change (~100 ms). No scale/bounce/spring.
- **Forbidden on this screen (and everywhere in the app): microphone icons, audio waveforms, chat
  bubbles, AI mascot/avatar interfaces, "hold to talk", "type a message".** See PRODUCT.md §2: these
  features are removed at the architecture level, not merely hidden.

---

## 5. Responder web spec (`apps/web`)

Layout: `header / [320px queue sidebar | flexible map | 360px routing panel]`, single screen. The only
modal is the dispatch confirmation dialog (DESIGN.md §6); no other flows interrupt the operator.

- **Queue sidebar:** structured rows only: category badge (English + Bisaya + Lucide icon), time,
  distance with a `Navigation` icon, status text, source tag (`mesh`). Category filter chips across the
  top (All, Fire, Medical, Crime, Flood). **No conversational text anywhere**: citizens send only
  the payload (PRODUCT.md §4).
- **Map:** legible at a glance: muted raster base, Lucide category icons inside hairline marker squares
  (category color on the border, never a filled blob), dashed route line from responder origin to
  selection, `RadioTower` station marker, visible attribution. Never a decorative/abstract map.
- **Routing panel:** decoded payload readout in monospace (`["SUNOG",10.3157,123.8854]`), distance,
  ETA, unit selector, one primary "Assign UNIT-01" action that opens a **confirmation dialog** and
  reports the result through the toast system (mock dispatch in MVP).
- **Header:** queued count, mesh standby state, cache indicator, refresh action. Statuses pair an icon
  with text, never a bare colored dot.
- Tables/lists: tabular numerals, right-aligned numerics, hairline dividers, no zebra stripes, no
  card-per-row bloat.

UI primitives live in `@aira/ui/web` (`Button`, `CategoryBadge`, `EmergencyIcon`, `Skeleton`, `Toast`,
`ConfirmDialog`): shadcn-style composition on Radix + CVA. The apps must not re-implement them.

---

## 5a. Revamp surfaces (2026-10-22)

All new surfaces stay in Operate Mode (§1): no gradients/glass/glow/bounce, Lucide icons only, tokens
from `@aira/tailwind-config`, semantic color only, WCAG AA, state never by color alone.

**Offline / "no signal" states (citizen app, Tier 0/1 - PRODUCT.md §1b).**

- The four-button grid is always the first screen and always interactive, online or off. Connectivity
  never blocks a tap.
- A single honest status line in the header reports transport state with an icon + text, never a bare
  dot: `MESH: STANDBY` / `MESH: BROADCASTING` / `OFFLINE - QUEUED (n)`. Use Lucide `RadioTower` /
  `WifiOff`; no spinners on the grid itself.
- A queued (unsent) alert shows as a plain list row with its payload and a `Clock` marker; it drains
  silently when the transport reports backhaul. No celebratory motion, no toast storm.
- Tier 2 surfaces (account, medical, tracking) render an explicit disabled/"unavailable offline" state
  when there is no backhaul - never a blank panel, never a hang.

**Civilian tracking view (Tier 2).**

- Reached after a submit (anonymous via the returned token/deep-link, or in-app for a signed-in
  citizen). Layout: a vertical **status timeline** (`QUEUED → DISPATCHED → EN_ROUTE → ON_SCENE →
RESOLVED`) with the current step emphasised by weight/contrast, plus a map showing the incident
  marker and the assigned responder's live position.
- Each timeline step pairs a Lucide icon with text and a `HH:MM` tabular-numeral timestamp. No
  coordinates or PII are ever shown to the citizen beyond their own incident's map markers.
- Polls on a short interval; a stale/expired token shows a calm "this tracking link has expired" state,
  not an error toast.

**Admin = DRRM officer oversight (Tier 2).**

- `/admin` keeps Accounts + Audit and **adds** a read-only **Live map** and **Dashboards**: incident
  volume, response-time metrics (tabular numerals), active-unit count, and a barangay heatmap. All
  read-only: there are **no assign/dispatch controls** anywhere on the admin surface (RBAC enforces it;
  the UI must not imply otherwise).
- Metrics are dense tables + a map, not marketing cards: hairline dividers, right-aligned numerics, no
  zebra, no decorative charts. A heatmap uses the status/category tokens only, with a text legend.

**Live markers (console + civilian map).**

- A responder's live position is a distinct marker from incident markers: a hairline square with a
  Lucide unit glyph and the callsign label; category color is reserved for incident markers.
- Position updates move the marker by a 100-150 ms linear/opacity transition only (§5); no bounce, no
  trailing path animation, no pulsing "radar". Respect `prefers-reduced-motion` (snap, no transition).
- A position that has gone stale (past its TTL) is shown muted with a "last seen HH:MM" label, never as
  a live fix.

**Responder mobile mode (specced now, built later - PRODUCT.md §5).**

- Same Operate-Mode tokens and `@aira/ui` primitives as the console. Screens: assigned-incident list,
  accept dispatch, status advance (`EN_ROUTE / ON_SCENE / RESOLVED`), the on-incident medical snapshot
  (need-to-know, SECURITY.md §8), and a single primary **Navigate** button that deep-links to Google
  Maps (coordinates only, SECURITY.md §11).
- Background location while en route is a documented permission + battery consideration; the position
  stream is Tier 2 and pauses when the assignment resolves. No in-app turn-by-turn (we hand off).

UI primitives for all of the above live in `@aira/ui/web`; do not re-implement them per surface.

---

## 5b. App_Shell & information architecture (web, all tiers)

One shared **App_Shell** header wraps every authenticated `apps/web` view. It replaces the four
previously hand-rolled per-area headers (`AdminHeader`, `PlatformHeader`, and the inline `Dashboard`
header); those are deleted, not duplicated. Still Operate Mode (§1): no gradients/glass/glow, Lucide
icons only, tokens from `@aira/tailwind-config`, state never by color alone.

- **Fixed entry points, same place, every tier.** The header always exposes the **Notification bell**
  (unread badge, §6a), **Profile**, **Settings**, the **ThemeToggle** (§3a), and **sign-out** in a
  consistent position regardless of tier.
- **Tier-filtered primary nav.** Navigation entries are filtered before render: responder entries are
  gated by the Role's permissions via `can()`; platform-only entries render only for platform
  operators (who carry no responder `Role`). A tier never sees another tier's nav. Active state is
  computed by the shared `NavLink` (`exact` vs `nested`), which sets `aria-current="page"` when active
  and omits it otherwise.
- **Admin consolidation.** The four flat admin routes collapse into **one tabbed `/admin` surface**
  (accounts / dashboards / audit). The selected tab derives from the URL so each is a deep-linkable
  bookmark; tabs are gated per permission and omitted when the permission is absent; `/admin/overview`
  redirects to `/admin`. Switching tabs updates content without re-mounting the shell/header.
- **Account/password relocation.** The formerly chrome-less `/account/password` page now renders inside
  the App_Shell with the principal's authorized nav, like every other view.

**Profile & Settings** (every tier, under the App_Shell): a **Profile** view (display name, read-only
email, callsign — callsign editable for responders) and a **Settings** view (appearance + per-channel
notification delivery preferences). `AppShell`, `NavLink`, and these views live in / are composed from
`@aira/ui/web`; apps must not re-implement the shell or the active-link logic.

---

## 6. Loading, notifications & confirmations

**Skeletons (mandatory for every async surface).**

- First load shows a skeleton of the real layout (queue rows, map frame, routing metrics); never a blank
  panel and never a lone spinner.
- Skeletons use `bg-raised` + `animate-pulse` with `motion-reduce:animate-none`; no shimmer, no gradient.
- Refreshing existing data keeps the current rows visible (no skeleton flash); only the refresh control
  shows a spinner and is disabled while in flight.
- Blocking failures replace the panel with an error state (`TriangleAlert` + explanation + Retry), not a
  toast alone.

**Toasts (one unified surface).**

- Every asynchronous outcome (dispatch success, load failure) goes through the shared `useToast()` API in
  `@aira/ui/web`; no ad-hoc banners or alerts.
- Flat, bordered, `role="status"`, auto-dismiss after 5 s, dismissible with a Lucide `X`.
- Tones: `success` / `error` / `info` (left border only). Titles are short and uppercase; the description
  carries the incident id.
- Toasts never carry coordinates or PII - ids and unit callsigns only (SECURITY.md §1).

**Confirmations (before irreversible actions).**

- Mock dispatch is confirmation-gated through `ConfirmDialog` (Radix AlertDialog): focus trap, ESC to
  cancel, explicit Confirm/Cancel buttons, destructive tone when applicable.
- Never use `window.confirm`; never auto-dispatch on a single click.

**Caching (short-lived, private).**

- The incident list is cached client-side with a 10 s TTL plus in-flight de-duplication; manual refresh
  forces revalidation.
- API responses are `Cache-Control: private, max-age=5, stale-while-revalidate=25` - shared/CDN caching of
  coordinates is forbidden.
- Cached data is memory-only: nothing incident-related is persisted to disk or localStorage.

---

## 6a. Notification surface & new primitives

**Three channels, one in-app surface.** Notifications deliver over three channels — **in-app**
(persisted), **email** (Gmail SMTP via `nodemailer`), and **web push** (VAPID via `web-push` + a
service worker). Channels are attempted in the fixed order `CHANNEL_ORDER` = in-app → email → web push,
synchronously inside the triggering request, fail-soft (a channel failure never changes the triggering
action's result — see PRODUCT.md §8). The in-app channel renders through the **Notification bell /
Notification Center** in the App_Shell header (§5b):

- A bell with an **unread badge**; the count is exposed to assistive tech via `aria-live` and an
  `aria-label`.
- The list is reverse-chronological, scoped strictly to the signed-in principal's `(tier, principalId)`,
  and refreshed by short-interval polling (paused when the tab is hidden) plus an immediate refetch
  after mark-read / mark-all-read.
- No decoration: a flat bordered panel, Lucide icons only, Operate-Mode tokens; an unread row is marked
  by weight/contrast and text, never by color alone.
- Civilian-broadcast and system-notice **send** actions are confirmation-gated (§6) and summarize their
  audience before sending.

**New accessible primitives (`@aira/ui/web`).** The library gains `Textarea`, `Checkbox`, `Radio`, and
`Switch`, all sharing the common control class and the visible focus ring, keyboard-operable, with copy
via `t()`. `Switch` is `role="switch"` with `aria-checked`. These back the Settings delivery-preference
toggles and the broadcast/notice forms; apps must not re-implement them.

**`Field` error wiring.** `Field` now injects `aria-describedby` (hint/error ids) and
`aria-invalid` onto its child control so assistive tech announces validation errors. Existing `Field`
usages keep working unchanged.

---

## 7. Review checklist (run before marking any UI done)

- [ ] Would this pass as panel labeling on an ambulance/fire truck? (Operate Mode)
- [ ] No gradients, glass, glow, bounce, decorative shadow, emoji-as-icon, or mascot?
- [ ] Contrast ≥ 4.5:1 for body text? English label dominant on the SOS grid, Bisaya visible?
- [ ] Icons are Lucide (via `@aira/ui/web`), never hand-rolled shapes or emoji?
- [ ] Async surfaces have skeletons; outcomes route through the unified toast; irreversible actions ask
      for confirmation?
- [ ] Cache TTLs and `Cache-Control` stay private and short; no coordinates in shared caches or logs?
- [ ] Tap targets ≥ 48 dp (mobile), focus states visible (web), reduced-motion respected?
- [ ] No microphone/chat/AI affordance introduced anywhere?
- [ ] Tokens used from `@aira/tailwind-config`; no ad-hoc hex values in components?
- [ ] Offline-first: the SOS grid works with no signal; Tier 2 surfaces show honest "unavailable"
      states and never block a Tier 0 action (PRODUCT.md §1b)?
- [ ] Live markers move only via the 100-150 ms transition, reduced-motion snaps, stale positions are
      muted with "last seen"; no radar/pulse/trail decoration?
- [ ] Admin surface exposes **no** dispatch/assign control (read-only oversight only)?
- [ ] Citizen tracking view shows no PII or coordinates beyond the reporter's own incident markers?
