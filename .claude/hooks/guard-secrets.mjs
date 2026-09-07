#!/usr/bin/env node
// PreToolUse hook for Bash. Scans staged changes for secrets before a commit is made.
//
// The scanning itself lives in ../scripts/scan-staged.mjs, which the git commit-msg hook also
// runs. One definition, so a Claude Code session and a plain `git commit` can never disagree
// about what counts as a secret.
//
// Exit 0 = allow. Exit 2 = block, reason on stderr. Any internal error exits 0: a scanner that
// is missing or broken must not stop people committing.

import { scanStaged, findingReport, NOT_INSTALLED_NOTE } from "../scripts/scan-staged.mjs";

const segments = (c) =>
  c
    .split(/(?:&&|\|\||[;|\n])/)
    .map((s) => s.trim())
    .filter(Boolean);

function main(raw) {
  let command = "";
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? "";
  } catch {
    return 0;
  }
  if (!command) return 0;

  // Only on an actual commit. Anchored to a command boundary so the word appearing inside a
  // quoted message or an echo does not trigger a scan.
  const committing = segments(command).some((s) => /^(sudo\s+)?git\s+commit\b/.test(s));
  if (!committing) return 0;

  const { installed, result } = scanStaged();

  if (!installed) {
    // Not a failure. gitleaks is a Go binary, not an npm dependency, so it is reasonable for
    // it to be absent locally. CI scans every push regardless.
    process.stderr.write(NOT_INSTALLED_NOTE);
    return 0;
  }

  // gitleaks exits 1 when it finds something, 0 when clean, other codes on its own errors.
  if (result.status === 1) {
    process.stderr.write(findingReport(result.stdout || result.stderr));
    return 2;
  }

  return 0;
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
