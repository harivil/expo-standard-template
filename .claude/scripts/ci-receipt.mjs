#!/usr/bin/env node
// One definition of "has the gate passed against the code about to be reviewed?", shared by
// the two things that ask it — the same arrangement as protected-paths.mjs, shell-segments.mjs
// and check-push-target.mjs.
//
//   .claude/hooks/guard-pr.mjs               sees a `gh pr create` typed into a Bash tool call
//   .claude/skills/open-pr/scripts/open-pr.mjs   calls `gh pr create` itself, from inside node
//
// The second one is why this file exists. A Claude Code hook only ever sees the command in a
// Bash tool call, so a script that spawns `gh` walks straight past guard-pr — and the script
// that opens pull requests is the last place that should be exempt from the pull-request gate.
// One definition means the hook and the script cannot disagree.
//
// What it reads is the receipt `npm run verify` writes. Four things make a receipt fail, and
// the fourth is the one people actually hit:
//
//   missing        the gate was never run
//   failed         it was run and something failed
//   incomplete     a required check could not run, so it cannot stand in for CI
//   different tree it was run against different code — the commit moved, or the working tree
//                  changed after the run

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the receipt lives. The env override exists so tests can point at a fixture. */
export const receiptPath = () =>
  process.env.CLAUDE_CI_RECEIPT || join(ROOT, ".claude", ".ci-local.json");

/** The command that produces a receipt this module accepts. */
export const RUN = "npm run verify -- --full";

const git = (...args) => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** The same digest ci-local.mjs records: the commit plus the state of the working tree. */
function currentTree() {
  const sha = git("rev-parse", "HEAD");
  if (sha === null) return null; // not a repo — nothing to compare, so nothing to enforce
  return createHash("sha1")
    .update(sha + "\n" + (git("status", "--porcelain") ?? ""))
    .digest("hex");
}

/** The names of the steps a receipt records with a given outcome. */
const stepsWith = (receipt, outcome) =>
  (receipt.steps ?? [])
    .filter((s) => s.outcome === outcome)
    .map((s) => s.name + (s.why ? ` (${s.why})` : ""));

/**
 * Why the receipt does not prove this code is ready for review, or `null` when it does.
 *
 * @param {string} [path] receipt to read; defaults to this repo's
 * @returns {string | null}
 */
export function unproven(path = receiptPath()) {
  if (!existsSync(path)) {
    return "The checks CI runs have not been run here yet.";
  }

  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return "The last run's receipt is unreadable, so nothing here is proven.";
  }

  // Three-value verdict since receipt version 2. An older receipt carries `green` instead,
  // and absent is not false: treat only an explicit `green: false` as a failure.
  const said = receipt.verdict ?? (receipt.green === false ? "failed" : "green");

  if (said === "failed") {
    const which = stepsWith(receipt, "failed").join(", ") || "unknown";
    return "The last run failed: " + which + ". CI fails the same way.";
  }

  if (said === "incomplete") {
    const which =
      (receipt.steps ?? [])
        .filter((s) => s.outcome === "skipped" && s.required)
        .map((s) => s.name + (s.why ? ` (${s.why})` : ""))
        .join(", ") || "unknown";
    return (
      "The last run was incomplete — a required check could not run: " +
      which +
      ". It cannot stand in for CI."
    );
  }

  if (said !== "green") {
    return "The last run's verdict was '" + said + "', which is not green.";
  }

  // Green, but about less than CI checks. .github/workflows/ci.yml runs the web E2E suite on
  // every pull request, and a run without --full skipped it, so this receipt is green about a
  // smaller set of checks than the one about to report on the PR.
  if (receipt.full === false) {
    const skipped = stepsWith(receipt, "skipped").join(", ");
    return (
      "The last run skipped the web E2E suite, which CI runs on every pull request" +
      (skipped ? " (skipped: " + skipped + ")" : "") +
      "."
    );
  }

  const tree = currentTree();
  if (tree && receipt.tree && tree !== receipt.tree) {
    return (
      "The last green run was against different code (" +
      (receipt.sha ?? "unknown").slice(0, 7) +
      (receipt.dirty ? ", dirty tree" : "") +
      "), so it proves nothing about what is about to be reviewed."
    );
  }

  return null; // green, full, and against this code
}
