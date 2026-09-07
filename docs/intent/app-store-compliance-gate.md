# Intent: nothing checks App Store compliance before we submit

Author: 10X Health mobile team · Status: accepted

## Problem

This repo has five static security layers, five testing layers, a version gate, an artifact gate and
a tag-driven release pipeline. **None of them knows anything about App Store or Google Play review.**

So the first thing that tells us a release is non-compliant is Apple or Google rejecting it. That is
the most expensive possible feedback loop: days of review time, a fix, then another full trip. And
the things that get an app rejected are mostly configuration and copy rather than code, which means
every existing check in this repo can be green while the submission is dead on arrival.

Concretely, today, with everything green:

- [`store.config.json`](../../store.config.json) ships `https://example.com/privacy` and
  `https://example.com/support`, and a description whose text is "Fill this in with real copy before
  the first submission — App Store Connect shows it verbatim."
- [`app.json`](../../app.json) has no `ios.infoPlist` purpose strings and no `privacyManifests`.
- There is no `PrivacyInfo.xcprivacy` anywhere, and `expo-tracking-transparency` is not installed.
- The app has WorkOS social authentication and an account model, with no visible in-app
  account-deletion path (§5.1.1) and no Sign in with Apple (§4.8).

Nothing in the repo would stop any of that reaching a submission, and nobody would find out until a
reviewer did.

## Proposed outcome

A change that would be rejected by Apple or Google gets caught **before merge** where it is a
configuration question, and **before submission** where it is a property of the built binary — with
the guideline cited, so the fix is obvious rather than guessed.

Someone asking "is this submission-ready?" gets an answer from a scanner's output rather than from
someone's memory of the guidelines.

## Affected users and systems

App users, indirectly — a rejected release is a release they do not get. Directly: whoever cuts a
release, every pull request that touches app configuration or store metadata, the CI pipeline, and
[`.eas/workflows/release-production.yml`](../../.eas/workflows/release-production.yml).

## Constraints

- **It must not claim to guarantee approval.** A static scan proves a flow exists, not that it works.
  Anything that reports "compliant" as "will be approved" is worse than no gate, because people stop
  checking.
- **It must not replace Maestro or EAS.** Maestro and Playwright own functional E2E; EAS owns
  building and submitting. The new layer owns compliance and nothing else.
- **It must not create an unnecessary iOS build.** The production pipeline already produces an
  `.ipa` and an `.aab`; the binary scan uses those.
- **No second CI platform, no Fastlane, no native iOS code.** This is an Expo CNG project — `/ios`
  and `/android` are generated and gitignored, and `guard-write` blocks hand edits to them.
- **It must work for a team split across Windows and macOS**, per the repo's cross-platform rule, or
  be honest about where it cannot.
- **Findings must never be silently suppressed**, and a rule must never be disabled to make CI pass.
  The same discipline `.semgrep.yml` already has.
- The repo carries pre-existing debt that this gate will surface. Turning a blocking gate on over
  unfixed debt would block every pull request on day one.

## Open questions

- Which of the findings are fixes and which are product decisions? Sign in with Apple and account
  deletion change the auth and data-lifecycle model, and are not ours to decide unilaterally.
- Should the gate block pull requests from the start, or report first and block once the existing
  debt is cleared?
- Is there a runtime tier worth adopting for the three guidelines a static scan structurally cannot
  check? Recorded separately in [`greenlight-runtime-verify`](greenlight-runtime-verify.md).
