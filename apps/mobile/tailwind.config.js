/**
 * Tailwind for NativeWind.
 * `nativewind/preset` is REQUIRED by NativeWind's Metro loader; AIRA tokens come
 * from the shared preset (DESIGN.md §3). Keep the NativeWind preset first so our
 * token preset wins on any key collision.
 */
module.exports = {
  presets: [require('nativewind/preset'), require('@aira/tailwind-config')],
  content: ['./App.tsx', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  /*
   * Override the shared preset's `darkMode: ['class', '[data-theme="dark"]']`
   * for mobile only. On native, NativeWind turns that attribute-selector form
   * into `@cssInterop set darkMode attribute data-theme="dark";`, whose prelude
   * (a quoted/`=`-bearing value) is not a valid `<custom-ident>` for
   * react-native-css-interop's CSS parser, which crashes the Metro bundle with
   * `SyntaxError: Unexpected token Ident("set")`. Mobile is dark-only (Operate
   * Mode, StatusBar light, no theme toggle and no `dark:` variants), so the web
   * theme-toggle strategy is irrelevant here. `media` keeps the generated
   * `@cssInterop set darkMode media` at-rule within valid custom-idents. The web
   * app keeps the shared preset's attribute strategy untouched.
   */
  darkMode: 'media',
};
