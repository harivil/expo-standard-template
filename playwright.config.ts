import { defineConfig, devices } from "@playwright/test";

// Web E2E for the react-native-web build. Maestro covers iOS and Android; this covers the
// third surface, and tests what only web can break — deep links, browser back, reload,
// desktop widths.
//
// Setup (once):  npx expo install -- -D @playwright/test && npx playwright install chromium
// Run:           npx playwright test
//
// Note `react-native-web` renders a component's `testID` as `data-testid`, so the same prop
// serves this suite and the Maestro flows. Address elements by it rather than by copy.

const PORT = 8081;

export default defineConfig({
  testDir: "./e2e/web",
  // Fail the build rather than pass quietly when someone leaves a .only behind.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: `http://localhost:${PORT}`,
    // Artifacts only for failures — a trace per passing test fills a disk quickly.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Mobile web is a real surface for this app, not a nice-to-have: the same routes are
    // reachable from a phone browser.
    { name: "mobile-web", use: { ...devices["Pixel 7"] } },
  ],

  // Boot the Expo web server for the run, and reuse an already-running one locally so an
  // interactive session does not fight the test runner for the port.
  webServer: {
    command: "npx expo start --web --port " + PORT,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
