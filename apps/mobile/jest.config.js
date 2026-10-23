module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '\\.(css)$': '<rootDir>/__mocks__/styleMock.js',
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}'],
  transformIgnorePatterns: [
    // Allow-list of packages whose ESM/Flow/JSX source must be transformed.
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|standard-navigation|react-native-svg|nativewind|react-native-css-interop|@testing-library|test-renderer)',
    // Never transform the reanimated babel plugin or the RN babel preset itself.
    'node_modules/react-native-reanimated/plugin/',
    'node_modules/@react-native/babel-preset/',
  ],
};
