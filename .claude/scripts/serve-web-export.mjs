#!/usr/bin/env node
// Export the web app and serve it until killed. This is what playwright.config.ts boots for
// the web E2E suite.
//
//   node .claude/scripts/serve-web-export.mjs [--port 8081] [--dist <dir>] [--reuse-dist]
//
// Why not `npx expo start --web`, which this replaced: it made local runs depend on a dev
// server booting and bundling inside Playwright's webServer timeout, and — because that server
// lives on Metro's default port with `reuseExistingServer` on — on no *other* dev server
// happening to hold that port. A dev server left running in a second checkout of this project
// was silently reused in place of the app under test, and every spec failed against somebody
// else's app. The static export serves every route as real HTML (`web.output: "static"`),
// which is what the specs assert anyway, and it is deterministic: the suite runs in ~15s.
//
// Prints one line when it is ready. Playwright polls the URL rather than reading stdout, but a
// human running this by hand needs to know it is up.

import { exportWeb, serveExport, DEFAULT_DIST } from "./web-export.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => {
  const i = args.indexOf(n);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};

const port = Number(val("--port", "8081"));
const dist = val("--dist", DEFAULT_DIST);

const exported = exportWeb({ dist, reuse: flag("--reuse-dist") });
if (!exported.ok) {
  console.error(exported.why);
  process.exit(1);
}

const server = await serveExport({ dist, port });
console.log(`serving ${dist} on http://localhost:${port}`);

// Playwright kills this process when the run finishes; close cleanly so the port is free for
// the next run rather than lingering in TIME_WAIT with a half-open handle.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
