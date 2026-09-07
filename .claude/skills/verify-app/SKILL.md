---
name: verify-app
description: Prove a change works in this Expo app on iOS, Android and web, in light and dark. Use before opening a PR, after any UI or behaviour change, or when asked whether something still works.
---

# Verify

Type checking and unit tests cannot see a blank screen. This is the procedure that turns "it should
work" into evidence someone else can check.

Run it in order — static checks are seconds, the app is minutes, so failing fast costs nothing.

## 1 · Static checks

Read `package.json` and run the scripts that actually exist. Never assume a script name.

```bash
npm run lint
npx tsc --noEmit
npm test
```

When the repo defines an aggregate script (`verify`, `check`, `ci`), run that instead — it is the
single source of truth for what "green" means here, and it is what CI runs.

**Read the output.** A command that exits zero with warnings you did not read has not been verified.

## 2 · The E2E flows for this journey

```bash
maestro test -e APP_ID=<bundle id> .maestro/<flow>.yaml   # iOS, Android
npx playwright test                                        # web
```

Run the flow covering the journey you changed, not the whole suite — full regression runs nightly in
EAS Workflows. The **`write-e2e`** skill covers writing one; run it here.

Say which surfaces each flow actually ran on. From Windows that usually means Android and web, with
iOS covered by CI or a cloud simulator.

## 3 · The app, on every surface the spec claims

```bash
npm run ios
npm run android
npm run web
```

A change is only verified on the surfaces it says it touches — but a change that claims one surface
and silently breaks another is the most common failure in a universal app, so give the other two at
least a launch and a look.

Web is the surface that gets skipped. It is also where `react-native-web` quietly diverges: shadows,
`Platform.select` defaults, gesture handling, and anything measuring layout.

## 4 · Light and dark

Flip the system appearance and look again. A screen that pins a colour instead of reading the theme
looks fine in whichever mode it was built in and unreadable in the other. This costs fifteen seconds
and catches a whole class of review finding.

## 5 · Capture the evidence

```bash
node .claude/scripts/capture.mjs after <slug> --surfaces ios,android,web --record
```

Same surfaces and same journey as the baseline captured at the start of the build — a before and an
after showing different flows are two clips, not a comparison. The **`capture-evidence`** skill owns
the detail: what a recording must show, how to read the manifest, and what to do about a surface this
machine cannot reach.

The Expo MCP server can also screenshot a booted simulator directly, which is handy for a quick look
mid-iteration. The script is what produces the PR's evidence, because it captures every surface in
one pass and records the gaps.

## 6 · Check against the spec, not against your memory

Open `docs/specs/<slug>.md` and walk its acceptance criteria one at a time. For each: did you observe
it, or do you believe it? Only the first counts.

Anything you could not observe — a surface you lack a device for, a state you could not reach — is
named in the PR as unverified. An honest gap is reviewable; a silent one is not.

## Done

Verification is complete when:

- every static check is green and its output was read,
- the app ran on each surface the spec claims, in light and dark,
- a screenshot or an explicit human statement exists for each,
- every acceptance criterion is marked observed or explicitly unverified.

Report what you ran, what you saw, and anything you could not check. A verification that reports only
"all good" is not a verification.
