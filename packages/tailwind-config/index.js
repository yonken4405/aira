/**
 * AIRA shared Tailwind preset - the single source of design truth.
 * Consumed by apps/web and apps/mobile via `presets: [require("@aira/tailwind-config")]`.
 * Rules: DESIGN.md (Operate Mode). No gradients, no glow, no decorative radius/shadows.
 *
 * Colors are expressed as CSS-variable references in the
 * `rgb(var(--color-<name>) / <alpha-value>)` form so the same utility class
 * names (`bg-ink`, `text-fg`, `border-line`, `text-status-*`, `emergency-*`)
 * resolve to a theme-aware token while still honoring Tailwind opacity
 * modifiers (e.g. `bg-ink/85`). Concrete channel values per theme live in
 * `apps/web/app/globals.css` under `:root` / `[data-theme='...']` (R1.1, R1.2,
 * R1.6).
 *
 * @type {import("tailwindcss").Config}
 */

/**
 * Build a theme-aware color reference for a `--color-<name>` custom property.
 * The space-separated RGB channels defined in CSS combine with Tailwind's
 * `<alpha-value>` placeholder so opacity utilities keep working.
 *
 * @param {string} name the token suffix, e.g. `ink` or `emergency-sunog`
 * @returns {string} `rgb(var(--color-<name>) / <alpha-value>)`
 */
const withAlpha = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

module.exports = {
  // Register the dark-mode strategy. Tokens resolve through CSS variables
  // cascading from `[data-theme]`, so we do not use the `dark:` variant; the
  // strategy is declared only so Tailwind recognizes the attribute selector.
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Surfaces (high-contrast, WCAG AA against `fg`)
        ink: withAlpha('ink'), // app background
        surface: withAlpha('surface'), // panels, sidebar
        raised: withAlpha('raised'), // cards, elevated rows / SOS cells
        line: withAlpha('line'), // hairline borders & dividers
        fg: withAlpha('fg'), // primary text
        muted: withAlpha('muted'), // secondary text
        // Semantic category colors - emergency alerts only (DESIGN.md §2)
        emergency: {
          sunog: withAlpha('emergency-sunog'), // Fire
          medikal: withAlpha('emergency-medikal'), // Medical
          krimen: withAlpha('emergency-krimen'), // Crime
          baha: withAlpha('emergency-baha'), // Flood
        },
        status: {
          queued: withAlpha('status-queued'),
          dispatched: withAlpha('status-dispatched'),
          enroute: withAlpha('status-enroute'),
          onscene: withAlpha('status-onscene'),
          resolved: withAlpha('status-resolved'),
          // Notification tones (toasts) - semantic, never decorative.
          success: withAlpha('status-success'),
          error: withAlpha('status-error'),
          info: withAlpha('status-info'),
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '3px',
        md: '4px',
      },
      boxShadow: {
        none: 'none',
      },
      transitionDuration: {
        fast: '120ms',
      },
      letterSpacing: {
        label: '0.08em',
      },
    },
  },
  plugins: [],
};
