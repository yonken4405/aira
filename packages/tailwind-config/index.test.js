/**
 * Tests for the AIRA shared Tailwind preset.
 *
 * These assert that `theme.extend.colors` is channelized to CSS-variable
 * references of the form `rgb(var(--color-<name>) / <alpha-value>)` (R1.1, R1.2,
 * R1.6) and that the preset registers the `data-theme` dark-mode strategy (R1.5).
 *
 * TDD note: these are expected to FAIL against the current preset, which still
 * holds hex literals under `theme.extend.colors` and has no `darkMode` key.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const preset = require('./index');

/** Expected CSS-variable form for a given `--color-*` token name. */
const token = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

const HEX = /^#[0-9a-fA-F]{3,8}$/;

describe('@aira/tailwind-config preset tokens', () => {
  const colors = preset.theme.extend.colors;

  const flatExpectations = {
    ink: 'ink',
    surface: 'surface',
    raised: 'raised',
    line: 'line',
    fg: 'fg',
    muted: 'muted',
  };

  for (const [key, name] of Object.entries(flatExpectations)) {
    it(`exposes ${key} as the CSS-variable token, not a hex literal`, () => {
      expect(colors[key]).toBe(token(name));
      expect(colors[key]).not.toMatch(HEX);
    });
  }

  const emergency = {
    sunog: 'emergency-sunog',
    medikal: 'emergency-medikal',
    krimen: 'emergency-krimen',
    baha: 'emergency-baha',
  };

  for (const [key, name] of Object.entries(emergency)) {
    it(`exposes emergency.${key} as the CSS-variable token, not a hex literal`, () => {
      expect(colors.emergency[key]).toBe(token(name));
      expect(colors.emergency[key]).not.toMatch(HEX);
    });
  }

  const status = {
    queued: 'status-queued',
    dispatched: 'status-dispatched',
    enroute: 'status-enroute',
    onscene: 'status-onscene',
    resolved: 'status-resolved',
    success: 'status-success',
    error: 'status-error',
    info: 'status-info',
  };

  for (const [key, name] of Object.entries(status)) {
    it(`exposes status.${key} as the CSS-variable token, not a hex literal`, () => {
      expect(colors.status[key]).toBe(token(name));
      expect(colors.status[key]).not.toMatch(HEX);
    });
  }
});

describe('@aira/tailwind-config dark-mode strategy', () => {
  it('registers the data-theme dark-mode strategy', () => {
    expect(preset.darkMode).toEqual(['class', '[data-theme="dark"]']);
  });
});
