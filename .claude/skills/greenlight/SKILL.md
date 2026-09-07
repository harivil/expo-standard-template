---
name: greenlight
description: Audit and fix App Store and Google Play compliance for this Expo app with Greenlight — privacy manifests, purpose strings, ATT, Sign in with Apple, account deletion, IAP, placeholder content, secrets, and the built IPA/AAB. Use before a release, when a submission is rejected, when changing permissions, auth, payments or privacy config, or when asked whether the app is submission-ready.
---

# App Store compliance

[Greenlight](https://github.com/RevylAI/greenlight) reads this app — source, `app.json`, privacy
manifests, the Android manifest, and the built `.ipa` / `.aab` — and checks it against Apple's
Review Guidelines and Google Play's Developer Program Policies. Every finding cites the rule it
comes from. Offline, no account, no uploads.

It is a **pre-submission gate, not an approval**. What it buys is that a rejection Apple would have
found is found here instead, before a week of review time is spent on it.

| Layer                                                           | Owns                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Greenlight** — this skill                                     | store compliance, privacy config, rejection risk, IPA/AAB inspection |
| **Maestro / Playwright** — [`write-e2e`](../write-e2e/SKILL.md) | functional E2E: login, navigation, forms, business workflows, errors |
| **EAS** — [`release-app`](../release-app/SKILL.md)              | building and submitting the binaries                                 |

Greenlight replaces neither. It is **not a testing layer** — it never runs the app.

---

## Run it before you claim anything

```bash
npm run compliance        # greenlight preflight .
```

Or the CLI directly, which is what the scanner's own docs use:

```bash
greenlight preflight .
```

**Never assert this app is compliant without running the scanner.** A preflight on a project this
size finishes in milliseconds, so there is no cost to running it again, and no excuse for a claim
based on reading the config instead. The CLI's own output is the evidence — quote it, do not
paraphrase it from memory.

Not installed? It is a Go binary rather than an npm package, so it does not arrive with
`npm install`:

```bash
brew install revylai/tap/greenlight              # macOS
node .claude/scripts/install-greenlight.mjs      # Linux — pinned, checksum-verified
```

**Windows has no upstream binary.** No Windows archive is published at all, so the only local routes
are the Go toolchain (`winget install GoLang.Go`, then `go install`) or WSL2.
[`install-greenlight.mjs`](../../scripts/install-greenlight.mjs) prints both, pinned, and exits
rather than failing obscurely. That is a recorded gap, not a hidden one — CI is the enforcing layer
either way, and `npm run verify` skips this check with a notice rather than reporting a false pass.

## Severity — four levels, and two of them block

| Level        | Meaning                                                         | What to do                      |
| ------------ | --------------------------------------------------------------- | ------------------------------- |
| **CRITICAL** | Rejection or install failure is near-certain                    | **Must fix** — first, always    |
| **HIGH**     | A published deadline, a required declaration, a runtime failure | **Must fix** — this also blocks |
| **WARN**     | Likely to draw reviewer attention or an information request     | **Should fix** where applicable |
| **INFO**     | Best practice                                                   | Review, and say why if you skip |

`--exit-code` trips on **CRITICAL and HIGH**, and on a scanner that crashed mid-scan — so an
incomplete scan never reads as a pass. Do not describe the gate as CRITICAL-only; HIGH covers Sign
in with Apple, Restore Purchases, ATT, account deletion, and Play's target-API and Billing
deadlines, which is most of what actually gets an app rejected.

## The loop

1. `greenlight preflight .` — read the whole output, not just the count.
2. Fix **CRITICAL** first, then **HIGH**, then **WARN** where it applies to this app.
3. Review each **INFO** and either fix it or state why it is not worth acting on.
4. Re-run. Fixes can create findings — adding a tracking SDK creates an ATT requirement.
5. Repeat until **GREENLIT**, or until every remaining finding has a written reason it cannot be
   fixed automatically. Both are acceptable endings. Silence is not.

### What GREENLIT means

Zero CRITICAL and zero HIGH findings in the **static** scan.

### What GREENLIT does not mean

**Apple has not approved anything.** A static scan proves a flow _exists_; it cannot prove it
_works_. A "Delete Account" button wired to nothing contains the string `deleteAccount`, satisfies
§5.1.1, prints GREENLIT, and is rejected the moment a reviewer taps it. Same for a Restore Purchases
handler that swallows its own error, or a Sign in with Apple button behind a flag that is off in
release. Never report GREENLIT as "will be approved", in a PR or anywhere else.

---

## Suppression

**Never suppress silently, and never disable a rule to make CI pass.** A green gate that was made
green by editing the gate protects nothing, and the next person believes it.

```ts
const host = "10.1.2.3"; // greenlight:ignore hardcoded-ipv4 -- staging only, never in a release build
```

Name the rule. A bare `// greenlight:ignore` kills every check on the line. A suppression with no
reason is itself a review finding — the same rule [`security-scan`](../security-scan/SKILL.md)
applies to `// nosemgrep`.

A repo-wide `.greenlight.yml` may carry `ignore:` entries for directories that are deliberately full
of bad patterns — `.semgrep-tests/` holds planted credentials and `http://` URLs on purpose, and
`security.yml` already excludes it from Semgrep for the identical reason. Each entry gets a comment
saying why. What that file must **not** carry is a rule disabled or downgraded to make a real finding
go away.

## Ask before you change these

Four categories are product, legal and compliance decisions rather than lint fixes. Bring the
proposed change and the guideline it comes from; do not implement one unprompted:

- **Authentication** — adding Sign in with Apple (§4.8) changes the sign-in surface and the account
  model, and Apple requires it alongside third-party social login.
- **Payments** — moving digital goods to StoreKit/IAP (§3.1.1) changes revenue, pricing and tax.
  External payment is only permitted for physical goods.
- **Tracking** — adding ATT (§5.1.2) means a consent prompt, and for a health app it means a privacy
  review before the prompt, not after.
- **Account deletion** — an in-app deletion path (§5.1.1) is a data-lifecycle decision with
  retention consequences. Play additionally wants a web deletion route.

This app uses WorkOS for auth and handles health-adjacent data, so §4.8 and §5.1.1 are live
questions here rather than hypothetical ones.

---

## Expo specifics for this app

**Privacy manifest.** Declare it in [`app.json`](../../../app.json) under
`expo.ios.privacyManifests` and let prebuild generate the file; never hand-edit the generated one.
Expo does **not** infer these — the declaration is yours to keep accurate as modules are added.

Then know this, because it is measured rather than assumed: **the source scan does not go green when
you do that.** `greenlight privacy` looks for a `PrivacyInfo.xcprivacy` file on disk, and in a CNG
project that file only exists after `expo prebuild` writes it into the gitignored `/ios`. So
`§5.1.1 No PrivacyInfo.xcprivacy found` and its companion required-reason finding are **permanent
CRITICALs in the PR job** for this repo, and no amount of correct `app.json` config clears them.

That is the single biggest reason the PR job is report-only. Two consequences worth being explicit
about:

- **Do not chase those two findings.** They are a property of scanning source in a prebuild project,
  not a defect in the config. Check `app.json` is right, then move on.
- **The IPA gate is the real verification.** It scans the built binary, where the generated manifest
  actually exists. If the declaration is wrong or missing, that is where it fails — before submission.

If the team ever wants the source scan itself to be clearable, the honest route is to run
`npx expo prebuild --platform ios --no-install` in the compliance job before scanning, so the
generated manifest exists to be read. That costs an `npm ci` and a prebuild in CI and has not been
adopted.

```jsonc
"ios": {
  "privacyManifests": {
    "NSPrivacyAccessedAPITypes": [
      {
        "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
        "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]
      }
    ]
  }
}
```

**Purpose strings** go in `ios.infoPlist`, and a vague one is a WARN in its own right. Say what this
app does with the permission, not that it wants it:

```jsonc
// not "Camera access required"
"NSCameraUsageDescription": "10X Health uses the camera to photograph lab results so they can be attached to your record."
```

| Finding                        | The fix in an Expo project                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Missing privacy manifest       | `expo.ios.privacyManifests` in `app.json`, plus required-reason API codes                         |
| Vague / missing purpose string | `ios.infoPlist` — one sentence naming the feature                                                 |
| Tracking SDK without ATT       | `npx expo install expo-tracking-transparency` **and** `NSUserTrackingUsageDescription`            |
| Social login, no §4.8          | `npx expo install expo-apple-authentication` — **ask first**                                      |
| Account creation, no §5.1.1    | an in-app deletion path, and a web one for Play — **ask first**                                   |
| Missing privacy policy URL     | `privacyPolicyUrl` in [`store.config.json`](../../../store.config.json), and App Store Connect    |
| Placeholder content            | real copy in `store.config.json` — "Lorem ipsum", "TBD", "Coming soon" all trip §2.1              |
| Platform references            | remove "Android", "Google Play", "Windows" from iOS-facing copy (§2.3)                            |
| Hardcoded secret               | server-side, or `expo-secure-store` — **never** `EXPO_PUBLIC_*`, which is inlined into the bundle |
| `http://` URL                  | HTTPS, or an explicit ATS exception with a reason                                                 |
| Debug logging                  | remove, or gate behind `__DEV__`                                                                  |

Package installs go through `npx expo install`, never `npm install` — `guard-bash` blocks the latter
for Expo packages because the SDK governs those versions.

## Where it runs

| Surface                  | Command                                                                    | Blocks?      |
| ------------------------ | -------------------------------------------------------------------------- | ------------ |
| Local                    | `npm run compliance`                                                       | no           |
| `npm run verify`         | optional step, skipped when the binary is absent                           | no           |
| Every PR + weekly        | [`compliance.yml`](../../../.github/workflows/compliance.yml)              | configurable |
| Before TestFlight / Play | [`release-production.yml`](../../../.eas/workflows/release-production.yml) | **yes**      |

**The PR job is report-only today.** It uploads SARIF to the Security tab and prints every finding,
and does not fail the build. This repo has pre-existing placeholder and privacy debt, and a red check
nobody is able to clear is a check everybody learns to scroll past — it takes the real findings with
it. CI never edits source: it reports, and it passes or fails.

**The release gates enforce from the start.** They only run on a deliberate `v*` tag, they scan the
`.ipa` and `.aab` the existing `production` build already produced — no extra build — and they are
the last thing between this app and the stores. They also catch what no source scan can see: the
generated privacy manifest, embedded framework manifests, ATS config, icons inside `Assets.car`, the
200 MB cellular limit, and the _merged_ Android manifest with permissions contributed by library
manifests.

### Making the PR job blocking

**Read the privacy-manifest note above first.** As things stand the source scan reports two CRITICALs
that cannot be cleared from source, so flipping this on today blocks every pull request permanently.
Either adopt the prebuild-in-CI route above, or leave the PR job reporting and let the release gates
do the enforcing — they already do.

When it is genuinely clearable, two lines, deliberately in one commit:

1. `GREENLIGHT_ENFORCE: "true"` in `.github/workflows/compliance.yml`.
2. Add `"compliance"` to the required-checks list in `.claude/scripts/protect-main.mjs`, then
   `node .claude/scripts/protect-main.mjs --apply`.

Do the first without the second and the job goes red without blocking a merge. Do the second without
the first and a required check is registered that can never fail.

---

## Upgrading

The version is pinned in one file, [`.greenlight-version`](../../../.greenlight-version), read by
the installer, the compliance workflow and both release gates. Greenlight is a Go binary, so
Dependabot cannot see it and a human owns the bump by design:

```bash
# 1. edit .greenlight-version
# 2. re-scan and read the difference in findings
greenlight preflight .
# 3. commit the pin together with any fixes the new rules surfaced
```

New findings after an upgrade are a **change in the rules**, usually because Apple or Google
published a deadline. Treat them as real. Do not pin backwards to make them disappear — a compliance
scanner held at an old version is a scanner that agrees with you about a policy that has already
changed.

## Optional: runtime verification (not adopted)

`greenlight verify` closes the gap this skill is honest about — it runs the account-deletion, Restore
Purchases and Sign in with Apple flows on a cloud device and fails when the button is dead. The dry
run is free and offline, and worth doing before deciding anything:

```bash
greenlight verify . --dry-run     # the flows this app claims, and the tests it would run
```

A real run needs the `revyl` CLI and a Revyl account, so it is **documented and deliberately not
adopted** — see [the deferred intent](../../../docs/intent/greenlight-runtime-verify.md). One
constraint matters if it is ever picked up: Revyl runs cloud **simulators**, so it takes a simulator
`.app` or an `.apk` and **rejects a device `.ipa`**. It therefore cannot reuse the production IPA the
release gate scans; the existing `e2e-test` EAS profile already produces the right artifact.

It would sit alongside Maestro, not inside it. Maestro owns login, navigation, forms and business
workflows; `verify` would own the three flows Apple tests by hand. Do not reimplement the Maestro
suite here, and do not delete a Maestro flow because a compliance check happens to touch the same
screen.

## Triage, when the scan comes back long

1. **Is it real?** Read the cited guideline, not just the message. `greenlight guidelines show 5.1.1`
   prints it.
2. **Is it reachable in a release build?** A pattern in a test fixture is noise; the same pattern in a
   screen is not.
3. **Is it a fix or a decision?** Purpose strings, URLs and placeholder copy are fixes. Auth,
   payments, tracking and deletion are decisions — take them to whoever owns the product.
4. **Then fix, or suppress with a named rule and a reason.** Nothing else.
