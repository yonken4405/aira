import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { EMERGENCY_CATEGORIES, buildSosPayload, serializeSosPayload } from '@aira/ui';

const SRC = join(__dirname, '..');
const APP_ROOT = join(SRC, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Test code is allowed to mention the banned capabilities it asserts about.
      if (entry.name === '__tests__' || entry.name === 'test-utils') {
        return [];
      }
      return sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

function offending(pattern: RegExp): string[] {
  return FILES.filter((file) => pattern.test(file.text)).map((file) => file.path);
}

describe('mobile structural guards', () => {
  it('keeps the four-category frozen mesh payload unchanged (R1.7)', () => {
    expect(EMERGENCY_CATEGORIES.map((category) => category.id)).toEqual([
      'SUNOG',
      'MEDIKAL',
      'KRIMEN',
      'BAHA',
    ]);
    const payload = buildSosPayload('SUNOG', 10.3157, 123.8854);
    expect(payload).toEqual(['SUNOG', 10.3157, 123.8854]);
    expect(serializeSosPayload(payload)).toBe('["SUNOG",10.3157,123.8854]');
  });

  it('renders AppNavigator from App.tsx and never gates the grid behind auth (R1.1/R1.7)', () => {
    const app = readFileSync(join(APP_ROOT, 'App.tsx'), 'utf8');
    expect(app).toContain('AppNavigator');
    expect(app).not.toContain('EmergencyGridScreen');
    expect(FILES.some((file) => file.path === 'navigation/AppNavigator.tsx')).toBe(true);
  });

  it('imports no contacts / microphone / camera / media / SMS / location capability (R7.12)', () => {
    const banned =
      /from\s+['"](expo-contacts|expo-av|expo-audio|expo-camera|expo-image-picker|expo-media-library|expo-sms|expo-location|react-native-contacts)['"]|PermissionsAndroid/;
    expect(offending(banned)).toEqual([]);
  });

  it('introduces no voice / chat / AI / STT affordance (R12.7)', () => {
    const banned =
      /from\s+['"](expo-speech|openai|@ai-sdk\/[^'"]+|langchain|dialogflow)['"]|SpeechRecognition|speechToText/i;
    expect(offending(banned)).toEqual([]);
  });

  it('uses no phone-number / SMS / OTP identity channel (R12.3)', () => {
    const identityFiles = FILES.filter(
      (file) =>
        file.path.startsWith('auth/') ||
        /screens\/(Register|Login|AccountHub)Screen\.tsx$/.test(file.path),
    );
    expect(identityFiles.length).toBeGreaterThan(0);
    for (const file of identityFiles) {
      expect(file.text).not.toMatch(/\botp\b|one-time (code|password)|\bsms\b|sendSms/i);
      expect(file.text).not.toMatch(/phone/i);
    }
  });

  it('keeps account/medical surfaces free of incident coordinates and cross-citizen data (R12.1/R12.8)', () => {
    const accountFiles = FILES.filter((file) =>
      /(AccountHub|MedicalProfile|Register|Login)Screen\.tsx$/.test(file.path),
    );
    expect(accountFiles.length).toBeGreaterThan(0);
    for (const file of accountFiles) {
      expect(file.text).not.toMatch(
        /\blat\b|\blon\b|latitude|longitude|incident|reporterCitizenId/i,
      );
    }
  });

  it('keeps the mobile app off the web component entrypoint (R12.6)', () => {
    expect(offending(/@aira\/ui\/web/)).toEqual([]);
  });
});
