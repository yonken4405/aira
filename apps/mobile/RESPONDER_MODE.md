# Responder mobile mode (SPEC — not built yet)

> Status: **specced, not implemented** (PRODUCT.md §5, change log 2026-10-22). The web
> console is the responder's tool until this ships. This document is the contract the
> mode will implement; it introduces no new wire formats or backend endpoints beyond
> what already exists.

## Why a responder mode

`apps/mobile` today is the **citizen** app: the anonymous SOS grid (Tier 0). A responder
in the field needs a different surface — accept a dispatch, advance status, be navigated
to the scene, and (Tier 2) stream their position so the dispatcher and the reporting
citizen can see them move. That is this mode.

It is a **mode of the same app** (same Operate-Mode tokens, same `@aira/ui` primitives),
gated behind responder sign-in. It never weakens the citizen grid: the SOS path stays
Tier 0 and accountless.

## Screens

1. **Assigned list** — the responder's own incidents (`GET /api/incidents`, scoped to
   `incident:read:own`). Category, time, status, distance.
2. **Incident detail** — decoded payload readout, status, and the actions below.
3. **Accept / status** — advance `EN_ROUTE → ON_SCENE → RESOLVED`
   (`POST /api/incidents/:id/status`, `incident:status:own`, forward-only per
   `canTransition`).
4. **Medical snapshot** — the on-incident, need-to-know reveal
   (`GET /api/incidents/:id/medical`): shown only while assigned and unresolved, cached
   locally for the duration (Tier 1 so it survives a brief outage), cleared on
   resolve/reassign (SECURITY.md §8).
5. **Navigate** — a single primary button that opens Google Maps directions to the
   scene via `googleMapsDirectionsUrl(lat, lon)` (`@aira/ui`). Coordinates only, no PII,
   no in-app turn-by-turn (SECURITY.md §11).

## Contracts it implements (all already exist)

| Capability       | Contract                                                                 |
| ---------------- | ------------------------------------------------------------------------ |
| Identity         | Responder session (same tier as the web console; `authenticate`).        |
| Read assignments | `GET /api/incidents` (role-scoped in SQL).                               |
| Advance status   | `POST /api/incidents/:id/status`.                                        |
| Live position    | `PUT /api/responders/me/position` every ~10–15 s **while en route**; the |
|                  | server enforces assignee-only + not-resolved and rounds to 4 dp          |
|                  | (SECURITY.md §9). Short-interval **polling**, no WebSocket.              |
| Navigate         | `googleMapsDirectionsUrl()` deep-link (`@aira/ui/navigation`).           |
| Medical reveal   | `GET /api/incidents/:id/medical` (grant = active assignment).            |
| Offline / mesh   | Same `MeshTransport` abstraction + `SosOutbox` as the citizen app        |
|                  | (`@aira/ui`): a responder device can **receive/relay** nearby alerts     |
|                  | (Tier 1) even with no backhaul; position streaming is Tier 2 and pauses  |
|                  | when offline or when the assignment resolves.                            |

## Platform considerations (to resolve at build time)

- **Background location while en route.** Streaming position needs a background-location
  permission and a battery-aware cadence; the stream must stop the moment the assignment
  resolves (the server also auto-expires stale fixes, SECURITY.md §9.2).
- **Navigation hand-off is one-way.** Google Maps does not report the responder's
  position back to AIRA; the app samples GPS itself for the `PUT …/position` stream.
- **No new dependencies without review** (AGENTS.md rule 8): adding a maps/location
  package goes through the pinned-workspace + allow-list process.

## Out of scope for this spec

- Real LoRa/Bluetooth radio (separate hardware track, AGENTS.md rule 15).
- Any citizen-facing change (the SOS grid is unchanged).
