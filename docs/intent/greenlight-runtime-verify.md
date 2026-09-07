# Intent: runtime verification of flow-dependent store guidelines

Author: 10X Health mobile team · Status: draft — **deferred, not scheduled**

> Raised while adding Greenlight as the App Store compliance gate
> ([`greenlight`](../../.claude/skills/greenlight/SKILL.md),
> [`app-store-compliance-gate`](app-store-compliance-gate.md)). Written now so the known ceiling of
> that gate is an artifact rather than a memory. Nobody is working on this yet.

## Problem

The compliance gate we just added is **static**. It reads text — source, `app.json`, plists,
manifests, the IPA and the AAB — and matches it against the review guidelines. That is what makes it
free, offline and fast enough to run on every pull request.

It also means there is a class of rejection it cannot see, structurally, no matter how many rules are
added. Three guidelines are satisfied in the scan by the _presence of a string_ and tested by Apple
by _tapping a button_:

- **§5.1.1 account deletion** — a `deleteAccount` symbol in the source suppresses the finding. A
  Delete Account button wired to nothing passes the scan and is rejected on review.
- **§3.1.1 Restore Purchases** — a handler that catches its own error and returns is indistinguishable
  from a working one to a text scanner.
- **§4.8 Sign in with Apple** — a button behind a feature flag that is off in the release build reads
  as implemented.

So `GREENLIT` can be true while the app is still rejectable, and the failure mode is the expensive
one: a full trip through review, then a fix, then another trip. This matters here specifically
because this app has WorkOS social auth and an account model, which puts §4.8 and §5.1.1 in scope
rather than hypothetical.

## Proposed outcome

Someone cutting a release can tell the difference between "the flow exists in the source" and "the
flow works on a device", for the three guidelines Apple tests by hand — and a dead button fails the
release pipeline rather than the review.

Concretely, the shape this probably takes:

- `greenlight verify . --dry-run` adopted first, since it is free and offline and prints the flows
  this app claims plus the tests it would run. That alone tells us whether the tier is worth paying
  for, and it can go into the release checklist immediately.
- If adopted properly: `greenlight verify` against a cloud device in the release pipeline, gating
  submission alongside the IPA and AAB scans that already do.

That is a sketch, not a decision. The spec stage owns the shape.

## Affected users and systems

App users who try to delete their account, restore a purchase, or sign in with Apple. Internally:
whoever cuts a release, [`release-app`](../../.claude/skills/release-app/SKILL.md), the
[`greenlight`](../../.claude/skills/greenlight/SKILL.md) skill, and
[`.eas/workflows/release-production.yml`](../../.eas/workflows/release-production.yml).

## Constraints

- **This is the one Greenlight command that is not offline.** It needs the `revyl` CLI and a Revyl
  account, which makes it a cost and a vendor decision before it is an engineering one. It must be
  flagged as paid the way `eas-simulator` and the deferred `eas-observe` work already are in
  [`capture-evidence`](../../.claude/skills/capture-evidence/SKILL.md) and
  [`release-observability`](release-observability.md) — never assumed as a default.
- **It cannot reuse the artifact the release gate scans.** Revyl runs cloud simulators and emulators,
  so it takes a simulator `.app` or an `.apk` and rejects a device `.ipa`. The existing `e2e-test`
  profile in `eas.json` already produces exactly the right artifacts (`ios.simulator: true`,
  `android.buildType: apk`), so this would hang off that build, not the production one.
- **It runs real flows against a real account.** That means test credentials passed as `--var`, which
  in a health app means a seeded test account that holds no real personal or health data, and
  credentials held as secrets rather than in a workflow file. The `.semgrep.yml` and `.gitleaks.toml`
  rules apply to this like any other code.
- **It must not become a second E2E suite.** Maestro owns login, navigation, forms, business
  workflows and error handling. `verify` would own three flows and only three. The moment it starts
  duplicating `.maestro/`, the separation that makes both worth having is gone —
  [`write-e2e`](../../.claude/skills/write-e2e/SKILL.md) owns that boundary.
- Whatever is adopted has to appear in `release-app`'s existing steps or it will be skipped at
  release time, like anything else that is a fourth thing to remember.

## Open questions

- **Do we want a third vendor in the release path?** EAS builds and submits; Greenlight scans
  statically and offline. Revyl would be the first thing in this pipeline that needs an account and a
  network call to pass a gate. The honest cheaper fallback is a documented manual check: before each
  release, a human taps Delete Account, Restore Purchases and Sign in with Apple on a device and
  records it as release evidence. That costs nothing and removes the silent assumption.
- Does `--dry-run` on its own change any decision? If it shows this app claims flows we did not know
  it claimed, that is useful for free.
- Is a Maestro flow over the same three journeys the better answer, given Maestro is already wired
  into `.eas/workflows/e2e.yml` as a first-class job type and needs no new vendor? It would not carry
  the guideline citations, but it would tap the button.
- Who owns the test account, and what happens when a verify run deletes it?
- Does adding a vendor that drives a real device against a real account need Legal or compliance
  sign-off in a health app?
