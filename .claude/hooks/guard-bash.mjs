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
// The splitter itself lives in .claude/scripts/shell-segments.mjs, because guard-pr.mjs reads
// commands the same way and a second implementation is a second set of false positives. Same
// defensive import, same reason.
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
const segments = split;

// Names the protected branch anywhere in a command — as a branch, a refspec, or either side
// of a colon. Deliberately broad: this only ever narrows *which rule* fires, never whether an
// unrelated command is allowed, because every rule using it also requires a git verb.
const PROTECTED_NAME = /(^|[\s:+/])(main|master)($|[\s:^~])/;

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
  {
    // main is append-only. --force-with-lease is the right tool on your own branch and the
    // wrong one here: it still rewrites published history, and the people it breaks are not
    // the person who ran the command. Every spelling is covered, because the interesting ones
    // are the spellings people reach for once the obvious one is blocked.
    test: (segs) =>
      segs.some((s) => {
        if (!/^(sudo\s+)?git\s+push\b/.test(s)) return false;
        if (!PROTECTED_NAME.test(s)) return false;
        return (
          /--force(-with-lease|-if-includes)?\b/.test(s) ||
          /(\s|^)-f(\s|$)/.test(s) ||
          /\s\+\S*(main|master)\b/.test(s) // +main — a force push wearing a refspec
        );
      }),
    why: () =>
      `main is append-only. Rewriting it breaks every clone that already has it.\n` +
      `  Land work by merging a reviewed pull request. To undo something already on main:\n` +
      `    git revert <sha>            # a new commit that undoes it, history intact`,
  },
  {
    // A leading + in a refspec is --force with better camouflage, on any branch.
    test: (segs) =>
      segs.some(
        (s) => /^(sudo\s+)?git\s+push\b/.test(s) && /\s\+[^\s:+][^\s:]*(:|\s|$)/.test(s),
      ),
    why: () =>
      `A '+' in front of a refspec is a force push. If you meant it, say so with\n` +
      `--force-with-lease, which refuses when someone else has pushed since your last fetch.`,
  },
  {
    // Deleting the branch is the most complete rewrite there is.
    test: (segs) =>
      segs.some(
        (s) =>
          /^(sudo\s+)?git\s+push\b/.test(s) &&
          PROTECTED_NAME.test(s) &&
          (/--delete\b|(\s|^)-d(\s|$)/.test(s) ||
            /\s:(refs\/heads\/)?(main|master)\b/.test(s)),
      ),
    why: () => `That deletes main on the remote. Nothing in this repo's flow needs that.`,
  },
  {
    // Moving the local ref is how a rewrite gets staged before it is pushed.
    test: (segs) =>
      segs.some(
        (s) =>
          (/^(sudo\s+)?git\s+branch\b/.test(s) &&
            /(\s|^)(-f|-D|-M|--force|--delete|--move)(\s|$)/.test(s) &&
            PROTECTED_NAME.test(s)) ||
          (/^(sudo\s+)?git\s+update-ref\b/.test(s) &&
            /refs\/heads\/(main|master)\b/.test(s)),
      ),
    why: () =>
      `That moves or deletes the local main ref, which is the first half of rewriting it.\n` +
      `  Work on a branch: git switch -c <slug>`,
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

  // The rules above read the command. These read the repo, because the same command is fine
  // on a feature branch and destructive on main — `git push --force-with-lease` with no
  // refspec pushes whatever you are standing on.
  const onProtected = () => {
    const b = currentBranch();
    return b === "main" || b === "master";
  };

  if (
    segs.some(
      (s) =>
        /^(sudo\s+)?git\s+push\b/.test(s) &&
        /--force(-with-lease|-if-includes)?\b|(\s|^)-f(\s|$)/.test(s),
    ) &&
    onProtected()
  ) {
    process.stderr.write(
      `You are on main, and that force-pushes the branch you are standing on.\n` +
        `  main is append-only — land work through a reviewed pull request, and undo with\n` +
        `  git revert <sha> rather than by rewriting what others have already pulled.\n`,
    );
    return 2;
  }

  if (
    segs.some((s) => /^(sudo\s+)?git\s+reset\b/.test(s) && /--hard\b/.test(s)) &&
    onProtected()
  ) {
    process.stderr.write(
      `A hard reset on main discards commits from the branch everyone else builds on.\n` +
        `  If you need main's exact state:   git switch -c <slug> && git reset --hard origin/main\n` +
        `  If you need to undo a commit:     git revert <sha>\n`,
    );
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
