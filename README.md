# AIRA: AI Responsive Alert

Resilient, offline-capable emergency reporting platform. Turborepo monorepo.

> **Read [AGENTS.md](./AGENTS.md) before changing anything.** It links the governing docs:
> [PRODUCT.md](./PRODUCT.md) · [DESIGN.md](./DESIGN.md) · [SECURITY.md](./SECURITY.md) ·
> [TESTING.md](./TESTING.md).
>
> **Architectural pivots:**
>
> - **2026-10-21:** all Voice-to-Text (STT) and local LLM/chatbot features have been **REMOVED**
>   (30 MB size cap, low-end Android targets, no reliable offline Cebuano STT). The citizen app is 100%
>   a zero-latency four-button grid: **Fire, Medical, Crime, Flood** (Sunog, Medikal, Krimen, Baha).
> - **2026-10-22:** English is the primary UI language (Bisaya kept as the secondary label, Tagalog/
>   Bisaya locales later); UI uses Lucide/shadcn-style primitives with skeletons, toasts and confirmation
>   dialogs; the queue is cached with a short private TTL; the database is managed with the **Supabase
>   CLI** while **auth stays application-owned** (not Supabase Auth).

## Layout

```
apps/web         Responder console: Next.js 16 (App Router), Tailwind, MapLibre, Lucide
apps/mobile      Citizen app: Expo SDK 58, NativeWind (offline-first). Guide: apps/mobile/README.md
packages/ui      Shared core: categories, mesh payload helpers, i18n, @aira/ui/web primitives
packages/tailwind-config  Shared Tailwind preset (design tokens for BOTH apps)
packages/typescript-config  Shared strict tsconfig bases
packages/db      PostgreSQL via Supabase CLI + SQL migrations (future-proofing, not wired up)
```

## Commands

```bash
pnpm install          # install workspace deps
pnpm dev              # run the web console (Next.js on :3000)
pnpm --filter @aira/mobile start   # Expo/Metro dev server for the citizen app
pnpm --filter @aira/mobile android # Gradle dev build, install to device (= expo run:android)
pnpm check            # typecheck + tests (the gate before "done")
pnpm test             # all tests
pnpm build            # build all apps
pnpm format           # prettier write

# Database (optional; needs Docker; not required for check/build)
pnpm --filter @aira/db db:start    # local Postgres on 127.0.0.1:54322
pnpm --filter @aira/db db:reset    # apply supabase/migrations/*.sql
```

## Running the citizen app (Android)

Full guide: **[apps/mobile/README.md](./apps/mobile/README.md)**. Short version: `pnpm dev` starts
**only** the web console (`apps/mobile` exposes `start`/`android`, not a turbo `dev` task):

```bash
# A) Gradle dev build (default; needed for future native mesh modules)
pnpm --filter @aira/mobile android                 # = expo run:android: prebuild + Gradle + install + Metro
#   or manually: expo prebuild --platform android && cd apps/mobile/android && .\gradlew.bat assembleDebug

# B) Expo Go - requires the SDK 58 client; the store build is still SDK 57
pnpm --filter @aira/mobile start
#   Android: https://github.com/expo/expo-go-releases/releases/download/Expo-Go-58.0.5/Expo-Go-58.0.5.apk
```

> "Project is incompatible with this version of Expo Go" = SDK 58 app + SDK 57 client, **not** an
> outdated app (`expo@58.0.16` is npm-latest). Install the APK above or use the Gradle build.

## Language

English is primary everywhere. The Bisaya word stays visible as the secondary label on the emergency
grid and category badges. All copy goes through `@aira/ui` (`t()`), so shipping `ceb`/`tl` later is a
dictionary change; see [PRODUCT.md](./PRODUCT.md) §3.

## Mesh payload (frozen format)

```
["SUNOG", 10.3157, 123.8854]     // [category, lat, lon]: <=64 bytes, zero PII
```

Built/validated only by `packages/ui` (`buildSosPayload` / `serializeSosPayload` / `parseSosPayload`).
The IDs are the Bisaya words for wire stability; the UI renders English labels.
