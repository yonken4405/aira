module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '\\.(css)$': '<rootDir>/__mocks__/styleMock.js',
    // Synchronous-render shim over RTL-RN 14.1.0 (React 19 renders async by default).
    // The exact dist entry is excluded so the shim can import the real library.
    '^@testing-library/react-native$': '<rootDir>/test-utils/rtl-sync.js',
    // lucide-react-native's `exports` resolve to an ESM `.mjs` under the `react-native`
    // condition, which jest-runtime cannot `require`. Pin the equivalent CJS build so the
    // icons load under the CommonJS test runtime (behaviour-identical; test infra only).
    '^lucide-react-native$':
      '<rootDir>/../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  // The `jest-expo` preset defines its own `setupFiles`; a `setupFiles` key here REPLACES
  // that array, so re-include the preset's setup and append the CommonJS-globals shim that a
  // few static-source assertions rely on (`globalThis.require` / `globalThis.__dirname`).
  setupFiles: [
    require.resolve('jest-expo/src/preset/setup.js'),
    '<rootDir>/test-utils/node-globals.js',
  ],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}'],
  // Property-based tests (fast-check, ≥100 iterations of a real render) can exceed the
  // 5 s default when the suite runs in parallel under `pnpm check`; give every test a
  // generous ceiling so long-running PBTs are not flakily killed mid-run.
  testTimeout: 120_000,
  transformIgnorePatterns: [
    // Allow-list of packages whose ESM/Flow/JSX source must be transformed.
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|standard-navigation|react-native-svg|lucide-react-native|nativewind|react-native-css-interop|@testing-library|test-renderer)',
    // Never transform the reanimated babel plugin or the RN babel preset itself.
    'node_modules/react-native-reanimated/plugin/',
    'node_modules/@react-native/babel-preset/',
  ],
};
