#!/usr/bin/env node
// Turn on GitHub branch protection for the default branch.
//
//   node .claude/scripts/protect-main.mjs            # show what would be set
//   node .claude/scripts/protect-main.mjs --apply    # set it
//   node .claude/scripts/protect-main.mjs --apply --team
//
// Why this is a script and not a paragraph in the README. Every guard in this repo is
// client-side: .husky/pre-push and guard-bash both refuse a push to main, and `--no-verify`
// walks past both. Branch protection is the only layer that holds, and it lives in GitHub's
// settings rather than in any file here — so a repo created from this template starts with
// the local guards and none of the real one. A step that is documented but not runnable is a
// step that gets skipped.
//
// Needs the `gh` CLI, authenticated with `repo` scope: https://cli.github.com
//
// NOTE ON PLANS: protected branches on a PRIVATE repository need GitHub Pro, Team or
// Enterprise. On Free, the API returns 403 and this reports it plainly rather than pretending
// it worked. Public repositories get it on every plan.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const TEAM = process.argv.includes("--team");

/** Checks that run on EVERY pull request, and that can genuinely fail. */
const CONTEXTS = [
  "verify", // format, types, lint, tests, expo-doctor, version gate
  "web-e2e", // Playwright
  "commits", // Conventional Commits across the PR range
  "agent-config", // hook and skill regression tests
  "artifacts", // a PR touching src/ cites an intent, spec or plan that exists
  "semgrep", // pattern SAST, including this repo's 11 rules
  "codeql", // semantic SAST
  "secrets", // gitleaks
];
//
// `dependencies` is deliberately NOT required. It runs `npm audit --audit-level=high`, which
// starts failing the moment a transitive advisory is published — on every open PR at once,
// none of them related to the advisory. A required check that blocks unrelated work is how a
// team ends up switching protection off entirely. It still runs, and it still gets read.
//
// `test-integrity` is not required either: it reports which tests a change touched and never
// fails, so requiring it only adds a wait.

function sh(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8", shell: false });
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- which repo
const remote = sh("git", ["remote", "get-url", "origin"]).stdout?.trim();
if (!remote) fail("No 'origin' remote — nothing to protect yet. Push this repo first.");

const match = remote.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/);
if (!match) fail(`Could not read an owner/repo out of the origin remote:\n  ${remote}`);
const [, owner, repo] = match;

const branch =
  sh("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
    .stdout?.trim()
    .replace(/^origin\//, "") || "main";

// ---------------------------------------------------------------- the policy
//
// Solo by default. On a repo with one maintainer, requiring an approving review deadlocks:
// GitHub does not let you approve your own pull request, so every merge becomes an admin
// override — and a bypass button pressed daily stops being a bypass. So the default still
// forces every change through a PR with green checks, and `--team` turns on the review
// requirement the moment a second person can actually give one.
const policy = {
  required_status_checks: { strict: true, contexts: CONTEXTS },
  enforce_admins: false,
  required_pull_request_reviews: {
    required_approving_review_count: TEAM ? 1 : 0,
    require_code_owner_reviews: TEAM,
    dismiss_stale_reviews: true,
  },
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: true,
};

console.log(`\n  repo    ${owner}/${repo}`);
console.log(`  branch  ${branch}`);
console.log(
  `  mode    ${TEAM ? "team — 1 approval, CODEOWNERS enforced" : "solo — PR required, no approval needed"}`,
);
console.log(`\n  Would set:`);
console.log(`    · every change reaches ${branch} through a pull request`);
console.log(`    · these checks must pass: ${CONTEXTS.join(", ")}`);
console.log(`    · the branch must be up to date before merging`);
console.log(`    · no force pushes, no deleting the branch`);
console.log(`    · review conversations resolved before merge`);
if (TEAM) console.log(`    · one approving review, from a CODEOWNERS owner`);

if (!APPLY) {
  console.log(`\n  Nothing changed. Re-run with --apply to set it.`);
  console.log(`  Add --team once a second person can approve a PR.\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- apply
if (sh("gh", ["--version"]).status !== 0) {
  fail("The GitHub CLI is not installed or not on PATH — https://cli.github.com");
}
if (sh("gh", ["auth", "status"]).status !== 0) {
  fail("The GitHub CLI is not authenticated. Run:  gh auth login");
}

const file = join(mkdtempSync(join(tmpdir(), "protect-")), "policy.json");
writeFileSync(file, JSON.stringify(policy));

const res = sh("gh", [
  "api",
  "-X",
  "PUT",
  `repos/${owner}/${repo}/branches/${branch}/protection`,
  "--input",
  file,
]);

if (res.status !== 0) {
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (/upgrade|not available|403/i.test(out)) {
    fail(
      `GitHub refused:\n${out.trim()}\n\n` +
        `Protected branches on a PRIVATE repo need GitHub Pro, Team or Enterprise.\n` +
        `Until then the .husky/pre-push and guard-bash rules are what you have — real, but\n` +
        `bypassable with --no-verify. Making the repo public also unlocks protection.`,
    );
  }
  fail(`GitHub refused:\n${out.trim()}`);
}

console.log(`\n  Applied. '${branch}' now moves only by merging a green pull request.`);
console.log(`  Verify:  gh api repos/${owner}/${repo}/branches/${branch}/protection\n`);
