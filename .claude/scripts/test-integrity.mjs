#!/usr/bin/env node
// Reports which test files a change touches, and whether each was touched alongside the
// source it covers.
//
//   node .claude/scripts/test-integrity.mjs [base-ref]      (default: main)
//
// Why this exists: a test written before a fix, and left alone during it, is the one signal
// in the loop that cannot be reasoned away — it either passed before the change or it did not.
// That signal is worth exactly nothing if the test was edited to accommodate the fix.
//
// This does not judge. Editing a test is often correct — behaviour genuinely changed, the test
// was wrong, the API moved. It makes the edit *visible* so a reviewer decides deliberately
// instead of scrolling past it. Always exits 0.

import { spawnSync } from "node:child_process";

const base = process.argv[2] || "main";

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

if (git(["rev-parse", "--git-dir"]) === null) {
  console.log("Not a git repository yet — nothing to compare.");
  process.exit(0);
}

// Prefer the merge base so the report covers this branch's work, not everything that
// landed on main since it was cut.
const mergeBase = git(["merge-base", base, "HEAD"]) || base;
const raw = git(["diff", "--name-status", `${mergeBase}...HEAD`]);

if (raw === null) {
  console.log(
    `Could not diff against '${base}' — is the branch pushed and the ref fetched?`,
  );
  process.exit(0);
}
if (!raw) {
  console.log(`No changes against ${base}.`);
  process.exit(0);
}

const changed = raw
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [status, ...paths] = line.split(/\t/);
    return { status: status[0], path: paths[paths.length - 1] };
  });

const isTest = (p) => /(\.|\/)(test|spec)\.[jt]sx?$/.test(p) || /(^|\/)__tests__\//.test(p);
const isMaestro = (p) => /(^|\/)maestro\/.*\.ya?ml$/.test(p);

const tests = changed.filter((c) => isTest(c.path));
const e2e = changed.filter((c) => isMaestro(c.path));
const source = changed.filter((c) => !isTest(c.path) && !isMaestro(c.path));

const LABEL = { A: "added", M: "modified", D: "DELETED", R: "renamed" };

console.log(`Test integrity — ${changed.length} file(s) changed against ${base}\n`);

if (tests.length === 0) {
  console.log("  No test files touched.");
  if (source.some((c) => /\.[jt]sx?$/.test(c.path))) {
    console.log(
      "  Source changed with no test change — expected for a refactor, worth a question",
    );
    console.log("  for a behaviour change or a bug fix.");
  }
} else {
  for (const t of tests) {
    console.log(`  ${(LABEL[t.status] ?? t.status).padEnd(9)} ${t.path}`);
  }

  const modified = tests.filter((t) => t.status === "M");
  const deleted = tests.filter((t) => t.status === "D");

  if (deleted.length) {
    console.log(
      `\n  ${deleted.length} test file(s) DELETED. Review deliberately — a deleted test is`,
    );
    console.log(
      "  a coverage decision, and it should be stated in the PR rather than discovered.",
    );
  }
  if (modified.length) {
    console.log(
      `\n  ${modified.length} existing test(s) modified. For each, the PR should say which`,
    );
    console.log(
      "  behaviour changed and why the old assertion no longer holds. A test edited to make",
    );
    console.log("  a fix pass proves nothing about the bug.");
  }
  if (tests.every((t) => t.status === "A")) {
    console.log("\n  All test changes are additions — nothing existing was weakened.");
  }
}

if (e2e.length) {
  console.log(`\n  E2E flows touched: ${e2e.map((c) => c.path).join(", ")}`);
} else if (source.some((c) => /\/(app|screens|components)\//.test(c.path))) {
  console.log("\n  UI changed with no maestro/ flow added or extended.");
}

process.exit(0);
