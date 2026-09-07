#!/usr/bin/env node
// One definition of "build the web app and serve it", shared by the two things that need it:
//
//   shoot-web.mjs             screenshots the first screen, light and dark
//   serve-web-export.mjs      the server playwright.config.ts boots for the web E2E suite
//
// Both use the STATIC EXPORT rather than Metro's dev server, for two measured reasons:
//
//   - **Nothing has to be running.** One command is then genuinely one command, which is what
//     makes a capture something people actually do and a suite something people actually run
//     before pushing.
//   - **It is deterministic and fast.** No HMR socket, no dev overlay, no "Refreshing…"
//     banner, no bundle-on-first-request. The web E2E suite finishes in about 15 seconds
//     against it.
//
// `web.output: "static"` in app.json is what makes this equivalent to serving the app: every
// route is rendered to its own HTML file at export time, so a request for /orders gets a real
// 200 with real markup — which is exactly what the web specs assert. A module that throws
// during rendering fails the export instead, which is a louder signal than a 500.

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/** Where the export goes by default: under .evidence/, which is gitignored. */
export const DEFAULT_DIST = join(".evidence", ".web-export");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Export the web build.
 *
 * Re-exports every time unless `reuse` is set: a cached export is a screenshot — or a test
 * run — against code you are not reviewing, which is the one failure these must not have.
 *
 * @returns {{ok: boolean, why?: string}}
 */
export function exportWeb({ dist = DEFAULT_DIST, reuse = false } = {}) {
  if (reuse && existsSync(dist)) return { ok: true };
  if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });

  const r = spawnSync(
    "npx",
    ["--no-install", "expo", "export", "--platform", "web", "--output-dir", dist],
    {
      stdio: "inherit",
      timeout: 10 * 60 * 1000,
      windowsHide: true,
      // npx resolves through a .cmd shim on Windows that spawn cannot exec directly. This is
      // the documented exception, scoped to the platform that needs it — see check-skills.mjs.
      shell: process.platform === "win32",
    },
  );

  if (r.status !== 0 || !existsSync(dist)) {
    return { ok: false, why: `the web export failed (exit ${r.status ?? "none"})` };
  }
  return { ok: true };
}

/**
 * Serve an export.
 *
 * `expo export` writes /login as login.html, so a request for a route has to try the bare
 * path, the .html beside it, and an index.html inside it before giving up.
 *
 * @returns {Promise<import("node:http").Server>}
 */
export function serveExport({ dist = DEFAULT_DIST, port = 4173 } = {}) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const candidates = [
      join(dist, path),
      join(dist, `${path}.html`),
      join(dist, path, "index.html"),
    ];
    for (const file of candidates) {
      if (existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, {
          "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`not in the export: ${path}`);
  });

  return new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(port, () => ready(server));
  });
}
