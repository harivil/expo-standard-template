---
name: capture-evidence
description: Capture before and after screenshots and screen recordings of this Expo app for a PR. Use before starting a change to record the baseline, after building it to show the result, or when a PR needs visual proof.
---

# Capture evidence

A PR carries evidence, not assertion. For anything visible, that means the reviewer sees the old
behaviour and the new one side by side rather than taking your word that it improved.

## The ordering constraint

**Capture the baseline before you change anything.** By the time the work is done the _before_ no
longer exists, and reconstructing it means stashing, rebuilding, and hoping. This is why baseline
capture opens the build stage rather than closing the verify stage.

```bash
node .claude/scripts/capture.mjs before <slug> --surfaces ios,android,web --record
```

Then, once built:

```bash
node .claude/scripts/capture.mjs after <slug> --surfaces ios,android,web --record
```

Both write to `.evidence/<slug>/` and update `.evidence/<slug>/manifest.json`. That folder is
gitignored — captures attach to the PR, they are not committed. Binaries in git are forever.

## When there is no before

A brand-new screen has no previous state. Capture the **entry point it will appear from** — the tab
bar without the tab, the list without the row, the settings page without the toggle — and say in the
PR that the before is an absence. That still tells a reviewer where to look.

## What a recording has to show

`--record` gives you twelve seconds. Use them on the flow, end to end: enter the screen, do the
thing, see the result. A pan around a static screen proves nothing a screenshot did not.

Record the **same journey** in before and after. A before showing the old error and an after showing
a different screen entirely is two unrelated clips, not a comparison.

Where the change is a fix, the before recording should show **the bug happening**. That clip is the
most valuable artifact in the PR — it is what makes the fix reviewable by someone who never
reproduced it.

## Platform reality

| Surface | Tool                                           | Windows                 | macOS |
| ------- | ---------------------------------------------- | ----------------------- | ----- |
| Android | `adb`                                          | yes                     | yes   |
| iOS     | `xcrun simctl`                                 | **no simulator exists** | yes   |
| Web     | [`shoot-web.mjs`](../../scripts/shoot-web.mjs) | yes                     | yes   |

**Nothing has to be running for web.** `shoot-web.mjs` exports the app, serves the export, and
shoots it **light and dark** — two files, `web-light.png` and `web-dark.png`. It uses the export
rather than a dev server so that one command is genuinely one command, and because a screenshot
must not depend on which port happens to be free or what someone left running: the same
[`web-export.mjs`](../../scripts/web-export.mjs) serves the web E2E suite, so a screenshot and a
test can never disagree about what they were looking at. Readiness is the `login-screen` testID,
never a sleep, so the splash overlay is never what gets photographed. It re-exports on every run,
because a cached export is a screenshot of code you are not reviewing.

The iOS gap on Windows is structural, not a setup problem — there is no iOS simulator for Windows.
`capture.mjs` reports it as `impossible-here` rather than failing, and the honest resolution is one
of:

- **a cloud simulator** — the `eas-simulator` skill drives a hosted iOS simulator and screenshots it,
  which is the only option here that a Windows developer can run themselves without waiting on
  anyone. It is a **paid EAS feature**, so it is a cost decision rather than a default;
- a teammate on a Mac captures it and posts to the PR thread;
- a `macos-latest` CI job captures it;
- or the PR states plainly that iOS is unverified and who will verify it.

Any of those is fine. Silence is not — an unverified surface that is written down gets picked up; one
that is merely implied ships broken.

## Reading the manifest

`manifest.json` records every attempt with a status:

| Status            | Means                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| `captured`        | a real file landed                                                    |
| `unavailable`     | the tool exists but nothing was running — boot the emulator and retry |
| `impossible-here` | this machine cannot do it, ever — hand it to someone who can          |
| `manual`          | capture it yourself; no automation for this one                       |

`unavailable` is usually a forgotten `npm run android`. `impossible-here` never resolves by retrying.

## Into the PR

Fill the evidence table in `.github/PULL_REQUEST_TEMPLATE.md`: before and after per surface, and the
unverified list. Drag the files from `.evidence/<slug>/` into the PR body — GitHub hosts them and
renders `.mp4` inline.

A logic-only change with nothing visible says so explicitly, and shows the test output or the numbers
instead. "No UI change" is a complete answer; leaving the section blank is not.
