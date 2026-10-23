import preset from '@aira/tailwind-config';
import type { Config } from 'tailwindcss';

/**
 * Web Tailwind config - tokens come exclusively from the shared preset
 * (DESIGN.md §3: no ad-hoc colors in apps).
 */
const config: Config = {
  presets: [preset],
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  plugins: [],
};

export default config;
