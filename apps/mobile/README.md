# AIRA citizen app: running it (Expo SDK 58 / RN 0.88, Android)

This app is a **managed Expo (CNG) project**: `android/` and `ios/` are **not** committed
(`.gitignore` ignores both). Native projects are generated on demand by `expo prebuild`.

There are two ways to run it on an Android device:

| Path                                              | Use when                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| **Gradle dev build** (`prebuild` + `gradlew`), §2 | Default workflow; required once native modules arrive (BLE/LoRa mesh) |
| **Expo Go**, §3                                   | Quick UI checks with no Android SDK/Gradle build                      |

---

## 1. Prerequisites (one-time)

- **Keep the repo at a short path** — this repo lives at `C:\aira`. The Android build mirrors
  Reanimated/Worklets codegen sources under
  `android/app/.cxx/Debug/<hash>/<abi>/.../C_/<repo path>/node_modules/react-native-reanimated/...`,
  so a deep checkout pushes that _ninja_ path past Windows' 260-char `MAX_PATH`. At the old
  `C:\Users\<you>\Projects\aira` it was 263; even at `C:\aira` it is **260**, so the ninja swap below is
  also required.
- **Long-path-aware ninja** (one-time, outside the repo). The `ninja.exe` shipped with Android SDK
  CMake 3.22.1 is **1.10.2 and has no `longPathAware` manifest entry**, so `LongPathsEnabled=1` alone
  does not help. Replace it with 1.12.1 (back up the original first):

  ```powershell
  $bin = "$env:LOCALAPPDATA\Android\Sdk\cmake\3.22.1\bin"
  Copy-Item "$bin\ninja.exe" "$env:TEMP\ninja-1.10.2.backup.exe"
  Invoke-WebRequest 'https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-win.zip' -OutFile "$env:TEMP\ninja.zip"
  Expand-Archive "$env:TEMP\ninja.zip" "$env:TEMP\ninja" -Force
  Copy-Item "$env:TEMP\ninja\ninja.exe" "$bin\ninja.exe" -Force
  ```

  (Undo by copying the backup back.) Symptom without it:
  `ninja: error: mkdir(rnreanimated_autolinked_build/...): No such file or directory` on
  `:app:buildCMakeDebug[<abi>]` — see §4.

- Repo deps installed: `pnpm install` (from the repo root).
- **JDK 17** and `JAVA_HOME` set (verified on this machine: `openjdk 17.0.20.1`).
- **Android SDK** with `platforms;android-36` and `build-tools;36.0.0`
  (the SDK 58 / RN 0.88 toolchain targets SDK 36). Default location on Windows:
  `%LOCALAPPDATA%\Android\Sdk`.
- `adb` on `PATH` (comes with `platform-tools`), phone in **Developer mode** with USB debugging on.

`ANDROID_HOME` / `ANDROID_SDK_ROOT` are optional; if Gradle still says
_"SDK location not found"_, create `apps/mobile/android/local.properties` (it is gitignored):

```properties
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

> Mobile scripts are **not** wired into `turbo dev`: `apps/mobile/package.json` exposes
> `start` / `android` / `ios`, **not** `dev`. So root `pnpm dev` starts **only** `apps/web`.
> Always launch mobile with `pnpm --filter @aira/mobile <script>` (or from `apps/mobile`).

---

## 2. Gradle dev build (recommended)

**Fastest all-in-one**: generates `android/`, runs Gradle, installs on the connected device and
starts Metro:

```powershell
pnpm --filter @aira/mobile android    # = expo run:android (script set by prebuild)
```

**Explicit steps** (what `run:android` does, if you prefer to drive Gradle yourself):

```powershell
# 1) generate/refresh the native project (android/ is gitignored, safe to delete+regenerate)
pnpm --filter @aira/mobile exec expo prebuild --platform android --clean

# 2) build the debug APK
cd apps/mobile/android
.\gradlew.bat assembleDebug
#    → app\build\outputs\apk\debug\app-debug.apk

# 3) install it
adb install -r app\build\outputs\apk\debug\app-debug.apk

# 4) Metro (the debug app loads JS from it), run from the repo root
pnpm --filter @aira/mobile start
```

Notes:

- The **debug** APK and `expo run:android` both load JS from Metro on port **8081**. Over USB, make
  the port reachable from the phone once per connection:
  `adb reverse tcp:8081 tcp:8081`. Over Wi-Fi the phone must be on the same LAN as the PC.
- `assembleRelease` is **not** configured for signing; use EAS or add a keystore before you try.
- Since `android/` is regenerated, **never hand-edit it for durable changes**: native config belongs
  in `apps/mobile/app.json` (or a config plugin). Delete `android/` and re-run `prebuild` freely.
- A dev build has no "Expo Go" compatibility constraint; this path always works, including once
  AIRA adds the mesh/Bluetooth native module.
- `prebuild` prints `android: userInterfaceStyle: Install expo-system-ui in your project to enable this
feature`. `app.json` sets `"userInterfaceStyle": "dark"`; without `expo-system-ui` that key is inert on
  Android (the UI still renders dark because the palette is dark by design; only the system nav/status
  chrome won't follow). Install `expo-system-ui` if/when we want that.

---

## 3. Expo Go (no Android SDK build), SDK **58** client required

```powershell
pnpm --filter @aira/mobile start      # QR code; scan it from Expo Go
```

> Note: after the first `expo prebuild`, `package.json` rewrites `android`/`ios` from
> `expo start --android` to **`expo run:android`** / `expo run:ios` (i.e. a Gradle/ Xcode build).
> So `pnpm --filter @aira/mobile android` is a §2 dev build, **not** an Expo Go launch. Use `start`
> for Expo Go.

### Why "Project is incompatible with this version of Expo Go" happens

The project is on **SDK 58** (`expo 58.0.16`, the newest on npm). The **store** build of Expo Go is
still **SDK 57**; Expo's metadata (`https://api.expo.dev/v2/versions/latest`) reports
`"expoGoSdkVersion": "57.0.0"`. So the _app is newer than the client_, and "update the app" cannot
fix it (there is no SDK 59).

**Fix (Android): install the SDK 58 Expo Go APK**

1. Uninstall the Play Store Expo Go first (different build lineage; the install fails otherwise).
2. Install: <https://github.com/expo/expo-go-releases/releases/download/Expo-Go-58.0.5/Expo-Go-58.0.5.apk>
   (Expo Go 58.0.5, SDK 58, published 2026-10-19, allow "install unknown apps").
3. `pnpm --filter @aira/mobile start` and scan the QR.

Check what you actually have before debugging anything else:

```powershell
pnpm --filter @aira/mobile exec expo config --type public   # → sdkVersion: 58.0.0
```

Expo Go shows its own SDK version on its home screen. iOS is out of scope for Expo Go here: Expo only
publishes a **simulator** build for SDK 58, so a physical iPhone needs a dev build (§2 equivalent via
`npx expo run:ios` on macOS or EAS).

---

## 4. Troubleshooting

| Symptom                                                                         | Fix                                                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| "incompatible with this version of Expo Go"                                     | §3: install the SDK 58 APK (store client is SDK 57)                                                                                   |
| `ninja: error: mkdir(...): No such file or directory` on `:app:buildCMakeDebug` | Windows `MAX_PATH`. Repo must be short (`C:\aira`) **and** the SDK `ninja.exe` must be ≥1.11 (longPathAware) — see §1                 |
| App hangs on "Could not connect to development server"                          | `adb reverse tcp:8081 tcp:8081`; confirm Metro is running; same Wi-Fi; allow Node through Windows Firewall                            |
| `SDK location not found` from Gradle                                            | create `android/local.properties` (§1)                                                                                                |
| `Unsupported class file major version` / Gradle JDK error                       | `JAVA_HOME` must point at **JDK 17**                                                                                                  |
| NativeWind classes do nothing                                                   | restart Metro with a clean cache: `pnpm --filter @aira/mobile exec expo start --clear`; keep the `import './global.css'` in `App.tsx` |
| Stale/garbled native build                                                      | `expo prebuild --platform android --clean`, then `.\gradlew.bat clean assembleDebug`                                                  |

## 5. Checks (run before claiming a change is done)

```powershell
pnpm --filter @aira/mobile typecheck
pnpm --filter @aira/mobile test          # jest-expo, src/**/__tests__/*.test.tsx
```

Root `pnpm check` still runs these through turbo; see [TESTING.md](../../TESTING.md).
