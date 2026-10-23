/**
 * Tailwind for NativeWind.
 * `nativewind/preset` is REQUIRED by NativeWind's Metro loader; AIRA tokens come
 * from the shared preset (DESIGN.md §3). Keep the NativeWind preset first so our
 * token preset wins on any key collision.
 */
module.exports = {
  presets: [require('nativewind/preset'), require('@aira/tailwind-config')],
  content: ['./App.tsx', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
