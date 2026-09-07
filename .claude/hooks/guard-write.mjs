#!/usr/bin/env node
// PreToolUse hook for Edit / Write / MultiEdit. Blocks writes to paths that are
// generated, vendored, or owned by a tool — where a hand edit is silently lost on
// the next build and costs someone an afternoon to work out why.
//
// The path list lives in .claude/scripts/protected-paths.mjs because guard-bash.mjs calls
// the same definition — see the header there. A Bash `sed -i` and a Write to the same file
// must not disagree about whether it is protected.
//
// Exit 0 = allow. Exit 2 = block. Any internal error exits 0.

// Imported defensively: a broken guard must never wedge a session, and that promise has to
// survive the file being missing or unparseable too.
let paths = null;
try {
  paths = await import("../scripts/protected-paths.mjs");
} catch {
  paths = null;
}

function main(raw) {
  if (!paths) return 0;

  let path = "";
  try {
    const input = JSON.parse(raw);
    path = input?.tool_input?.file_path ?? input?.tool_input?.path ?? "";
  } catch {
    return 0;
  }
  if (!path) return 0;

  const hit = paths.violation(path);
  if (hit) {
    process.stderr.write(paths.refusal(path, hit.why));
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
