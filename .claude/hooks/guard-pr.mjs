#!/usr/bin/env node
// PreToolUse hook for Bash. Holds the last gate of the delivery loop: a pull request opens
// for review only once the checks CI will run have been run here and passed.
//
// Exit 0 = allow. Exit 2 = block, with the reason on stderr for the agent to read.
// Any internal error exits 0: a broken guard must never wedge a session.
//
// Two definitions live elsewhere on purpose, both shared with something that would otherwise
// disagree with this hook:
//
//   ../scripts/ci-receipt.mjs      what counts as proven — also read by the open-pr script,
//                                  which calls `gh` from inside node where no hook can see it
//   ../scripts/shell-segments.mjs  where one command ends and the next begins — also used by
//                                  guard-bash, and quote- and heredoc-aware, because a
//                                  document that merely quotes `gh pr create` is not a
//                                  request to open a pull request
//
// A draft pull request is deliberately allowed. Sharing unfinished work is not the failure
// this guards against; asking for review on work that has not been checked is, so
// `gh pr ready` and `gh pr merge` are gated even though `gh pr create --draft` is not.
//
// Escape hatch: CLAUDE_SKIP_CI_PREFLIGHT=1. It exists for the case where the gate itself is
// what is broken. Using it routinely means the gate is wrong — fix the gate.

// Imported defensively: a broken guard must never wedge a session, and that promise has to
// survive either file being missing or unparseable too.
let receipt = null;
try {
  receipt = await import("../scripts/ci-receipt.mjs");
} catch {
  receipt = null;
}

let split = null;
try {
  split = (await import("../scripts/shell-segments.mjs")).segments;
} catch {
  split = (c) =>
    c
      .split(/(?:&&|\|\||[;|\n])/)
      .map((s) => s.trim())
      .filter(Boolean);
}

/** The actions that put a change in front of a reviewer. */
function gatedAction(seg) {
  if (!/^(sudo\s+)?gh\s+pr\b/.test(seg)) return null;
  if (/\bpr\s+create\b/.test(seg))
    return /--draft\b|(\s|^)-d(\s|$)/.test(seg) ? null : "open a pull request";
  if (/\bpr\s+ready\b/.test(seg)) return "mark a pull request ready for review";
  if (/\bpr\s+merge\b/.test(seg)) return "merge a pull request";
  return null;
}

function main(raw) {
  if (process.env.CLAUDE_SKIP_CI_PREFLIGHT) return 0;
  if (!receipt) return 0; // cannot judge — fail open

  let command = "";
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? "";
  } catch {
    return 0;
  }
  if (!command) return 0;

  let action = null;
  for (const seg of split(command)) {
    action = gatedAction(seg);
    if (action) break;
  }
  if (!action) return 0;

  const why = receipt.unproven();
  if (!why) return 0;

  process.stderr.write(
    `Not ready to ${action}.\n` +
      `  ${why}\n` +
      `  Run the gate, fix what it reports, then try again:\n` +
      `    ${receipt.RUN}\n` +
      `  Sharing work in progress instead:  gh pr create --draft\n`,
  );
  return 2;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let code = 0;
  try {
    code = main(input);
  } catch {
    code = 0; // fail open
  }
  process.exit(code);
});
