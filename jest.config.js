// Jest for an Expo app. Two things break a fresh setup, both of them here:
//
//   transformIgnorePatterns — Expo packages ship untranspiled, so the transform has to be
//     allowed to reach them or the suite dies on an unexpected `import`.
//   moduleNameMapper order — our own entries sit ABOVE anything broader, or a wider pattern
//     wins and the alias never resolves.

/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    "\.(css|less|scss|sass)$": "<rootDir>/jest.style-mock.js",
    "\.(png|jpg|jpeg|gif|webp|svg|ttf|otf|woff2?)$": "<rootDir>/jest.style-mock.js",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-reanimated|react-native-worklets|standard-navigation|@radix-ui/.*|vaul))",
  ],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    // Route files are thin by design — running the app covers them, not a unit test.
    "!src/app/**",
  ],
  coverageReporters: ["text-summary", "lcov"],
  testPathIgnorePatterns: ["/node_modules/", "/e2e/", "/.maestro/"],
};
