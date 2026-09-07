#!/usr/bin/env node
// PostToolUse hook for Edit / Write / MultiEdit. Formats the one file that just changed,
// so style drift never accumulates into a noisy diff. Scoped to the changed file to stay
// fast — the full lint and test run belongs at verify, not on every keystroke.
//
// Always exits 0. Formatting is a convenience; failing it must never block work.

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname } from "node:path";

const FORMATTABLE = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".yml",
  ".yaml",
]);

function main(raw) {
  let path = "";
  try {
    const input = JSON.parse(raw);
    path = input?.tool_input?.file_path ?? input?.tool_input?.path ?? "";
  } catch {
    return;
  }
  if (!path || !FORMATTABLE.has(extname(path)) || !existsSync(path)) return;

  // Prettier is a devDependency of the project. Before `npm install` has run there is
  // nothing to format with, and that is fine — skip silently rather than warn every edit.
  if (!existsSync("node_modules/prettier")) return;

  try {
    execFileSync("npx", ["--no-install", "prettier", "--write", "--ignore-unknown", path], {
      stdio: "ignore",
      shell: process.platform === "win32", // npx resolves through the shell on Windows
      timeout: 15000,
    });
  } catch {
    // A syntax error mid-edit makes prettier exit non-zero. Expected; leave the file alone.
  }
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    main(input);
  } catch {
    /* never block on formatting */
  }
  process.exit(0);
});
