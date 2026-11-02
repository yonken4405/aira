/**
 * Structural / privacy guards for the mobile citizen app
 * (mobile-citizen-account spec, task 20.1).
 *
 * This is a VERIFICATION task: tasks 9–18 were implemented to the hard rules in AGENTS.md
 * and the spec's Non-Functional / Security requirements, so these static assertions MUST be
 * GREEN against the shipped code. A failure here is a real violation to fix, never a reason
 * to weaken the guard.
 *
 * It statically scans the shipped mobile *production* source (`apps/mobile/src`, excluding
 * `__tests__` trees — a test's own guard comments and forbidden-name allow-lists are not
 * app surface) for forbidden patterns:
 *
 *   1. R7.12 — no src file imports a device-contacts / microphone / camera / photo-media /
 *      SMS / geolocation permission API.
 *   2. R12.7 — no src file imports or references a voice / chat / AI / STT affordance
 *      (mirrors the AGENTS.md grep guard). Scanned against comment-stripped source so the
 *      legitimate "no voice/chat/AI" guard comments are not false positives.
 *   3. R12.1 / R12.8 — `MedicalProfileScreen.tsx` renders only the owning citizen's own
 *      profile data: it imports no incident API and references no coordinate / lat / lon /
 *      incident / other-party token.
 *   4. R12.3 — no src file references a phone-number / SMS / OTP identity channel for
 *      authentication (identity is email + device key only; `phone-pad` on a medical
 *      contact field is NOT an auth channel and must not trip the guard).
 *
 * Mechanism: `@types/node` is intentionally out of the mobile tsconfig `types`, so (as in
 * `MedicalProfileScreen.test.tsx`'s R7.12 assertion) `require` / `__dirname` are reached off
 * `globalThis`, published by the `test-utils/node-globals.js` setup shim. That shim pins
 * `globalThis.__dirname` to `src/screens/__tests__`; the `src` root is therefore two levels
 * up, and the whole tree is read recursively from there.
 *
 * Requirements: 1.7, 7.12, 12.1, 12.3, 12.7, 12.8.
 */

import { describe, expect, it } from '@jest/globals';

// CommonJS handles, reached through narrow casts off the ambient globals the setup shim
// (`test-utils/node-globals.js`) publishes — jest provides both at runtime under its CJS
// runtime. `@types/node` is deliberately absent from the mobile tsconfig `types`.
const nodeRequire = (globalThis as unknown as { require: (id: string) => unknown }).require;
const nodeDirname = (globalThis as unknown as { __dirname: string }).__dirname;

interface FsModule {
  readonly readFileSync: (p: string, enc: string) => string;
  readonly readdirSync: (p: string, opts: { withFileTypes: true }) => ReadonlyArray<DirentLike>;
}
interface DirentLike {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}
interface PathModule {
  readonly join: (...parts: string[]) => string;
  readonly sep: string;
}

const fs = nodeRequire('node:fs') as FsModule;
const path = nodeRequire('node:path') as PathModule;

// The setup shim pins `__dirname` to `src/screens/__tests__`; `src` is two levels up.
const SRC_ROOT = path.join(nodeDirname, '..', '..');

/** A production source file: absolute path + its UTF-8 text. */
interface SourceFile {
  readonly relPath: string;
  readonly text: string;
}

/**
 * Recursively collect every `.ts` / `.tsx` production source file under `src`, skipping any
 * `__tests__` directory (test files legitimately contain the guard comments and the
 * forbidden-name allow-lists this scan asserts against).
 */
function collectSources(dir: string, relBase = ''): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = relBase === '' ? entry.name : `${relBase}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        continue;
      }
      out.push(...collectSources(abs, rel));
      continue;
    }
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push({ relPath: rel, text: fs.readFileSync(abs, 'utf8') });
    }
  }
  return out;
}

/**
 * Strip `//` line comments and `/* *\/` block comments so keyword scans only see real code.
 * This is what lets the shipped "no voice/chat/AI affordance" guard comments coexist with a
 * strict R12.7 scan. Deliberately simple (no string-literal awareness): the mobile source
 * contains none of the scanned tokens inside string literals, so a conservative strip is
 * exact enough for a structural guard.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (leave `://` URLs intact)
}

/** Every import / re-export / dynamic-require module specifier in a source file. */
function moduleSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g, // import ... from 'x'
    /\bimport\s*['"]([^'"]+)['"]/g, // bare import 'x'
    /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g, // re-export ... from 'x'
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('x')
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('x')
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (m[1] !== undefined) {
        specs.push(m[1]);
      }
    }
  }
  return specs;
}

const SOURCES = collectSources(SRC_ROOT);

describe('mobile structural / privacy guards (task 20.1)', () => {
  it('finds the shipped mobile production source to scan', () => {
    // A sanity check: if the tree ever moves, the guards must not silently pass on nothing.
    expect(SOURCES.length).toBeGreaterThan(0);
    const rels = SOURCES.map((s) => s.relPath);
    expect(rels).toContain('screens/MedicalProfileScreen.tsx');
    expect(rels).toContain('screens/EmergencyGridScreen.tsx');
    expect(rels).toContain('api/citizenClient.ts');
  });

  // ── R7.12 — no device-permission / sensor module is imported anywhere ──────────────────

  const FORBIDDEN_PERMISSION_MODULES = [
    'expo-contacts',
    'expo-camera',
    'expo-av',
    'expo-media-library',
    'expo-image-picker',
    'expo-sms',
    'expo-location',
    'expo-microphone',
    'react-native-contacts',
    'react-native-permissions',
    '@react-native-community/geolocation',
    '@react-native-community/cameraroll',
  ] as const;

  it('no src file imports a contacts/mic/camera/media/SMS/geolocation permission API (R7.12)', () => {
    for (const file of SOURCES) {
      const specs = moduleSpecifiers(file.text);
      for (const forbidden of FORBIDDEN_PERMISSION_MODULES) {
        expect({ file: file.relPath, forbidden, specs }).toEqual({
          file: file.relPath,
          forbidden,
          specs: expect.not.arrayContaining([forbidden]),
        });
      }
    }
  });

  // ── R12.7 — no voice / chat / AI / STT affordance import or reference ───────────────────

  /** Packages that would introduce a voice/chat/AI/STT surface (AGENTS.md rule 1). */
  const FORBIDDEN_AI_MODULES = [
    'expo-speech',
    '@react-native-voice/voice',
    'react-native-voice',
    'react-native-audio-recorder-player',
    'openai',
    'langchain',
    '@aira/llm',
  ] as const;

  /**
   * Code identifiers that would signal a voice/chat/AI/STT affordance. Matched case-insensitively
   * against comment-stripped source only, so the legitimate "no voice/chat/AI" header comments
   * never trip the guard. Mirrors the AGENTS.md grep set (`stt|voice|speech|microphone|chat|
   * openai|llm|whisper|transcribe`) plus `recorder`.
   */
  const FORBIDDEN_AI_PATTERN =
    /\b(?:voice|stt|speech|microphone|recorder|chat|openai|llm|whisper|transcribe|transcription)\b/i;

  it('no src file imports a voice/chat/AI/STT package (R12.7)', () => {
    for (const file of SOURCES) {
      const specs = moduleSpecifiers(file.text);
      for (const forbidden of FORBIDDEN_AI_MODULES) {
        expect({ file: file.relPath, forbidden }).toEqual({
          file: file.relPath,
          forbidden,
        });
        expect(specs).not.toContain(forbidden);
      }
    }
  });

  it('no src file references a voice/chat/AI/STT identifier in code (R12.7)', () => {
    for (const file of SOURCES) {
      const code = stripComments(file.text);
      const match = FORBIDDEN_AI_PATTERN.exec(code);
      // Surface the offending file + token if this ever fires.
      expect({ file: file.relPath, match: match?.[0] ?? null }).toEqual({
        file: file.relPath,
        match: null,
      });
    }
  });

  // ── R12.1 / R12.8 — the medical surface renders only the owner's own profile ────────────

  it('MedicalProfileScreen references no coordinate / incident / other-party data (R12.1/R12.8)', () => {
    const screen = SOURCES.find((s) => s.relPath === 'screens/MedicalProfileScreen.tsx');
    expect(screen).toBeDefined();
    const code = stripComments((screen as SourceFile).text);

    // It imports only the citizen API client's medical calls — never an incident API.
    const specs = moduleSpecifiers((screen as SourceFile).text);
    for (const spec of specs) {
      expect(spec.toLowerCase()).not.toContain('incident');
    }

    // No coordinate / incident / other-party token appears in the code the screen renders.
    // The only data it renders is the owner's own MedicalDraft (get/put/deleteMedical).
    const FORBIDDEN_MEDICAL_PATTERN =
      /\b(?:incident|coordinate|coordinates|latitude|longitude)\b|\blat\b|\blon\b|\blng\b/i;
    const match = FORBIDDEN_MEDICAL_PATTERN.exec(code);
    expect({ match: match?.[0] ?? null }).toEqual({ match: null });
  });

  // ── R12.3 — identity is email + device key only; no phone/SMS/OTP auth channel ──────────

  /**
   * Phone-number / SMS / OTP identity-channel patterns. Deliberately precise: a bare "phone"
   * substring is allowed (a medical emergency-contact field uses `keyboardType="phone-pad"`
   * and a `phone` property — that is contact data, NOT an auth channel). Only auth-shaped
   * phone/SMS/OTP identifiers are forbidden.
   */
  const FORBIDDEN_IDENTITY_PATTERN =
    /\botp\b|\bsms\b|sendsms|smsretriever|phoneauth|phonenumberauth|phone-?number-?auth|verifyphone|otpcode|one-?time-?password/i;

  it('no src file references a phone/SMS/OTP identity channel for auth (R12.3)', () => {
    for (const file of SOURCES) {
      const code = stripComments(file.text);
      const match = FORBIDDEN_IDENTITY_PATTERN.exec(code);
      expect({ file: file.relPath, match: match?.[0] ?? null }).toEqual({
        file: file.relPath,
        match: null,
      });
    }
  });
});
