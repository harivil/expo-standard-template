#!/usr/bin/env node
// PreToolUse hook for Bash. Blocks a short list of actions that are hard to undo or
// that break the team's agreed flow. Everything else passes through untouched.
//
// Exit 0 = allow. Exit 2 = block, with the reason on stderr for the agent to read.
// Any internal error exits 0: a broken guard must never wedge a session.

import { execSync } from "node:child_process";

// The push-target rule lives in .claude/scripts/ because .husky/pre-push calls the same
// definition — see the header there. Imported defensively: a broken guard must never wedge a
// session, and that promise has to survive the file being missing or unparseable too.
let pushTarget = null;
try {
  pushTarget = await import("../scripts/check-push-target.mjs");
} catch {
  pushTarget = null;
}

// Same arrangement for the protected-path list, and for the same reason: guard-write.mjs
// only ever sees the file_path of an Edit or Write call, so a write performed by the shell
// instead — `sed -i`, a `>` redirect, `tee` — used to bypass it entirely. One definition,
// two guards, no disagreement about what counts.
let protectedPaths = null;
try {
  protectedPaths = await import("../scripts/protected-paths.mjs");
} catch {
  protectedPaths = null;
}

// Match only where a command actually starts — the beginning of the line or just after
// a shell separator. Without this the guard also fires on the string appearing inside a
// quoted argument, an echo, or a comment, which is a false positive that teaches people
// to work around the hook rather than with it.
//
// Quote-aware, because a plain `.split(/[;|]/)` cuts a command in half at a separator that
// the shell would never treat as one. `sed -i 's|a|b|' android/build.gradle` is one command
// with two pipes inside a quoted argument; splitting on them produced four fragments, none
// of which still had a verb next to its filename — so the write guard below saw nothing to
// check. A separator inside quotes is data, not a separator.
function segments(c) {
  const out = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < c.length; i++) {
    const ch = c[i];

    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    // && and || are two characters; ;, | and a newline are one.
    if ((ch === "&" && c[i + 1] === "&") || (ch === "|" && c[i + 1] === "|")) {
      out.push(current);
      current = "";
      i++;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "\n") {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);

  return out.map((s) => s.trim()).filter(Boolean);
}

const BLOCKS = [
  {
    // Expo packages must match the SDK. `npx expo install` picks the compatible version.
    //
    // Every package manager, not just npm: `yarn add expo-camera` desynchronises the SDK in
    // exactly the same way, and a guard that only knows npm quietly stops working the moment
    // someone switches. `npx expo install` is right whichever manager the repo uses.
    test: (segs) =>
      segs.some(
        (s) =>
          /^(sudo\s+)?(npm\s+(i|install|add)|(yarn|pnpm|bun)\s+(add|install))\b/.test(s) &&
          /\s(expo|expo-[a-z0-9-]+|react-native|react-native-[a-z0-9-]+)(@\S+)?(\s|$)/.test(
            s,
          ),
      ),
    why: () =>
      `Install Expo packages with 'npx expo install' so the version matches this project's SDK.\n` +
      `  instead:  npx expo install <package>`,
  },
  {
    // --force overwrites whatever someone else pushed. --force-with-lease refuses to.
    test: (segs) =>
      segs.some(
        (s) =>
          /^(sudo\s+)?git\s+push\b/.test(s) &&
          /(--force(?!-with-lease)|(\s|^)-f(\s|$))/.test(s),
      ),
    why: () =>
      `Use --force-with-lease instead of --force. It refuses the push when someone else has\n` +
      `committed since you last fetched, rather than discarding their work.`,
  },
];

function currentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null; // not a repo yet, or git unavailable — nothing to protect
  }
}

function main(raw) {
  let command = "";
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? "";
  } catch {
    return 0;
  }
  if (!command) return 0;

  const segs = segments(command);

  for (const rule of BLOCKS) {
    if (rule.test(segs)) {
      process.stderr.write(rule.why() + "\n");
      return 2;
    }
  }

  // Writing to a generated or vendored path through the shell. Checked separately from
  // BLOCKS because it needs to parse each command's write targets rather than match a
  // pattern: `sed -i 's/a/b/' src/theme.ts` and `sed -i 's/a/b/' android/build.gradle` are
  // the same command shape and only one of them is a problem.
  if (protectedPaths) {
    for (const seg of segs) {
      for (const target of protectedPaths.shellWriteTargets(seg)) {
        const hit = protectedPaths.violation(target);
        if (hit) {
          process.stderr.write(
            protectedPaths.refusal(target, hit.why, `  the command:  ${seg}`),
          );
          return 2;
        }
      }
    }
  }

  // Pushing straight to main. Checked separately from BLOCKS because it needs to parse the
  // refspec: the branch you are STANDING on says nothing about where a push lands, so
  // `git push origin HEAD:main` from a feature branch is the case the commit guard below
  // cannot see.
  if (pushTarget && process.env.ALLOW_PUSH_TO_MAIN !== "1") {
    const hit = segs.flatMap((s) => pushTarget.pushTargets(s, currentBranch));
    if (hit.length > 0) {
      process.stderr.write(pushTarget.refusal(hit) + "\n");
      return 2;
    }
  }

  // Committing to main. Checked separately because it needs the repo's current branch.
  if (segs.some((s) => /^(sudo\s+)?git\s+commit\b/.test(s))) {
    const branch = currentBranch();
    if (branch === "main" || branch === "master") {
      process.stderr.write(
        `You are on '${branch}'. Work goes on a branch, so it can be reviewed before it lands.\n` +
          `  git switch -c <slug>            # branch here\n` +
          `  git worktree add ../work-<slug> -b <slug>   # or an isolated worktree\n`,
      );
      return 2;
    }
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
