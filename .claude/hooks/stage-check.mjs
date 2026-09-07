#!/usr/bin/env node
// PreToolUse hook for Edit / Write / MultiEdit. WARNS — never blocks — when app code is
// written on a branch that has no spec.
//
// Why a warning and not a block. feature-loop's whole claim is that intent → spec → plan
// commits an artifact the next stage reads, and until now nothing in the repo checked that
// any of it happened: a grep for docs/intent, docs/specs and docs/plans across every hook,
// script, workflow and git hook found exactly one hit, and it was a test fixture. So the
// flow was followed only for as long as an agent chose to cooperate.
//
// A block would be wrong here, though. A one-line hotfix, a dependency bump, a typo in a
// comment and an exploratory spike are all legitimate writes with no spec, and a guard that
// fires on them gets disabled within a week — which is worse than no guard, because the
// team keeps believing it is on. So this one is loud and passable: it names the missing
// artifact and the command that would create it, then lets the write through.
//
// Exit 0 = allow silently. Exit 1 = allow, but show the message (a non-blocking hook error
// is how Claude Code surfaces a warning to the user). Exit 2 would block; deliberately unused.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Only app code needs a spec. Docs, config, tests and the harness itself do not. */
const NEEDS_A_SPEC = /(^|[\/\\])src[\/\\]/;

/** Branch prefixes the team uses, stripped to recover the feature slug. */
const PREFIXES = /^(feat|feature|fix|bugfix|perf|refactor|chore|docs|ci|build|hotfix)\//;

/** Branches that are not a feature at all — guard-bash already refuses commits here. */
const NOT_A_FEATURE = new Set(["main", "master", "HEAD"]);

function currentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null; // not a repo yet, or git unavailable — nothing to check against
  }
}

/**
 * Warn at most once per branch per machine.
 *
 * A hook that repeats itself on every write is noise, and noise is what gets a hook turned
 * off. The marker lives in the OS temp directory rather than the repo so it never shows up
 * in a diff.
 */
function alreadyWarned(slug) {
  try {
    const dir = join(tmpdir(), "claude-stage-check");
    mkdirSync(dir, { recursive: true });
    const marker = join(dir, `${slug.replace(/[^A-Za-z0-9_-]/g, "_")}.marker`);
    if (existsSync(marker)) return true;
    writeFileSync(marker, new Date().toISOString());
    return false;
  } catch {
    return false; // cannot track it — warn rather than go quiet
  }
}

function main(raw) {
  let path = "";
  try {
    const input = JSON.parse(raw);
    path = input?.tool_input?.file_path ?? input?.tool_input?.path ?? "";
  } catch {
    return 0;
  }
  if (!path || !NEEDS_A_SPEC.test(path)) return 0;

  const branch = currentBranch();
  if (!branch || NOT_A_FEATURE.has(branch)) return 0;

  const slug = branch.replace(PREFIXES, "");
  if (!slug) return 0;

  const spec = `docs/specs/${slug}.md`;
  const intent = `docs/intent/${slug}.md`;
  if (existsSync(spec)) return 0;

  if (alreadyWarned(slug)) return 0;

  process.stderr.write(
    `No spec for this branch — writing app code before the artifact that describes it.\n` +
      `  branch:  ${branch}\n` +
      `  looked for:  ${spec}\n` +
      `\n` +
      `feature-loop stages 1-2 come first, and the spec is what verifier and change-reviewer\n` +
      `are later checked against — without it, review has nothing independent to read.\n` +
      `  cp docs/intent/TEMPLATE.md ${intent}\n` +
      `  cp docs/specs/TEMPLATE.md ${spec}\n` +
      `\n` +
      `This is a warning, not a block. The write went through. If this change genuinely needs\n` +
      `no spec — a hotfix, a bump, a typo — carry on and say so in the PR.\n`,
  );
  return 1;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let code = 0;
  try {
    code = main(input);
  } catch {
    code = 0; // fail open, silently
  }
  process.exit(code);
});
