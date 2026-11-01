module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // RN module graph cold-start can exceed the 5 s default on CI/Windows.
  testTimeout: 15000,
  moduleNameMapper: {
    '\\.(css)$': '<rootDir>/__mocks__/styleMock.js',
    '^lucide-react-native$': '<rootDir>/__mocks__/lucide-react-native.js',
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}'],
  transformIgnorePatterns: [
    // Allow-list of packages whose ESM/Flow/JSX source must be transformed.
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|expo-.*|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|standard-navigation|react-native-svg|lucide-react-native|nativewind|react-native-css-interop|@testing-library|test-renderer)',
    // Never transform the reanimated babel plugin or the RN babel preset itself.
    'node_modules/react-native-reanimated/plugin/',
    'node_modules/@react-native/babel-preset/',
  ],
};
