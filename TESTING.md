# TESTING.md: Test-Driven Development Mandate

> Binding testing workflow for this repository. **No feature is "complete" without the tests listed
> below passing.** Companion files: [PRODUCT.md](./PRODUCT.md), [DESIGN.md](./DESIGN.md),
> [SECURITY.md](./SECURITY.md), [AGENTS.md](./AGENTS.md).

---

## 1. Workflow: TDD or test-adjacent (mandatory)

**Preferred: TDD (Red → Green → Refactor).** Write the failing test first for every new utility,
route, and component behavior.

**Acceptable fallback: test-adjacent.** Write the test in the same change-set, immediately after the
minimum code that makes it pass: never "tests later", never a PR without tests.

Tests are written **before** a task may be marked done. This applies to AI agents as well: if you wrote
code and no test covers it, the task is not finished.

---

## 2. Required test matrix

| Layer                                | Location                                                                   | Tooling                                                                                     | Requirement                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Unit tests** for utility functions | colocated: `packages/ui/src/**/*.test.ts`, `apps/web/src/lib/**/*.test.ts` | Vitest (node env)                                                                           | ≥ 1 test per exported function; cover happy path **and** boundary/rejection cases.      |
| **Integration tests** for API routes | `apps/web/tests/api-*.test.ts`                                             | Vitest (`@vitest-environment node`), real `Request`/`Response`                              | Every route: success case + ≥ 2 failure cases (bad JSON, invalid/out-of-range payload). |
| **UI component tests**               | `apps/web/tests/*.test.tsx`, `apps/mobile/src/**/__tests__/*.test.tsx`     | Vitest + jsdom + Testing Library (web) / jest-expo + @testing-library/react-native (mobile) | Render assertion **plus** one interaction assertion (press/click → observable effect).  |

Concrete MVP coverage (already implemented, keep green):

- `packages/ui` - `buildSosPayload` / `serializeSosPayload` / `parseSosPayload` (rounding, exact wire
  string `["SUNOG",10.3157,123.8854]`, closed enum, coordinate range rejection, malformed shapes).
- `packages/ui` - category model (English primary label, Bisaya secondary, Lucide icon names) and i18n
  (`t()` default English, parameter interpolation, fallback for untranslated locales).
- `apps/web/src/lib/geo.ts` - haversine distance, distance formatting, ETA estimate.
- `apps/web/src/lib/cache.ts` - TTL expiry/deletion and in-flight de-duplication.
- `apps/web/src/lib/incidents-client.ts`: network-to-cache flow, forced revalidation, concurrency
  de-duplication, rejection of malformed envelopes/non-OK responses.
- `apps/web` API - `GET/POST /api/incidents` acceptance/rejection matrix + private cache headers.
- `apps/web` components: English-labelled queue rows, selection updates the routing panel,
  skeleton-to-data transition, confirmation dialog to success toast, blocking error state with retry, no
  conversational UI.
- `apps/mobile` screen - the four English buttons with Bisaya hints render; pressing **SUNOG** logs
  exactly `["SUNOG",10.3157,123.8854]`; no voice/chat affordance is present.

---

## 3. Commands

```bash
pnpm install        # once
pnpm test           # turbo test → all workspaces (Vitest + jest-expo)
pnpm typecheck      # turbo typecheck → strict tsc in every package
pnpm check          # typecheck + test (the pre-commit gate)
pnpm --filter @aira/web test     # single package
pnpm --filter @aira/mobile test
pnpm --filter @aira/ui test
```

CI/pre-merge gate: `pnpm check` must pass, plus `pnpm build` for `@aira/web`.

---

## 4. Rules

1. **TDD/test-adjacent is mandatory** (§1) - no exceptions, including for AI agents.
2. Tests must be deterministic: no network calls, no real GPS, no real mesh, no timers left running,
   no cross-test shared mutable state (mock/reset in `beforeEach`).
3. Tests must not require a running PostgreSQL, Docker or the Supabase CLI; database/migration tests are
   deferred until `packages/db` is wired up. Config-only checks must not start containers.
4. Public API changes require updating tests in the same change-set (tests are the spec).
5. A failing or skipped test (`it.skip`, `test.todo` used as a "later") blocks completion. Fix or
   delete with justification in the PR description.
6. Keep component tests behavior-focused: assert user-visible text/roles/`testID`s, not internal
   implementation details.
7. **Async renderers:** `@testing-library/react-native` v14 `render`/`fireEvent` and data loading are
   async; always `await` them / use `findBy*`. Client data must be mocked at the module boundary
   (`vi.mock('../src/lib/incidents-client')`), never by hitting the real API.
8. **Loading/notification behavior is tested**, not assumed: every skeleton has a test, every toast path
   (success + failure) has a test, and every confirmation gate asserts both cancel and confirm.

## 5. Explicitly deferred (do not pretend these exist)

- End-to-end browser/device tests (Playwright/Detox), visual regression, load testing, coverage
  percentage gates. They are **planned**, not implemented; do not claim them in status reports.

**Definition of done** = new/changed behavior covered per §2 + `pnpm check` green.
