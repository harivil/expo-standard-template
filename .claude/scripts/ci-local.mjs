#!/usr/bin/env node
// Run what CI runs, before pushing. One command on Windows or macOS:
//
//   npm run verify              the checks that need nothing but node
//   npm run verify -- --full    adds the web E2E suite, which boots a dev server
//
// The design rule this script exists to obey: IT NEVER REPORTS GREEN WHEN IT SKIPPED
// SOMETHING. An earlier receipt in this repo claimed `green: true` with all nine steps in
// `skipped`, which is worse than no receipt at all — a false pass someone reasons from. So the
// verdict here has three values, not two: `green` (everything required ran and passed),
// `failed` (something ran and failed), `incomplete` (a required step could not run).
//
// Exit 0 = green. Exit 1 = failed or incomplete.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLAUDE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(CLAUDE_DIR, "..");
const RECEIPT = resolve(CLAUDE_DIR, ".ci-local.json");

const full = process.argv.includes("--full");

// npx resolves through a .cmd shim on Windows that spawn cannot exec directly. This is the
// one place a shell is needed, and it is scoped to that platform — see check-skills.mjs.
const npxShell = process.platform === "win32";

function have(bin) {
  // ENOENT from a shell-less spawn is the only reliable "not installed" signal. A shell reports a
  // missing command as an ordinary non-zero exit, so asking one made this return true for every
  // absent tool and `needs:` never skipped anything on Windows — gitleaks only looked fine because
  // scan-staged.mjs prints its own notice, and the first tool that called a binary directly
  // instead of a script failed the whole run.
  const probe = spawnSync(bin, ["--version"], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
  if (!probe.error) return true;
  if (probe.error.code !== "ENOENT" || process.platform !== "win32") return false;

  // Windows only: a CLI installed by a package manager is often a .cmd shim that a shell has to
  // resolve, and a shell-less spawn cannot see it. Status is useless here — a tool with no
  // --version flag also exits non-zero — so read what the shell said instead.
  const shimmed = spawnSync(bin, ["--version"], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
    shell: process.platform === "win32",
  });
  return (
    !shimmed.error && !/not recognized|not found|cannot find/i.test(shimmed.stderr ?? "")
  );
}

function run(cmd, args) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
    timeout: 20 * 60 * 1000,
    windowsHide: true,
    shell: cmd === "npx" ? npxShell : false,
  });
  return { ok: !r.error && r.status === 0, ms: Date.now() - started };
}

/**
 * Every step CI runs, in the order that fails fastest first.
 *
 * `required` distinguishes a check the team owns from one that needs a tool nobody is obliged
 * to install locally. A missing optional tool is a note; a missing required one makes the
 * whole run `incomplete`, because it means this receipt cannot stand in for CI.
 *
 * `job` names the GitHub Actions job this step stands in for, so a red check on github.com
 * maps to one step here. It is also load-bearing: check-skills.mjs reads these and fails when
 * a workflow declares a job that no step covers and no exemption explains. That is what stops
 * this script's central claim — "it runs what CI runs" — from decaying the next time someone
 * adds a job and not a step.
 */
const STEPS = [
  {
    name: "format",
    job: "verify",
    required: true,
    cmd: "npx",
    args: ["prettier", "--check", "."],
  },
  { name: "types", job: "verify", required: true, cmd: "npx", args: ["tsc", "--noEmit"] },
  { name: "lint", job: "verify", required: true, cmd: "npx", args: ["eslint", "."] },
  {
    name: "test",
    job: "verify",
    required: true,
    cmd: "npx",
    args: ["jest", "--coverage"],
  },
  {
    name: "versions",
    job: "verify",
    required: true,
    cmd: process.execPath,
    args: [resolve(CLAUDE_DIR, "scripts/version-check.mjs")],
  },
  {
    name: "hooks",
    job: "agent-config",
    required: true,
    cmd: process.execPath,
    args: [resolve(CLAUDE_DIR, "hooks/hooks.test.mjs")],
  },
  {
    name: "skills",
    job: "agent-config",
    required: true,
    cmd: process.execPath,
    args: [resolve(CLAUDE_DIR, "check-skills.mjs")],
  },
  {
    // Both halves of every code-quality tool: the config, and the thing that runs it. A
    // config that is present and inert enforces nothing while reading like enforcement.
    name: "toolchain",
    job: "agent-config",
    required: true,
    cmd: process.execPath,
    args: [resolve(CLAUDE_DIR, "scripts/toolchain-check.mjs")],
  },
  { name: "doctor", job: "verify", required: true, cmd: "npx", args: ["expo-doctor"] },
  {
    // Semgrep is Python, the one exception to the npm-only rule. CI runs it regardless.
    name: "semgrep-rules",
    job: "semgrep",
    required: false,
    needs: "semgrep",
    cmd: process.execPath,
    args: [resolve(CLAUDE_DIR, "scripts/semgrep-test.mjs")],
  },
  {
    name: "secrets",
    job: "secrets",
    required: false,
    needs: "gitleaks",
    cmd: process.execPath,
    args: [resolve(CLAUDE_DIR, "scripts/scan-staged.mjs")],
  },
  {
    // App Store / Google Play compliance. greenlight is a Go binary — like gitleaks it may
    // simply be absent locally, and upstream ships no Windows build at all, so this is
    // optional here and .github/workflows/compliance.yml is the enforcing layer.
    name: "compliance",
    job: "compliance",
    required: false,
    needs: "greenlight",
    cmd: "greenlight",
    args: ["preflight", ".", "--exit-code"],
  },
  {
    // Boots a dev server and a browser, so it is opt-in rather than on every run.
    name: "web-e2e",
    job: "web-e2e",
    required: false,
    onlyFull: true,
    cmd: "npx",
    args: ["playwright", "test"],
  },
];

const results = [];

if (!existsSync(resolve(ROOT, "node_modules"))) {
  console.error("node_modules is missing. Run 'npm install' first.\n");
  process.exit(1);
}

for (const step of STEPS) {
  if (step.onlyFull && !full) {
    results.push({ name: step.name, outcome: "skipped", why: "needs --full" });
    console.log(`skip  ${step.name}  (--full to include it)`);
    continue;
  }
  if (step.needs && !have(step.needs)) {
    results.push({
      name: step.name,
      outcome: "skipped",
      why: `${step.needs} not installed`,
    });
    console.log(`skip  ${step.name}  (${step.needs} not installed; CI runs it)`);
    continue;
  }

  console.log(`\n--- ${step.name} ---`);
  const { ok, ms } = run(step.cmd, step.args);
  results.push({
    name: step.name,
    outcome: ok ? "passed" : "failed",
    required: !!step.required,
    ms,
  });
  console.log(`${ok ? "ok" : "FAIL"}    ${step.name}  (${(ms / 1000).toFixed(1)}s)`);
}

// ---------------------------------------------------------------- verdict

const failed = results.filter((r) => r.outcome === "failed");
const skippedRequired = results.filter((r) => r.outcome === "skipped" && r.required);

const verdict = failed.length ? "failed" : skippedRequired.length ? "incomplete" : "green";

const git = (args) => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
};

const sha = git(["rev-parse", "HEAD"]);
const porcelain = git(["status", "--porcelain"]);

// The commit plus the state of the working tree, in one digest. `sha` alone is not enough to
// answer the question guard-pr.mjs asks — "was this run against the code about to be
// reviewed?" — because the commit does not move when someone edits a file after the run, and
// editing a file after the run is the case people actually hit.
const tree =
  sha === null
    ? null
    : createHash("sha1")
        .update(sha + "\n" + (porcelain ?? ""))
        .digest("hex");

writeFileSync(
  RECEIPT,
  JSON.stringify(
    {
      version: 2,
      ran: new Date().toISOString(),
      verdict, // "green" | "failed" | "incomplete" — never a bare boolean
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      sha,
      dirty: !!porcelain,
      tree,
      full,
      steps: results,
    },
    null,
    2,
  ) + "\n",
);

console.log("\n" + "=".repeat(60));
for (const r of results) {
  const mark = r.outcome === "passed" ? "ok  " : r.outcome === "failed" ? "FAIL" : "skip";
  console.log(`  ${mark}  ${r.name}${r.why ? `  — ${r.why}` : ""}`);
}

if (verdict === "green") {
  const optional = results.filter((r) => r.outcome === "skipped").map((r) => r.name);
  console.log(
    `\nGREEN — every required check passed.` +
      (optional.length
        ? `\n  Not run locally (CI covers them): ${optional.join(", ")}`
        : ""),
  );
  process.exit(0);
}

if (verdict === "failed") {
  console.error(
    `\nFAILED — ${failed.map((f) => f.name).join(", ")}. Read the output above.`,
  );
} else {
  console.error(
    `\nINCOMPLETE — could not run: ${skippedRequired.map((s) => s.name).join(", ")}.` +
      `\nThis run does NOT stand in for CI.`,
  );
}
process.exit(1);
