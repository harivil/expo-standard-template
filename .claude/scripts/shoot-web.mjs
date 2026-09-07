#!/usr/bin/env node
// Screenshot the web build's first screen, light and dark.
//
//   node .claude/scripts/shoot-web.mjs <out-dir> [--route /login] [--dist <dir>] [--reuse-dist]
//
// Called by capture.mjs for the `web` surface, and usable on its own.
//
// The export and the little static server live in web-export.mjs, shared with the server the
// web E2E suite runs against — one definition of "build the web app and serve it", so a
// screenshot and a test can never disagree about what they were looking at.
//
// Readiness is a testID, never a sleep: the app holds a splash overlay briefly after launch,
// and a fixed wait photographs that instead of the app.

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { exportWeb, serveExport, DEFAULT_DIST } from "./web-export.mjs";

const [, , outArg, ...rest] = process.argv;
const flag = (name) => rest.includes(name);
const val = (name, fallback) => {
  const i = rest.indexOf(name);
  return i !== -1 && rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[i + 1] : fallback;
};

const outDir = outArg && !outArg.startsWith("--") ? outArg : "shots";
const dist = val("--dist", DEFAULT_DIST);
const route = val("--route", "/login");
const readyTestId = val("--ready", "login-screen");
const PORT = Number(val("--port", "4173"));

mkdirSync(outDir, { recursive: true });

// Playwright is a dev dependency here; without it there is nothing to drive a browser with.
let chromium = null;
try {
  ({ chromium } = await import("@playwright/test"));
} catch {
  console.error(
    "@playwright/test is not installed — run 'npm install' first, or capture the browser by hand",
  );
  process.exitCode = 1;
}

if (chromium) {
  const exported = exportWeb({ dist, reuse: flag("--reuse-dist") });
  if (!exported.ok) {
    console.error(`${exported.why} — nothing to screenshot`);
    process.exitCode = 1;
    chromium = null;
  }
}

if (chromium) {
  const server = await serveExport({ dist, port: PORT });

  const browser = await chromium.launch();
  const failures = [];

  for (const scheme of ["light", "dark"]) {
    const file = join(outDir, `web-${scheme}.png`);
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: scheme,
      // A capture must never depend on a clock or a locale the machine happens to have.
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    try {
      // `commit` rather than `load`, because the testID below is the readiness signal that
      // actually matters — waiting on `load` first would only add a wait to be wrong about.
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: "commit" });
      await page.getByTestId(readyTestId).waitFor({ state: "visible", timeout: 60000 });
      // One frame past ready, so the splash overlay has finished unmounting.
      await page.waitForTimeout(800);
      await page.screenshot({ path: file });
      console.log(`ok    web-${scheme} → ${resolve(file)}`);
    } catch (error) {
      failures.push(
        `web-${scheme}: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.error(`fail  web-${scheme}: ${error}`);
    } finally {
      await ctx.close();
    }
  }

  await browser.close();
  server.close();

  if (failures.length) {
    console.error(`\n${failures.length} web capture(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log("\nboth web appearances captured");
  }
}
