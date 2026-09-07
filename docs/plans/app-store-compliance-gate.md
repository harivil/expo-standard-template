# Plan: App Store compliance gate

Spec: [`../specs/app-store-compliance-gate.md`](../specs/app-store-compliance-gate.md) · Branch:
`app-store-compliance-gate`

Tool: [Greenlight](https://github.com/RevylAI/greenlight) v0.2.0 — a Go binary that scans source,
`app.json`, privacy manifests, Android manifests and built IPA/APK/AAB artifacts against Apple's
Review Guidelines and Google Play's policies. Offline, no account.

## Files that change

```
.greenlight-version                            (new)  the single pin: 0.2.0
.claude/scripts/install-greenlight.mjs         (new)  pinned, checksum-verified install
.claude/skills/greenlight/SKILL.md             (new)  the skill, and the documentation
.github/workflows/compliance.yml               (new)  PR + weekly source scan, SARIF, toggle
.eas/workflows/release-production.yml                 IPA and AAB gates before submit
package.json                                          `compliance` script
.claude/scripts/ci-local.mjs                          optional `compliance` step in verify
.claude/scripts/setup.mjs                             greenlight as a reported prerequisite
AGENTS.md                                             new section, skills row, enforced row
README.md                                             one line under "The checks"
.claude/skills/release-app/SKILL.md                   ship stage points at the gate
docs/intent/app-store-compliance-gate.md       (new)  artifact
docs/specs/app-store-compliance-gate.md        (new)  artifact
docs/plans/app-store-compliance-gate.md        (new)  artifact
docs/intent/greenlight-runtime-verify.md       (new)  deferred intent for the Revyl tier
```

Deliberately unchanged: `.claude/settings.json` (no plugin is declared — see Alternatives),
`.semgrep.yml`, `.maestro/`, `e2e/`, `eas.json`, `REVIEW.md`, `.gitignore` (`*.sarif` is already
ignored; the binary caches outside the repo), `.claude/scripts/protect-main.mjs` (the gate is
report-only, so registering a required check would be meaningless).

## Order of work

1. **`.greenlight-version`** — one line, `0.2.0`. Four consumers read it, so an upgrade is a
   one-line diff. Greenlight is a Go binary, so Dependabot cannot see it and a human owns the bump.
2. **`install-greenlight.mjs`** — reads the pin, no-ops when the binary is on PATH, otherwise
   downloads the release archive for this platform, **verifies its SHA-256 against `checksums.txt`
   and refuses on mismatch**, extracts with `tar`, and prints the bin directory on stdout. On
   Windows it reports a named gap with the Go and WSL2 routes and exits, because upstream publishes
   no Windows archive. `--check` reports without installing.
3. **`package.json`** — `"compliance": "greenlight preflight ."`.
4. **`ci-local.mjs`** — one entry in `STEPS`, `required: false` with `needs: "greenlight"`, exactly
   how `semgrep` and `gitleaks` are already handled. Absent binary means a skip with a notice.
5. **`setup.mjs`** — greenlight added to the external-tools report, per-platform command.
6. **`.claude/skills/greenlight/SKILL.md`** — the skill and the developer documentation in one file,
   because in this repo how-to documentation lives in skills and `docs/` holds per-change artifacts.
7. **`.github/workflows/compliance.yml`** — `pull_request`, push to `main`, weekly cron,
   `workflow_dispatch`. Own `permissions` block for SARIF. Two passes — report every severity, then
   decide — the same shape `security.yml`'s semgrep job uses. Gate step guarded by a single
   `GREENLIGHT_ENFORCE` env toggle, set to `"false"`, with the job printing that fact into its own
   summary so a green check cannot be misread.
8. **`.eas/workflows/release-production.yml`** — a custom job per platform between build and submit.
9. **Docs** — AGENTS.md section and table rows, README line, `release-app` pointer, the artifacts.
10. **First real scan** — run it, record the findings, fix what is a fix, bring what needs an asset
    or a product decision back with the scanner's output as evidence. See below.

## First scan — what it actually reported

Run against the pinned v0.2.0 binary. Windows has no upstream build, so it was run through the
`docker-desktop` WSL2 distribution against the same statically linked linux/amd64 archive CI uses —
the version was confirmed as `greenlight 0.2.0` before scanning.

**13 findings: 3 CRITICAL, 1 HIGH, 7 WARN, 2 INFO** → after `.greenlight.yml`: **10 findings, and
the HIGH is gone.**

Three of the original findings were sourced from directories that are deliberately full of bad
patterns or are generated build output, which is what justified adding `.greenlight.yml` — _after_
seeing the output, never before:

| Original finding                                  | Where the evidence came from                    | Verdict                    |
| ------------------------------------------------- | ----------------------------------------------- | -------------------------- |
| HIGH §5.1.1 account creation without deletion     | `coverage/lcov-report/prettify.js:2`, minified  | generated output — ignored |
| WARN §1.6 insecure HTTP, WARN §2.5 hardcoded IPv4 | `.semgrep-tests/rules.ts`                       | planted fixtures — ignored |
| WARN playscan targetSdk / SYSTEM_ALERT_WINDOW     | `android/app/build/intermediates/`, debug build | local-only, absent in CI   |

Two measurements worth recording, because both contradict a reasonable assumption:

- **`ignore:` applies to codescan only.** With `android` and `.semgrep-tests` ignored, the playscan
  and privacy scanners still reported findings from those paths. What keeps them out of CI is that
  `android/` and `coverage/` have zero tracked files, so a clean checkout does not contain them.
- **`ios.privacyManifests` in `app.json` does not clear the privacy CRITICALs.**
  `greenlight privacy` reads a `PrivacyInfo.xcprivacy` file from disk, and in a CNG project that file
  exists only after prebuild writes it into the gitignored `/ios`. The declaration was added anyway
  because it is the correct Expo fix and ITMS-91061 is a real rejection — but the source scan cannot
  go green on it. **That is why the PR job is report-only, and it is not a temporary state**: the IPA
  gate is where those two are genuinely verifiable. Making the source scan clearable would mean
  running `npx expo prebuild --platform ios --no-install` in the compliance job first; not adopted.

### What was fixed

- `expo.ios.privacyManifests` declared in `app.json` — `NSPrivacyAccessedAPICategoryUserDefaults`
  with reason `CA92.1`, Expo's documented baseline and accurate for `expo-updates` /
  `expo-constants`. **This declaration is a baseline, not a certification** — Expo infers nothing, so
  it must be reviewed and extended as modules are added, and the IPA gate is what checks it.

### What was not fixed, and why

| Finding                                          | Why it is not a code change                                         |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| CRITICAL §2.3 no app icon configured             | needs a 1024×1024 asset; the repo has only 256×256 and 512×512 PNGs |
| CRITICAL §5.1.1 privacy manifest ×2              | structurally unclearable from source — see above                    |
| WARN §5.1.1 no privacy policy URL in `app.json`  | needs 10X Health's real URL; inventing one would be worse than none |
| WARN §2.3 `expo.description` empty               | product copy                                                        |
| INFO encryption export-compliance declaration    | `ios.config.usesNonExemptEncryption` is a legal declaration         |
| INFO debug logging in `scripts/reset-project.js` | Expo template script, not app code                                  |

Nothing was suppressed to make any of these disappear, and no rule was disabled or downgraded.

### The one architectural change (step 8)

Today: `build_ios → submit_ios`, `build_android → submit_android`. Submission fires the moment the
build lands. This inserts a compliance job in between and adds it to the submit job's `needs:`, so
submission cannot proceed past a failed scan:

```yaml
compliance_ios:
  needs: [build_ios]
  steps:
    - uses: eas/checkout # preflight scans the project too, not only the binary
    - uses: eas/download_build
      id: ipa
      with:
        build_id: ${{ needs.build_ios.outputs.build_id }}
        extensions: [ipa]
    - run: greenlight preflight . --ipa "${{ steps.ipa.outputs.artifact_path }}" --exit-code

submit_ios:
  needs: [build_ios, compliance_ios] # was: [build_ios]
```

Why here: it reuses the artifact the existing `production` profile already produced, so **no extra
build**; it is the last point before Apple and Google; and it sees what a source scan structurally
cannot — the `PrivacyInfo.xcprivacy` that prebuild generates into the gitignored `/ios`, embedded
framework manifests, ATS configuration, icons inside `Assets.car`, the 200 MB cellular limit, and
the _merged_ Android manifest with permissions contributed by library manifests.

These gates enforce from the start, unlike the pull-request job: they only run on a deliberate `v*`
tag, and submitting with a placeholder privacy URL is the exact failure this work exists to prevent.

## Risks

**The EAS gates cannot be verified from here, and that is the riskiest part of this change.**
`release-production.yml` has never been run against EAS from this repo, and no EAS project is linked
(`app.json` has no `extra.eas.projectId`). Mitigation: `eas workflow:validate`, an installer that
detects platform and architecture at runtime so it works on a Linux or macOS runner either way, and
saying so in the PR instead of implying it is tested. The first tagged release is their first real
verification.

**Windows cannot run the scanner locally.** No upstream binary exists. Half the team is on Windows.
Mitigation: a named gap in `setup.mjs` and the installer, the Go route documented and pinned, and CI
as the enforcing layer — not pretending it works.

**v0.2.0 is an early release** (two releases exist). Pinning plus checksum verification is what
makes it reproducible rather than surprising.

**Pre-existing debt will surface as findings**, and some are product decisions. Report-only first is
what stops that blocking every pull request on day one.

## Alternatives not taken

**Installing the official Claude Code plugin** (`/plugin marketplace add RevylAI/greenlight`).
Rejected: `require-plugins.mjs` blocks every session when an `enabledPlugins` entry is not installed,
so a wrong plugin reference locks out the whole team, and it puts a third-party marketplace in the
trust chain of a health app. A vendored skill is auditable, validated by `check-skills.mjs`, survives
a machine with no plugin state, and covers Codex too. The upstream procedure is carried over; the
repo-specific guardrails are additions the official skill does not contain.

**Adding the job to `security.yml`.** Rejected: compliance is not security, and conflating them
distorts a table that is already load-bearing. This repo splits CI by concern — `ci.yml`,
`security.yml`, `dast.yml` — so a fourth file follows the existing precedent.

**Scanning the IPA from GitHub Actions on the tag.** Rejected: it would have to poll EAS for the
build, needs `EXPO_TOKEN`, races the build finishing, and cannot actually stop `submit_ios` because
that job lives in the EAS pipeline. The gate belongs where the submission is.

**A wrapper script behind `npm run compliance`.** Rejected: the spec asked for `greenlight preflight .`
and the repo already has the machinery for an absent external tool — `needs:` in `ci-local.mjs` and
the report in `setup.mjs`. A wrapper would be a fourth place that knows about the binary.

**Fastlane, Detox, a `custom` GitHub runner, or native iOS code.** None are needed and all were
explicitly excluded.

## Proof

- `node .claude/check-skills.mjs` — the new skill's frontmatter, every link, and the portability
  sweep over the new scripts and workflow.
- `node .claude/hooks/hooks.test.mjs` and `npm run verify` — green, with `compliance` shown as
  skipped on Windows rather than silently passing.
- `node .claude/scripts/install-greenlight.mjs --check` prints `missing (pinned: 0.2.0)` here;
  the CI log's `greenlight version` step must print `0.2.0`.
- Checksum enforcement demonstrated by corrupting the expected hash and confirming a refusal.
- `node .claude/scripts/setup.mjs` lists greenlight as missing with the Go route.
- The real scan, already run and recorded above — 3 CRITICAL, 1 HIGH, 7 WARN, 2 INFO before
  `.greenlight.yml`; 3 CRITICAL, 0 HIGH, 5 WARN, 2 INFO after. The first CI run should reproduce the
  post-config numbers minus the two `android/` playscan findings, which a clean checkout does not
  contain — that difference is itself a check on this reasoning.
- Download and checksum verification were exercised directly: the archive's SHA-256 matched
  `checksums.txt` (`1e075a58…dfff`), and a deliberately corrupted archive was refused with a
  mismatch and installed nothing.
- `eas workflow:validate .eas/workflows/release-production.yml` for the release gates. Their runtime
  behaviour is unproven until the first tagged release, and the PR says so.

"Tests pass" is not proof, and neither is GREENLIT — it means no CRITICAL or HIGH in a static scan,
not that Apple has approved the app.
