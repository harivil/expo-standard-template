#!/usr/bin/env node
// One definition of "nothing lands on main except through a reviewed pull request".
//
// Two callers share it, deliberately:
//
//   .claude/hooks/guard-bash.mjs   a Claude Code session, before the command runs
//   .husky/pre-push                git itself, so Codex, a terminal, and a human are covered too
//
// That mirrors scan-staged.mjs. A rule enforced in one place is a rule with an escape hatch
// nobody wrote down: the Claude hook cannot see a plain `git push`, and the git hook cannot
// explain itself to an agent before it burns a turn. Neither alone is enough, and two copies
// of the logic would eventually disagree about what counts — so there is one copy, here.
//
// This is still client-side and therefore bypassable with --no-verify. GitHub branch
// protection is the enforcement that is not; this is the fast, local, explains-itself layer
// in front of it.
//
// Escape hatch: ALLOW_PUSH_TO_MAIN=1. Seeding a fresh repo and an admin repairing main are
// both real, and a guard with no override is a guard that gets deleted rather than followed.

/** Branches that may only be updated by merging a reviewed pull request. */
export const PROTECTED = new Set(["main", "master"]);

/** Flags that swallow the token after them, so it is never mistaken for a remote or refspec. */
const TAKES_A_VALUE = new Set([
  "-o",
  "--push-option",
  "--repo",
  "--exec",
  "--receive-pack",
]);

/** `refs/heads/main` and `main` name the same branch. Compare them as the same thing. */
const bare = (ref) => ref.replace(/^refs\/heads\//, "");

/**
 * Which protected branches would this `git push` write to?
 *
 * Parses the destination side of each refspec rather than looking for the word "main"
 * anywhere in the command — `git push origin feature/main-menu` and a remote called
 * `maintenance` are both fine, and a guard that fires on them teaches people to work around
 * it instead of with it.
 *
 * @param {string} segment  one command, already split off any && / ; chain
 * @param {() => string|null} currentBranch  resolves HEAD, for an argument-less push
 * @returns {string[]} protected branch names this push targets
 */
export function pushTargets(segment, currentBranch) {
  if (!/^(sudo\s+)?git\s+push\b/.test(segment)) return [];

  const tokens = segment.trim().split(/\s+/);
  const args = tokens.slice(tokens.indexOf("push") + 1);

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      // `--repo=x` carries its value; `--repo x` eats the next token.
      if (TAKES_A_VALUE.has(arg)) i++;
      continue;
    }
    positional.push(arg);
  }

  // `git push` / `git push origin` with no refspec pushes the current branch.
  const refspecs = positional.slice(1);
  if (refspecs.length === 0) {
    const branch = currentBranch();
    return branch && PROTECTED.has(branch) ? [branch] : [];
  }

  // In `src:dst` the destination is what gets written. A bare `main` is both.
  // `:main` deletes the remote branch — still an update to a protected branch.
  return refspecs
    .map((spec) => bare(spec.includes(":") ? spec.slice(spec.lastIndexOf(":") + 1) : spec))
    .filter((dst) => PROTECTED.has(dst));
}

/** The message both callers print, so the advice never drifts between them. */
export function refusal(branches) {
  const named = [...new Set(branches)].join(", ");
  return (
    `This push would update '${named}' directly.\n` +
    `Work reaches ${named} by merging a reviewed pull request — that is what makes CODEOWNERS\n` +
    `review and the CI checks mean anything.\n` +
    `  git push -u origin <your-branch>     # then open a PR\n` +
    `\n` +
    `If you genuinely need this (seeding a new repo, repairing main), say so explicitly:\n` +
    `  ALLOW_PUSH_TO_MAIN=1 git push ...`
  );
}

// ---------------------------------------------------------------- git pre-push entry point
//
// git hands a pre-push hook one line per ref on stdin:
//   <local ref> <local sha> <remote ref> <remote sha>
// A delete arrives with an all-zero local sha and still counts as updating the branch.
if (process.argv[2] === "--pre-push") {
  if (process.env.ALLOW_PUSH_TO_MAIN === "1") process.exit(0);

  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const hit = input
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[2]) // the remote ref
      .filter(Boolean)
      .map(bare)
      .filter((dst) => PROTECTED.has(dst));

    if (hit.length === 0) process.exit(0);
    process.stderr.write("\n" + refusal(hit) + "\n\n");
    process.exit(1);
  });
}
