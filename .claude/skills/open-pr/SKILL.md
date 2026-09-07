---
name: open-pr
description: Push the current branch and open a GitHub pull request whose body renders screenshots of the app on the surfaces this machine can capture. Use when a change is ready to review, when a PR needs its screenshots embedded rather than described, or when asked to raise a PR for work already pushed.
---

# Open a PR with screenshots in it

A reviewer who has to check out the branch and boot a simulator to see what changed will not do it.
Screenshots in the body are what make a mobile PR reviewable in the two minutes someone actually
has, which is why this is a procedure rather than a suggestion.

One command, from the branch you built on:

```bash
node .claude/skills/open-pr/scripts/open-pr.mjs <slug> --capture --what "one sentence"
```

It does five things in an order that cannot be rearranged:

1. **Preflight** — `gh` present and signed in, you are not standing on the base branch, no
   uncommitted work, and **the review gate has passed against this code**. It refuses rather than
   opening a half-PR.
2. **Capture** the app now, via this repo's own [`capture.mjs`](../../scripts/capture.mjs) — the
   same script [`capture-evidence`](../capture-evidence/SKILL.md) documents, so there is one
   capture mechanism here and not two.
3. **Host the images**, before the PR exists.
4. **Push** the current branch, and only ever that branch.
5. **Open the PR** with the repository's own template as the body, its evidence table already
   filled with rendered images.

Hosting before opening is deliberate. The upload endpoint wants a repository id rather than a pull
request, so the PR is never briefly published with local paths or broken images in its body — no
reviewer ever sees the wrong version of it. An existing PR for the branch is **updated**, not
duplicated.

## No one-time setup

Nothing to install and nothing to log into: the upload uses the token `gh` already holds. Check the
route on a new machine if you like —

```bash
node .claude/skills/open-pr/scripts/upload-attachments.mjs --probe
```

— which uploads a 1×1 pixel and prints the URL it got back. Windows and macOS behave identically;
that is the reason this route was chosen over the alternatives, which
[`references/image-hosting.md`](references/image-hosting.md) sets out in full, including what to do
when it breaks.

## The gate is not optional here

This script calls `gh` from inside node, where [`guard-pr`](../../hooks/guard-pr.mjs) — a Bash
hook — cannot see it. So it asks the same question the hook asks, through the same definition in
[`ci-receipt.mjs`](../../scripts/ci-receipt.mjs): has `npm run verify -- --full` passed **against
the code being reviewed**? A green run from before your last edit does not count, because the
receipt records the working tree as well as the commit.

```bash
npm run verify -- --full      # then open the PR
```

A draft skips the gate, exactly as it does in the hook — sharing unfinished work is not the failure
being guarded against:

```bash
node .claude/skills/open-pr/scripts/open-pr.mjs <slug> --capture --draft
```

## What gets captured, and what cannot be

Surfaces default to **what this OS can actually do**, so nobody has to remember the asymmetry:

| Machine     | Default surfaces  | Why                                                        |
| ----------- | ----------------- | ---------------------------------------------------------- |
| **macOS**   | `ios,android,web` | all three are reachable                                    |
| **Windows** | `web,android`     | there is no iOS simulator for Windows — none, at any price |

Override with `--surfaces` when you mean something narrower. A surface that could not be captured
is written into the body as a **named gap** rather than omitted: an unverified surface that is
written down gets picked up, one that is merely implied ships broken. On Windows, iOS is that gap
on every PR, and the body says who has to cover it.

**Screens behind the login guard are not captured.** An unaided capture reaches `/login` and stops
there, so a change to a screen inside `src/app/(tabs)/` will not appear in the table — the body says
so in as many words, and it is your job to say which screen changed and how you checked it. Getting
past the guard would mean test credentials on every machine that raises a PR, which in a health app
is a security decision and not a convenience one. It is deliberately not done here.

## Options worth knowing

| Flag                | For                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `--capture`         | shoot the app now, as the `after` phase                                                   |
| `--what "..."`      | fills the template's **What changed** paragraph — without it, its prompt is left in place |
| `--images <dir>`    | take files from a folder instead of `.evidence/<slug>/`                                   |
| `--dry-run`         | print the body and touch nothing on the remote — always safe to run                       |
| `--draft`           | open as a draft, ungated                                                                  |
| `--allow-dirty`     | open with uncommitted work in the tree                                                    |
| `--title`, `--base` | override the title (default: last commit subject) and base branch                         |

`--dry-run` is the one to reach for first. It shows the exact body, names every gap, and reports
what the upload route can do from this machine, without pushing anything.

## A before, when it matters

CI does not capture anything here and neither does this script retroactively: a **before** has to be
taken before you start editing, because once the work is done the before is gone.

```bash
node .claude/scripts/capture.mjs before <slug> --surfaces web,android --record
```

For a bug fix, that recording showing the bug happening is what makes the PR reviewable by someone
who never reproduced it. The table has a **Before** column and it stays blank until one exists.

## Where this sits in the loop

Stage 7 of the **`feature-loop`** skill — Ship. Everything before it still applies: the checks in
stage 5, the review in stage 6, and `main` moving only by merging a reviewed PR. This skill does not
merge anything, and it cannot: nothing here touches the default branch.
