# <slug>: <what this does>

Delete any section that genuinely does not apply, and say why in one line. A blank section reads as
skipped; a deleted one reads as decided.

## Artifacts

- Intent: `docs/intent/<slug>.md`
- Spec: `docs/specs/<slug>.md`
- Plan: `docs/plans/<slug>.md`

## What changed

One paragraph. What a user can do now that they could not before.

## Evidence

The **`open-pr`** skill fills this table in for you — it captures the surfaces this machine can
reach, uploads them, and writes the rendered images here:

```bash
node .claude/skills/open-pr/scripts/open-pr.mjs <slug> --capture --what "one sentence"
```

Otherwise drag files from `.evidence/<slug>/` — GitHub hosts them and renders `.mp4` inline.

| Surface | Before | After |
| ------- | ------ | ----- |
| iOS     |        |       |
| Android |        |       |
| Web     |        |       |

Two things no capture here covers, so say them in words: **iOS from a Windows machine** (no
simulator exists — name who covers it), and **any screen behind the login guard**, which an unaided
capture cannot reach.

For a fix, the **before** recording should show the bug happening — and it has to be captured
_before_ the work, because afterwards the before is gone. That clip is what makes this reviewable
by someone who never reproduced it.

**Logic-only change?** Say so here instead, and paste the test output or the numbers that prove it.

## Verified

- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` — green, output read
- [ ] E2E flow for this journey added or extended — `.maestro/` for native, `e2e/web/` for web
- [ ] Flows run, and the surfaces they ran on named below
- [ ] Ran on a real device or simulator, not only in tests
- [ ] Web checked
- [ ] Light **and** dark
- [ ] Every acceptance criterion in the spec observed to hold

**Flows run, and where:** e.g. `smoke-launch.yaml` on Android local + iOS via EAS; `smoke-launch.spec.ts`
on chromium and mobile-web. A flow that has only run on Android is an Android flow — say so.

**Unverified surfaces** — name each one and who will cover it. An iOS gap from a Windows machine is
expected and fine; an unstated one is not.

## Review

- [ ] `change-reviewer` run, findings addressed or accepted with a reason
- [ ] `node .claude/scripts/test-integrity.mjs` — any modified or deleted test explained below

**Tests modified or deleted:** which behaviour changed, and why the old assertion no longer holds. A
test edited to make a fix pass proves nothing about the bug.

## Risk

What could this break, and what is the rollback? Name the riskiest part rather than the easiest.
