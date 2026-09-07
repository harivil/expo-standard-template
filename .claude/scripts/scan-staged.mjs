#!/usr/bin/env node
// Scan staged changes for secrets with gitleaks.
//
//   node .claude/scripts/scan-staged.mjs
//
// One definition, two callers: the git `commit-msg`/`pre-commit` hook (which covers every
// human and every agent, including Codex) and .claude/hooks/guard-secrets.mjs (which covers a
// Claude Code Bash tool call). They must never disagree about what counts as a secret, so the
// logic lives here and both import it.
//
// Why at commit time at all: once a secret is committed, deleting the line does not remove it
// — it stays in history, and anyone who cloned the repo already has it. The only real fix is
// rotating the credential, which makes the commit the last cheap moment to catch it.
//
// Exit 0 = clean, or gitleaks not installed. Exit 1 = a finding.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONFIG = ".gitleaks.toml";

function run(args) {
  return spawnSync("gitleaks", args, {
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
  });
}

/**
 * Scan what is staged.
 *
 * `gitleaks protect --staged` was renamed to `gitleaks git --staged` in v8.19. Try the current
 * form first and fall back, so this works across whatever the team has installed.
 *
 * @returns {{installed: boolean, result?: import("node:child_process").SpawnSyncReturns<string>}}
 */
export function scanStaged() {
  const flags = ["--staged", "--redact", "--no-banner", "--config", CONFIG];
  let r = run(["git", ...flags]);
  if (r.error?.code === "ENOENT") return { installed: false };
  const unknown = /unknown command|unknown flag/i.test(
    `${r.stderr ?? ""}${r.stdout ?? ""}`,
  );
  if (unknown) r = run(["protect", ...flags]);
  return { installed: true, result: r };
}

/** The message shown when gitleaks is absent. Not a failure — it is a Go binary, not an npm dep. */
export const NOT_INSTALLED_NOTE =
  "note: gitleaks is not installed, so staged changes were not scanned for secrets.\n" +
  '      brew install gitleaks | winget install gitleaks | docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest git /repo\n';

/** What to tell whoever tripped it. Ordered by what has to happen first. */
export function findingReport(output) {
  return (
    "Secret found in staged changes — commit blocked.\n\n" +
    (output || "").slice(0, 4000) +
    "\n\nCommitting this puts it in history permanently, where deleting the line does not\n" +
    "remove it. In order:\n" +
    "  1. ROTATE the credential — before anything else.\n" +
    "  2. Remove it from the code; read it from the server or expo-secure-store.\n" +
    "  3. Tell whoever owns the credential that it was exposed, and when.\n\n" +
    "A deliberate fixture belongs under .semgrep-tests/ (already allowlisted), or add a\n" +
    "narrow allowlist entry to .gitleaks.toml with a reason.\n"
  );
}

// Run directly (the git hook) rather than imported (the Claude Code hook). Compared as real
// paths rather than as URLs, so a drive letter or a symlinked checkout cannot fool it.
function invokedDirectly() {
  try {
    return (
      !!process.argv[1] &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const { installed, result } = scanStaged();
  if (!installed) {
    process.stderr.write(NOT_INSTALLED_NOTE);
    process.exit(0);
  }
  // gitleaks exits 1 on a finding, 0 when clean, other codes on its own errors — which are
  // not the developer's problem and must not block the commit.
  if (result.status === 1) {
    process.stderr.write(findingReport(result.stdout || result.stderr));
    process.exit(1);
  }
  process.exit(0);
}
