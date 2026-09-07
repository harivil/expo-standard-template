#!/usr/bin/env node
// git pre-push hook. Refuses to force-push or delete main, for anyone pushing from this clone.
//
// Installed by husky as `.husky/pre-push`, which runs: node .claude/hooks/guard-push.mjs
//
// The other guards in this folder are Claude Code hooks: they bind an agent session in this
// directory and nothing else. A teammate on the command line, or Codex, walks straight past
// them. This one is a git hook, so it binds whoever is pushing regardless of what they used to
// write the commit — which is the whole point, because the person most likely to rewrite main
// by accident is a human in a hurry, not an agent.
//
// The honest limits: `--no-verify` skips it, and it only exists in clones where `npm install`
// has run (husky's `prepare` script is what installs it). Server-side branch protection is the
// only thing with no way around it, and on a private repo that needs a paid GitHub plan. Until
// then this is the strongest available, and it is considerably better than nothing.
//
// git hands a pre-push hook one line per ref on stdin:
//   <local ref> <local sha> <remote ref> <remote sha>
//
// Exit 0 = allow the push. Exit 1 = refuse it.

import { spawnSync } from "node:child_process";

const EMPTY = /^0+$/; // an all-zero sha means "this ref does not exist on that side"
const PROTECTED = /^refs\/heads\/(main|master)$/;

/** Is `ancestor` reachable from `descendant`? False means the push would rewrite history. */
function isAncestor(ancestor, descendant) {
  const r = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    stdio: "ignore",
    windowsHide: true,
  });
  // A non-zero exit can also mean the object is missing locally — a shallow clone, say. Treat
  // only a clean 1 as "not an ancestor"; anything stranger falls through to allowing the push,
  // because a guard that blocks on its own confusion is a guard people uninstall.
  return r.status === 0 || r.status !== 1;
}

function main(input) {
  for (const line of input.split(/\r?\n/)) {
    const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!remoteRef || !PROTECTED.test(remoteRef)) continue;

    const branch = remoteRef.replace("refs/heads/", "");

    if (EMPTY.test(localSha ?? "")) {
      process.stderr.write(
        `\nRefusing to delete ${branch} on the remote.\n` +
          `Nothing in this project's flow needs that.\n\n`,
      );
      return 1;
    }

    // The branch is new on the remote — nothing exists to overwrite.
    if (EMPTY.test(remoteSha ?? "")) continue;

    if (!isAncestor(remoteSha, localSha)) {
      process.stderr.write(
        `\nRefusing to force-push ${branch}.\n\n` +
          `  This push would drop commits that are already on the remote, and break every\n` +
          `  clone that has them. The people it breaks are not the person running it.\n\n` +
          `  Land work by merging a reviewed pull request.\n` +
          `  To undo something already on ${branch}:  git revert <sha>\n\n`,
      );
      return 1;
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
    code = 0; // fail open — a broken guard must never block a legitimate push
  }
  process.exit(code);
});
