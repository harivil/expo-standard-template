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

// Deliberately NOT 8081, which is Metro's default. With `reuseExistingServer` on locally,
// sharing that port means a dev server someone left running — in this project or, as happened
// here, in a *different checkout of it* — gets reused in place of this suite's own server, and
// every test then fails against somebody else's app with no hint of why. A dedicated port
// makes the suite independent of whatever else is running on the machine.
const PORT = 8099;

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

  // Serve the STATIC EXPORT for the run, not Metro's dev server, and reuse an already-running
  // server locally so an interactive session does not fight the test runner for the port.
  //
  // `npx expo start --web --port 8081` was here, and it made a local run depend on a dev
  // server booting and bundling inside this timeout — and on nothing else holding that port.
  // Both bit: the suite timed out here, and once it got past that it was silently handed a dev
  // server from a *different checkout of this project* and failed every spec against another
  // app. The export needs nothing running, serves every route as real HTML (`web.output:
  // "static"`) which is what these specs assert anyway, and finishes in about 15 seconds.
  //
  // The timeout covers an export from cold, which is slower than booting a dev server.
  webServer: {
    command: `node .claude/scripts/serve-web-export.mjs --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
  },
});
