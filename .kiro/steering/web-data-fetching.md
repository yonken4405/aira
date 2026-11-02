---
inclusion: fileMatch
fileMatchPattern: 'apps/web/**'
---

# Web data fetching & caching (apps/web)

Scope: the `apps/web` responder/admin/operator console only. Mobile (`apps/mobile`) is
offline-first under a 30 MB budget and is NOT covered by this rule.

## Rule: prefer TanStack Query for client data fetching

When adding or substantially reworking **client-side** data access in `apps/web`, use
**TanStack Query (`@tanstack/react-query`)** as the default fetching + caching layer
whenever it is available in the workspace. This is crucial: ad-hoc `useEffect` + `fetch`

- `useState` loaders (the pattern in older components) should not be the default for new
  work — they re-implement caching, de-duplication, loading/error state, and refetch-on-focus
  that Query already provides correctly.

"Whenever it is available" means: if `@tanstack/react-query` is already a dependency of
`apps/web`, use it. If it is not yet installed, it MAY be added following AGENTS.md rule 10
(verify the version + peer deps on the registry first, pin the version, keep the install
allow-list minimal) — but adding it is a deliberate step, not automatic, and existing
hand-rolled loaders are NOT required to be rewritten just to adopt it.

## Non-negotiable caching policy (unchanged)

TanStack Query is the _mechanism_; it does not change AIRA's caching _policy_. Whatever
fetching layer is used MUST preserve the guarantees already in AGENTS.md rule 14 and
SECURITY.md §5:

- **Memory-only, short-lived, private.** Configure Query with a short `staleTime`/`gcTime`
  (match the existing ~10 s client TTL in `apps/web/src/lib/cache.ts`); never persist the
  cache to `localStorage`/`IndexedDB`/disk. Caches are private per session.
- **In-flight de-duplication.** Query de-dupes concurrent identical requests by query key;
  this replaces `createInFlightTracker` for Query-managed reads. Choose stable, scoped
  query keys (e.g. `['agencies', tenantId]`, `['capability', tenantId]`).
- **HTTP cache headers stay as specified.** Read endpoints keep
  `Cache-Control: private, max-age=5, stale-while-revalidate=25`; mutations stay
  `no-store`. Query's client cache sits on top of — it does not replace — these headers.
- **No coordinates or PII in query keys, cache entries, logs, or devtools output**
  (SECURITY.md §5/§1). Keys carry identifiers/status only.
- **Requests stay same-origin + credentialed**: `credentials: 'same-origin'`,
  `cache: 'no-store'` on the underlying `fetch`, parse-at-boundary before the data enters
  the cache (reuse the existing `platform-client.ts` / `admin-client.ts` parsers).

## UI-state rules still apply

Query's `isPending`/`isError` must drive the existing Operate Mode surfaces
(DESIGN.md §6): layout-shaped `Skeleton` on first load, `useToast()` for async outcomes,
`ConfirmDialog` for irreversible actions, Lucide icons via `@aira/ui/web`, copy via `t()`.
A Tier-2 enrichment surface that fails must still degrade to an honest "unavailable" state
and must never block a Tier-0 action.

## Coexistence with the existing cache primitives

`apps/web/src/lib/cache.ts` (`createTtlCache`, `createInFlightTracker`) remains valid for
non-React / server-side or already-shipped call sites. Do not rip it out. New React client
reads should prefer Query; where both exist, keep their TTL/de-dup behavior consistent so
there is one effective caching policy, not two competing ones.
