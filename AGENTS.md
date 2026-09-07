# Agent instructions

An Expo app targeting **iOS, Android, and web**, built by a team working on Windows and macOS with
Claude Code or Codex. These instructions apply to every agent regardless of which.

**Expo SDK 57**, Expo Router, TypeScript. Routes live in `src/app/`; `<root>` in the skills means
`src/`. One command sets a machine up and one command checks your work:

```bash
node .claude/scripts/setup.mjs
```

```bash
npm run verify
```

`verify` runs what CI runs — format, types, lint, tests, expo-doctor, the version gate, the hook and
skill tests, and the Semgrep rule fixtures. Add `-- --full` to include the web E2E suite, which is
what CI runs on every pull request. It reports **green**, **failed**, or **incomplete**, and never
green when a required check could not run.

That claim — "it runs what CI runs" — is **checked, not trusted**. Every step in `ci-local.mjs`
names the workflow job it stands in for, and `check-skills.mjs` fails when a workflow declares a job
no step covers and no exemption explains. Adding a job to CI is therefore a decision: cover it
locally, or write down why no local run can honestly stand in for it. Without that, the script keeps
passing while proving less than the person running it believes.
[`preflight-ci`](.claude/skills/preflight-ci/SKILL.md) is the procedure; a green run is also what
[`guard-pr`](.claude/hooks/guard-pr.mjs) requires before a pull request can open.

## Any change starts here

Every feature, bug, and issue runs the same loop. Read
[`.claude/skills/feature-loop/SKILL.md`](.claude/skills/feature-loop/SKILL.md) and follow it before
creating the first file — it sizes the change, then drives intent → spec → plan → design → build →
verify → review → ship, and closes back to intent when something comes back.

```
intent ──▶ spec ──▶ plan ──▶ design ──▶ build ──▶ verify ──▶ review ──▶ ship
   ▲                                                                       │
   └──────────────── maintain writes the next intent ◀────────────────────┘
```

Each stage commits an artifact the next one reads, under one kebab-case slug:

| Stage  | Artifact                       | Template                                                                       |
| ------ | ------------------------------ | ------------------------------------------------------------------------------ |
| Intent | `docs/intent/<slug>.md`        | [`docs/intent/TEMPLATE.md`](docs/intent/TEMPLATE.md)                           |
| Spec   | `docs/specs/<slug>.md`         | [`docs/specs/TEMPLATE.md`](docs/specs/TEMPLATE.md)                             |
| Plan   | `docs/plans/<slug>.md`         | [`docs/plans/TEMPLATE.md`](docs/plans/TEMPLATE.md)                             |
| Design | tokens and states, in the plan | [`.claude/skills/design-system/`](.claude/skills/design-system/SKILL.md)       |
| Build  | the diff                       | [`.claude/skills/scaffold-feature/`](.claude/skills/scaffold-feature/SKILL.md) |
| Verify | screenshots and check output   | [`.claude/skills/verify-app/`](.claude/skills/verify-app/SKILL.md)             |
| Review | findings on the PR             | [`REVIEW.md`](REVIEW.md)                                                       |
| Ship   | a tag, and a build on a device | [`.claude/skills/release-app/`](.claude/skills/release-app/SKILL.md)           |

## Agent independence — why a reviewer does not read this file

Three agents run inside the loop, and each is deliberately given a **different ground truth** from
the builder. A clean context alone is not enough: it removes the conversation but not the premises,
and an agent that checks work against the same document that produced it will confirm whatever that
document got wrong. Correlated blind spots are how a review becomes a rubber stamp.

| Agent                      | Ground truth                                            | Does **not** treat as truth                    |
| -------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| Builder — the main session | this file, the skills, `plan.md`                        | —                                              |
| **`spec-reviewer`**        | `intent.md`, and the codebase as it actually is         | the spec's own claims about the app            |
| **`verifier`**             | the spec's acceptance criteria, and **the running app** | this file, `plan.md`'s reasoning, your summary |
| **`change-reviewer`**      | `REVIEW.md`, the diff, the spec                         | this file, the commit message                  |

The load-bearing split: **the verifier's ground truth is observed behaviour, not documentation.** It
answers "what does the app do", never "does this follow our conventions" — that second question
belongs to lint and to `change-reviewer`. Keeping them apart is what lets the loop catch a change
that followed every convention here and still failed to do what was asked.

All three report; none fixes, and none approves. `verifier` has no `Edit` tool and `spec-reviewer` has
no `Bash` tool, on purpose — do not widen them.

## Agent setup

Run this first on a new machine. It reports everything missing, with the command to fix each:

```bash
node .claude/scripts/setup.mjs
```

Both agents get the same Expo skills and the same live docs. Run the setup for whichever you use —
once per machine for the plugins, once per repo for `skills add`.

**Install plugins at `--scope user`, not `--scope project`.** A project-scoped install binds to the
directory it ran in, so the same plugin is invisible in a second checkout on the same machine — and
the failure is silent: the skills simply are not there. `--scope user` covers every checkout.

|                    | Claude Code                                          | Codex                                                 |
| ------------------ | ---------------------------------------------------- | ----------------------------------------------------- |
| Expo plugin        | `claude plugin install expo@claude-plugins-official` | `codex plugin add expo@openai-curated`                |
| Expo MCP server    | arrives with the plugin — then `/mcp` to authorize   | arrives with the plugin — then `codex mcp login expo` |
| Engineering skills | `claude plugin install mattpocock-skills`            | `npx skills@latest add mattpocock/skills`             |

**Do not run `claude mcp add ... expo` on top of the plugin.** The plugin registers the server itself
— it appears as `plugin:expo:expo` — so adding it again by hand gives you two servers offering the
same tools, two auth prompts, and a doubled tool list in every session. Reach for the manual
`claude mcp add --transport http expo https://mcp.expo.dev/mcp` only on a machine deliberately
running without the plugin.

One asymmetry to know about: the Claude plugin route installs a **managed, read-only** bundle that
auto-updates, while `npx skills add` writes **editable copies into this repo** that update only when
someone runs `npx skills update`. A team split across both agents will drift unless someone owns
that refresh. That drift is the reason these skills are **not vendored into `.claude/skills/`**: they
track the Expo SDK, and a stale `expo-upgrade` is worse than an absent one. What must survive a
machine with no plugins is written by us instead, under `references/`.

Skills load lazily, so a large plugin is cheap until used: only each `SKILL.md`'s frontmatter is in
context at startup — about 3k tokens for Expo's 24 skills, against 58k for every body. A body loads
when the skill is invoked and then **stays in context for the rest of the session**, so the cost is
cumulative within a session. That is one of the things `manage-context` is watching for.

The **Expo MCP server** is the highest-value piece of this setup. It gives live documentation search,
`npx expo install` at SDK-compatible versions, EAS build triggers and logs, store and TestFlight
crash data, and — with a dev server running — **simulator screenshots**, which is what lets an agent
actually verify a screen rather than assert it renders.

It needs an **Expo account login** before any of that works, and the OAuth flow only runs in an
interactive session — so a non-interactive or CI session sees the server listed and unusable. That is
expected. Authorize once per machine with `/mcp`; until you do, `verify-app` falls back to the local
surfaces and should say so rather than claiming a screen was checked.

Skills worth reaching for by name once installed:

| Skill                                | Reach for it when                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **`expo-overview`**                  | **first, on any Expo task** — it routes to the right skill below                                                      |
| `expo-router`                        | navigation, layouts, params, deep links                                                                               |
| `expo-project-structure`             | deciding where a file belongs                                                                                         |
| `expo-native-ui`                     | making a screen feel native — HIG, semantic colours, SF Symbols                                                       |
| `expo-ui`                            | native platform controls                                                                                              |
| `expo-data-fetching`                 | any network call, caching, offline, Router loaders                                                                    |
| `expo-animation`                     | Reanimated, gestures, transitions, haptics                                                                            |
| `expo-upgrade`                       | moving to a new SDK                                                                                                   |
| `expo-design-system`                 | extending the token set in `src/theme.ts`                                                                             |
| `expo-dev-client`                    | building or distributing a dev client                                                                                 |
| `eas-workflows`, `eas-app-stores`    | builds, submissions, store metadata                                                                                   |
| `eas-simulator`                      | driving a cloud iOS simulator from Windows (**paid**)                                                                 |
| `eas-observe`, `eas-update-insights` | post-release health — **not adopted yet**, see [the deferred intent](docs/intent/release-observability.md) (**paid**) |
| `tdd`                                | writing the failing test first                                                                                        |
| `code-review`                        | reviewing a diff before a human sees it                                                                               |

`expo-overview` is the entry point by design — load it before choosing any other `expo-*` skill, even
when the request already names the one you think you need. Two of these overlap with our own skills
and the split is deliberate: `expo-native-ui` and `expo-design-system` carry what Expo knows about
native convention, while [`design-system`](.claude/skills/design-system/SKILL.md) below carries what
**this app** has decided. When they disagree, ours wins and the disagreement is worth a line in the
PR.

This repo's own skills, which carry what is specific to **this** app rather than to Expo:

| Skill                 | Owns                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| `feature-loop`        | the whole loop; read it before the first file                                |
| `design-system`       | tokens, states, component variants, contrast, native convention              |
| `scaffold-feature`    | where a file goes and how it is written here                                 |
| `verify-app`          | proving a change works on all three surfaces, light and dark                 |
| `write-e2e`           | Maestro and Playwright flows, and selector discipline                        |
| `capture-evidence`    | before/after screenshots for the PR                                          |
| `open-pr`             | raising the PR with those screenshots rendered in its body                   |
| `preflight-ci`        | running what CI runs before pushing, and triaging a red check                |
| `toolchain-standards` | Prettier, ESLint, husky, commitlint, lint-staged — config _and_ what runs it |
| `versioning`          | the four version numbers and which one you may touch                         |
| `release-app`         | EAS build, submit, TestFlight, the stores, OTA and rollback                  |
| `security-scan`       | the five static layers and how to triage a finding                           |
| `dast-scan`           | what the running app actually sends over the network                         |
| `greenlight`          | App Store and Play compliance, and what GREENLIT does not mean               |
| `manage-context`      | keeping a long session working, and handing one over                         |

The `references/` files under the scaffold skill cover the same ground independently, so a teammate
who has not run any of the above still gets a working procedure.

## Testing layers

Five layers, three tools. They are layers, not alternatives.

| Layer                    | Tool                                 | Covers                                                      | Runs                                                |
| ------------------------ | ------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------- |
| Unit                     | Jest + React Native Testing Library  | a hook, a helper, one branching component                   | every PR, milliseconds                              |
| Functional / integration | Jest + React Native Testing Library  | a whole screen body, network and storage mocked at the edge | every PR, seconds                                   |
| Native E2E               | **Maestro** — `.maestro/*.yaml`      | iOS, Android journeys                                       | feature's own flow before merge; full suite nightly |
| Web E2E                  | **Playwright** — `e2e/web/*.spec.ts` | deep links, browser back, reload, desktop widths            | every PR                                            |
| Build + release          | **EAS** Build / Submit / Workflows   | binaries, store submission, running Maestro on real devices | on merge                                            |

The first two are the **same toolchain** — RNTL is a renderer and a set of queries running on Jest,
not a second runner. What separates them is a boundary decision: how much you render, and what you
mock. Both live beside the code they test; `references/testing.md` under the scaffold skill has the
detail, including the one boundary that catches people out — **`expo-router` is mocked to a stub
under Jest, so a functional test can render a screen but cannot exercise navigation.** A route being
reachable is an E2E question, and a unit test that appears to prove otherwise is proving nothing.

Writing one: [`write-e2e`](.claude/skills/write-e2e/SKILL.md). The detail that keeps it maintainable
is that a React Native `testID` becomes `accessibilityIdentifier` on iOS, `resource-id` on Android,
and `data-testid` on web — so one prop is addressable from Maestro and Playwright alike. Add it while
writing the component.

**Detox and Fastlane are deliberately not used**, and it is worth being accurate about why — a
decision defended by a stale claim gets overturned by the first person who checks.

Detox **can** work with an Expo app via Continuous Native Generation (`npx expo prebuild`). It is
not used here because it would make iOS E2E macOS-only (there is no Detox job type in EAS
Workflows, so Windows developers would lose the iOS coverage `.eas/workflows/e2e.yml` gives them
today), because it needs the generated `/ios` and `/android` projects that this repo gitignores and
`guard-write` blocks, and because it cannot test web — so Playwright would stay and the cost is
three E2E tools instead of two. [`write-e2e`](.claude/skills/write-e2e/SKILL.md) carries the full
comparison, including what Detox's grey-box synchronisation genuinely buys that Maestro does not,
and the New Architecture caveat.

Fastlane means a Ruby toolchain and a Mac for iOS signing, which EAS Build and Submit already cover
for this team.

**Greenlight is not a sixth layer here.** It never runs the app, so it cannot tell you whether login
works — it checks store compliance and rejection risk. Maestro and Playwright keep every functional
journey; see [App Store compliance](#app-store-compliance). Reading a GREENLIT as "the flows work" is
the specific mistake that section exists to prevent.

## Security scanning

Five layers, cumulative — see [`security-scan`](.claude/skills/security-scan/SKILL.md).

| Layer          | Tool                                                                                           | Runs                                         |
| -------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| While you type | `security-guidance` plugin hooks                                                               | every edit                                   |
| On lint        | ESLint security plugins                                                                        | `npm run lint`                               |
| Secrets        | **gitleaks** + `.gitleaks.toml`                                                                | before every commit, CI, weekly over history |
| Pattern SAST   | **Semgrep** + this repo's `.semgrep.yml`                                                       | CI, every PR                                 |
| Semantic SAST  | **CodeQL** — cross-file dataflow                                                               | CI, every PR                                 |
| SCA            | **npm audit**, **expo-doctor**, **Dependabot**                                                 | CI, weekly                                   |
| DAST           | **ZAP** (web + API), **mitmproxy** (native) — [`dast-scan`](.claude/skills/dast-scan/SKILL.md) | weekly; mitmproxy before a release           |
| Deep review    | `claude-security` plugin                                                                       | on demand, before a release                  |

`.semgrep.yml` carries 11 rules for what generic packs miss in an Expo app handling health data:
personal data reaching logs or URLs, `EXPO_PUBLIC_` names holding secrets, tokens in `AsyncStorage`
rather than `expo-secure-store`, plaintext HTTP, dynamic WebView injection, unchecked deep-link
params, cleartext traffic in `app.json`. All 11 are covered by fixtures —
`node .claude/scripts/semgrep-test.mjs` fails if a rule stops firing **or** has no test.

Semgrep is Python, the one exception to the npm-only rule: `pipx install semgrep`, or Docker. It is
not needed to work on the app; CI runs it regardless.

**Dependabot deliberately ignores every Expo-governed package** — `expo`, `react`, `react-native`,
`expo-*`, `react-native-*`, `@expo/*`. The SDK governs their versions, so a bump is a
desynchronisation that passes `npm audit` and then fails `expo-doctor`. Those move together via
`npx expo install --fix`, and an SDK upgrade is its own work.

**Suppress nothing silently.** `// nosemgrep: <rule> -- <reason>`, and a suppression without a reason
is itself a review finding. A secret found in a diff gets **rotated first**, not just deleted — git
history keeps what you removed, and anyone who cloned the repo already has it.

## App Store compliance

Everything above answers "is this code safe?" None of it answers "will this be rejected?" That is a
different question with a different rulebook, and it is answered by
[`greenlight`](.claude/skills/greenlight/SKILL.md) — a Go binary that reads source, `app.json`,
privacy manifests, the Android manifest and the built `.ipa` / `.aab`, and cites the guideline behind
every finding. Offline, no account.

| Surface                  | Runs                                                                 | Blocks?      |
| ------------------------ | -------------------------------------------------------------------- | ------------ |
| Local                    | `npm run compliance`                                                 | no           |
| `npm run verify`         | optional step, skipped when the binary is absent                     | no           |
| Every PR, and weekly     | [`compliance.yml`](.github/workflows/compliance.yml), SARIF uploaded | configurable |
| Before TestFlight / Play | [`release-production.yml`](.eas/workflows/release-production.yml)    | **yes**      |

Four severities — `CRITICAL`, `HIGH`, `WARN`, `INFO` — and `--exit-code` trips on **CRITICAL and
HIGH**, plus on a scanner that crashed, so an incomplete scan never reads as a pass. `HIGH` is where
Sign in with Apple, Restore Purchases, ATT, account deletion and Play's published deadlines live,
which is most of what actually gets an app rejected. Describing the gate as CRITICAL-only
understates it by half.

**GREENLIT means no CRITICAL or HIGH findings in a static scan. It does not mean Apple has approved
the app**, and nothing in this repo may claim it does. A static scan proves a flow _exists_; it
cannot prove it _works_. A Delete Account button wired to nothing contains the string
`deleteAccount`, satisfies §5.1.1, prints GREENLIT, and is rejected the moment a reviewer taps it.
The runtime tier that would close that gap needs a paid third-party account and is **not adopted** —
see [the deferred intent](docs/intent/greenlight-runtime-verify.md).

**The PR job is report-only today.** The first real scan reported **3 CRITICAL** on this repo: no
app icon configured, no privacy manifest, and a required-reason API undeclared. Some of what remains
needs a design asset or product copy rather than a code change, and a red check nobody can clear is a
check everybody learns to scroll past — it takes the real findings with it. (Note what the scanner
does _not_ read: `store.config.json` is invisible to it, so the placeholder `example.com` URLs there
are still yours to catch — `release-app` §4 owns that list.) Making it blocking is a deliberate two-line change, documented in the skill:
flip `GREENLIGHT_ENFORCE` in `compliance.yml` **and** add `compliance` to `protect-main.mjs`, in one
commit.

**The release gates enforce from the start**, and they scan the artifacts the existing `production`
build already produced — no extra build. That is not belt-and-braces, and the first scan proved it:
`/ios` and `/android` are generated by prebuild and gitignored, so the `PrivacyInfo.xcprivacy` Apple
actually reads **does not exist in this repo**. Declaring `ios.privacyManifests` in `app.json` is the
correct fix and it does **not** clear the finding, because the scanner reads the file, not the
config. Those two CRITICALs are therefore permanent in a source scan here — do not chase them, and
do not flip the PR gate on expecting them to clear. The binary is where they are actually verifiable,
which is the whole reason both gates exist and neither is sufficient.

**Suppress nothing silently, and never disable a rule to make CI pass.**
`// greenlight:ignore <rule> -- <reason>`, naming the rule — a bare directive kills every check on
the line, and an unexplained suppression is itself a review finding. A `.greenlight.yml` may carry
commented `ignore:` entries for directories deliberately full of bad patterns (`.semgrep-tests/` holds
planted credentials on purpose, and `security.yml` already excludes it from Semgrep for the same
reason). It may not carry a rule downgraded to make a real finding disappear.

**Ask before changing authentication, payment, tracking or account-deletion behaviour** to satisfy a
finding. Those are product and legal decisions in a health app, not lint fixes.

The version is pinned in one file, [`.greenlight-version`](.greenlight-version), read by the
installer and all three gates. greenlight is a Go binary, so it is not in `package.json` and
**Dependabot cannot see it** — a human owns the bump, and the download is checksum-verified before it
is ever executed. Upstream publishes darwin and linux archives only: **there is no Windows binary**,
so Windows developers need the Go toolchain or WSL2, and `node .claude/scripts/setup.mjs` names that
gap with the pinned command rather than leaving it to be discovered.

## Versioning

Four version numbers, four owners — see [`versioning`](.claude/skills/versioning/SKILL.md).

| Number                                   | Owner                                  | Changes when          |
| ---------------------------------------- | -------------------------------------- | --------------------- |
| `expo.version`                           | **you**                                | a user-facing release |
| `ios.buildNumber`, `android.versionCode` | **EAS** (`appVersionSource: "remote"`) | every build           |
| `runtimeVersion`                         | the **`fingerprint`** policy           | native code changes   |

Two rules worth knowing before you touch any of them:

- With `appVersionSource: "remote"`, **build numbers must not appear in `app.json`** — EAS ignores
  them, so a number left there is a stale claim someone will later believe.
- **`runtimeVersion` is what stops an OTA update reaching a build whose native code cannot run it.**
  Use the `fingerprint` policy: it derives the runtime from everything that actually affects native
  code, so a native change automatically stops old builds receiving the update. It costs more builds.
  That is the trade, and it is the right side of it.

`node .claude/scripts/version-check.mjs` enforces both, and runs in CI.

Commits follow Conventional Commits (`commitlint.config.js`), because the log is what decides the
next bump and writes the changelog — `feat:` → minor, `fix:`/`perf:` → patch, `!` → major. A human
still chooses the released version; automate the count, keep the decision.

This is **enforced in two places**, because one is escapable: a husky `commit-msg` hook rejects a
malformed message locally, and a `commits` job in CI re-checks the whole PR range — which catches a
fresh clone that never ran `npm install`, and anyone who reached for `--no-verify`.

## Releasing

Merging is not shipping. Getting a merged change onto a device is
[`release-app`](.claude/skills/release-app/SKILL.md) — first-time EAS setup, credentials, the four
build profiles, TestFlight, both stores, OTA updates and rollback.

Two things about it worth knowing before you need them:

- **No Mac is required.** EAS builds iOS on its own macOS machines, so a teammate on Windows can cut
  an App Store release. That is why this repo uses EAS Build and Submit and not Fastlane.
- **EAS owns the build numbers**, because `eas.json` sets `cli.appVersionSource: "remote"`. You own
  `expo.version` and nothing else numeric. `version-check.mjs` fails the build if a build number
  reappears in `app.json`.

[`.eas/workflows/release-production.yml`](.eas/workflows/release-production.yml) runs the same steps
on EAS from a `v*` tag. It has **not been run against EAS from this repo yet** — validate it with
`eas workflow:validate` before relying on it; until then the CLI path in the skill is the verified
one.

## Evidence, not assertion

Anything visible ships with before **and** after. Capture the baseline _before_ you start editing —
once the work is done the before is gone:

```bash
node .claude/scripts/capture.mjs before <slug> --surfaces ios,android,web --record
```

…and the same surfaces and the same journey again as `after` at verify. The
[`capture-evidence`](.claude/skills/capture-evidence/SKILL.md) skill owns the detail. Captures land in
`.evidence/`, which is gitignored — they attach to the PR rather than bloating the repo.

**Getting them into the PR is one command**, and it is not a drag-and-drop:

```bash
node .claude/skills/open-pr/scripts/open-pr.mjs <slug> --capture --what "one sentence"
```

[`open-pr`](.claude/skills/open-pr/SKILL.md) captures, uploads, pushes the branch and opens the PR
with its evidence table already rendering the images. Two things about it are worth knowing before
you need them. It needs **no browser and no login** — GitHub has no documented API for attaching an
image, so the prior art all drives a real browser, and this uses the undocumented endpoint the web
UI itself posts to, with the token `gh` already holds; when that answers anything but 2xx it says so
and writes the local paths for a human to drag in, rather than leaving a body of images that
silently do not load. And it asks the **same review-gate question** `guard-pr` asks, through the
same definition, because it calls `gh` from inside node where no hook can see it.

Web is captured **light and dark**, with nothing needing to be running.
[`shoot-web.mjs`](.claude/scripts/shoot-web.mjs) exports the app and serves the export through
[`web-export.mjs`](.claude/scripts/web-export.mjs) — the same definition the web E2E suite's server
uses, so a screenshot and a test cannot disagree about what they were looking at. It re-exports
every run, because a cached export is a screenshot of code you are not reviewing.

Windows machines cannot capture iOS; there is no iOS simulator for Windows. Surfaces therefore
default to **what the machine can do** — `ios,android,web` on macOS, `web,android` on Windows — and
the missing one is reported as a typed gap rather than a failure, with the PR naming who covers it.
An unverified surface that is written down gets picked up; one that is merely implied ships broken.
The same is true of **anything behind the login guard**: an unaided capture reaches `/login` and no
further, so a change inside `(tabs)` is not in those screenshots, and the body says so. Reaching
past the guard would put test credentials on every machine that raises a PR, which in a health app
is a security decision rather than a convenience — it is deliberately not done.

## Managing a long session

Read [`manage-context`](.claude/skills/manage-context/SKILL.md) when a session grows, when handing
work over, or when quality starts slipping mid-task. Its central claim: the artifact chain **is** the
context protocol — a change whose intent, spec and plan are current can be resumed by anyone, in a
fresh window, without the conversation.

## What is enforced

Most of this file is advisory. These are not — hooks in `.claude/settings.json` block them
deterministically, on every session, for everyone:

| Blocked                                                                                                                                                                                                                      | Do this instead                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm install` of an Expo or React Native package                                                                                                                                                                             | `npx expo install <pkg>` — matches the SDK                                    |
| `git push --force`                                                                                                                                                                                                           | `--force-with-lease`, which refuses when someone else has pushed              |
| **Rewriting `main` by any spelling** — `--force-with-lease origin main`, `+main`, `--delete main`, `:main`, `git branch -f/-D main`, `git update-ref refs/heads/main`, or a force push / `reset --hard` while standing on it | land work by merging a PR; undo with `git revert <sha>`                       |
| `git commit` while on `main`                                                                                                                                                                                                 | branch, or `git worktree add ../work-<slug> -b <slug>`                        |
| **Any push landing on `main` or `master`** — including `origin HEAD:main` from a feature branch                                                                                                                              | push your branch, open a PR, merge it                                         |
| **Opening, readying or merging a pull request** before `npm run verify -- --full` has passed against the code being reviewed                                                                                                 | run the gate and fix what it reports; `gh pr create --draft` is never blocked |
| Writing to `node_modules/`, `.expo/`, `android/`, `ios/`, `dist/`, `build/`, `coverage/`, `package-lock.json`                                                                                                                | change the source or config that generates them                               |
| **The same write performed by the shell** — `sed -i`, `>`, `>>`, `tee`, `cp`/`mv` destination, `dd of=`                                                                                                                      | same: change the source, or regenerate with the tool that owns the file       |
| **Starting a session at all**, when a plugin this repo declares is not installed for this directory                                                                                                                          | `node .claude/scripts/setup.mjs`, then run the install commands it prints     |
| **Submitting a production build** whose `.ipa` or `.aab` has a CRITICAL or HIGH compliance finding                                                                                                                           | fix the finding — the gate sits between build and submit                      |

Edited files are formatted automatically after each write, so style drift never reaches a diff.

The pull-request row is [`guard-pr`](.claude/hooks/guard-pr.mjs), and what it reads is the receipt
`npm run verify` writes to `.claude/.ci-local.json`. Four things make that receipt fail the gate,
and the fourth is the one people actually hit: **it was run against different code.** The receipt
records the commit _plus_ the state of the working tree, so editing a file after a green run makes
the receipt stale rather than reusable. A draft PR is deliberately allowed — sharing unfinished work
is not the failure this guards against. `CLAUDE_SKIP_CI_PREFLIGHT=1` exists for a broken gate;
reaching for it routinely means the gate is wrong, so fix the gate.
[`preflight-ci`](.claude/skills/preflight-ci/SKILL.md) owns what maps to what.

The two path rows are **one path list, read by two guards** —
[`protected-paths.mjs`](.claude/scripts/protected-paths.mjs), the same arrangement as
`check-push-target.mjs` and [`shell-segments.mjs`](.claude/scripts/shell-segments.mjs), which is
the single answer to "where does one shell command end and the next begin", shared by `guard-bash`
and `guard-pr`. That one is worth a sentence, because a second copy of it is a second set of false
positives: it is quote-aware and it drops heredoc bodies, so `sed -i 's|a|b|' <path>` stays one
command and a file being written with `cat > x <<EOF` may contain any command text at all —
including the ones these guards block. A guard that cannot tell a document from a command blocks
the session that is writing its own tests, which is exactly how that module came to exist. It is worth knowing why the shell row exists, because it is the shape
of mistake to look for elsewhere: `guard-write` only ever sees the `file_path` of an `Edit` or
`Write` call, so for as long as it was the only path guard, `sed -i 's/x/y/' android/build.gradle`
was completely unguarded. A guard that covers one tool covers one tool. What it **cannot** see is
a write performed inside a program — `node -e "fs.writeFileSync(...)"`, a script that writes when
run — and that is a limit, not an oversight: it raises the cost of an accident, it is not a sandbox.

One hook **warns rather than blocks**. [`stage-check`](.claude/hooks/stage-check.mjs) fires the
first time a branch writes under `src/` with no `docs/specs/<slug>.md`, names the missing artifact,
and lets the write through. A block would be wrong: a hotfix, a bump and a spike are all
legitimate writes with no spec, and a guard that fires on them gets disabled within a week — which
is worse than no guard, because everyone keeps believing it is on.

Four more are enforced by **git hooks** rather than Claude Code hooks, which is what makes them
apply to Codex, to a plain `git commit`, and to a human:

| Blocked                                                   | Where                                 |
| --------------------------------------------------------- | ------------------------------------- |
| A commit message that is not a Conventional Commit        | `.husky/commit-msg` → commitlint      |
| A commit whose staged diff contains a secret              | `.husky/pre-commit` → gitleaks        |
| A push that lands on `main` or `master`                   | `.husky/pre-push` → check-push-target |
| A push that **force-pushes or deletes** `main` / `master` | `.husky/pre-push` → guard-push        |

Two of those have **one definition each, shared with the Claude Code hook** — the pattern to copy
when adding a guard. `.claude/scripts/scan-staged.mjs` is called by both `.husky/pre-commit` and
`guard-secrets`, and `.claude/scripts/check-push-target.mjs` by both `.husky/pre-push` and
`guard-bash`. A session and a bare `git` command therefore cannot disagree about what counts. The
secret scan skips silently when gitleaks is not installed locally, because it is a Go binary rather
than an npm dependency; CI scans every push regardless.

The last two rows are two rules, not one, and the split is deliberate:
[`guard-push`](.claude/hooks/guard-push.mjs) refuses a force-push or delete **of** `main` and
**still bites under `ALLOW_PUSH_TO_MAIN=1`**, because seeding or repairing `main` is a reason to
append to it and never a reason to rewrite it. It reads git's own pre-push stdin — one line per ref
— and asks whether the remote's commit is still an ancestor of yours, so a push that would drop
someone else's commit is refused on the facts rather than on the flags it was spelled with. Where
its answer is unclear — a shallow clone with the object missing — it allows the push: a guard that
blocks on its own confusion is a guard people uninstall.

`.husky/pre-commit` also runs **lint-staged**, on the staged files only. A hook that lints the whole
repo is slow enough that people reach for `--no-verify`, and a hook people bypass enforces nothing.
[`toolchain-standards`](.claude/skills/toolchain-standards/SKILL.md) is what keeps that honest, and
the failure it exists to stop is not a missing config but **a config that is present and inert** —
`node .claude/scripts/toolchain-check.mjs` counts a tool as present only when both its config _and_
the thing that runs it exist.

**Why the push rule needs both layers.** The commit guard checks the branch you are standing on,
which says nothing about where a push lands — `git push origin HEAD:main` from a feature branch was
allowed by every guard here until the refspec check existed. And the Claude Code hook never sees a
push typed into a terminal. Neither layer alone closes it.

Both are still client-side, and `--no-verify` walks past them. **GitHub branch protection on `main`
is the only enforcement that cannot be bypassed.** The local hooks are the fast layer that explains
itself; the server is the layer that holds. It is not a file in this repo, so it does not arrive with
a clone — turn it on per repo, and check it is on before trusting it:

```bash
node .claude/scripts/protect-main.mjs --apply
```

When you need to update `main` deliberately — seeding a new repo from this template, or repairing it
— say so out loud rather than reaching for `--no-verify`:

```bash
ALLOW_PUSH_TO_MAIN=1 git push origin main
```

The session block deserves a word, because it is the only guard that refuses to start rather than
refusing one action. `enabledPlugins` in `.claude/settings.json` **declares** plugins; it does not
install the ones that come from an external source, so a teammate who clones this repo gets the
declaration and none of the Expo skills. That failure is invisible — the agent just quietly does
worse work. `require-plugins.mjs` makes it loud. Set `CLAUDE_SKIP_PLUGIN_CHECK=1` to start anyway;
CI already does, since it has no plugin state and never will.

Note the limit: this is a Claude Code hook, so the **plugin** check cannot gate **Codex** — a Codex
user is on `node .claude/scripts/setup.mjs` by convention there. The commit-message and secret
checks do reach them, because those are git hooks installed by `npm install` (the `prepare` script
runs husky), and git runs them whatever drove the commit.

The hooks are themselves tested — `node .claude/hooks/hooks.test.mjs` — and the skills and agents are
structurally validated by `node .claude/check-skills.mjs`. Both run in CI on any change under
`.claude/`, because configuration that steers every session deserves the regression testing code
gets. Change a guard, run the tests. `npm run verify` runs both alongside everything else.

One thing is enforced only in **CI**, because it needs the pull request to exist: the `artifacts`
job fails a PR that changes anything under `src/` without citing an intent, spec or plan **that is
in the repo** — [`check-artifacts.mjs`](.claude/scripts/check-artifacts.mjs). It answers only "does
the artifact this PR claims exist, exist"; whether the spec is any good is `change-reviewer`'s
question and a human's. It skips a diff that touches no `src/`, because a bump needs no spec and a
check that failed on one would just train everyone to paste a placeholder path to go green. Note
what that leaves: a placeholder `<slug>` and a `TEMPLATE.md` path both count as citing nothing,
which is the loophole worth closing deliberately rather than discovering later.

## Working in parallel

Several people and several agents work this repo at once. These rules keep them out of each other's
way.

- **Never commit to `main`, and never push to it.** One branch per task, and one git worktree per
  agent when running more than one at a time — `git worktree add ../work-<slug> -b <slug>`. Both are
  blocked, in a session and at `git` itself; `main` moves by merging a reviewed PR and no other way.
- **Scope-check before starting.** Read open PRs and `git status` for uncommitted work. When your
  task overlaps someone else's in flight, say so before writing rather than after.
- **Regenerate lockfiles, never hand-merge them.** Delete the conflicted `package-lock.json`, run
  `npm install`, commit the result. Hand-resolved lockfiles are how a mixed Windows/macOS team ends
  up with two different dependency trees.
- **`--force-with-lease`, never `--force`**, and only on your own branch.
- **Stop and report** a conflict you cannot resolve confidently. A wrong guess costs more than the
  question.

## Working style

- **Think before coding.** State your assumptions and the tradeoffs you are taking. When the request
  is ambiguous, ask rather than guess.
- **Simplicity first.** Build what was asked. No speculative features, no abstraction for a
  single-use piece of code, no configurability nobody requested.
- **Surgical changes.** Every changed line traces to the request. Match the surrounding style even
  where you would write it differently. Mention adjacent problems you notice; leave them alone.
- **Prove it.** Run the checks and read their output. Look at the screen — `tsc` and `jest` cannot
  see a blank one.

## Commands are cross-platform

Everything runnable in this repo goes through `npm`, `npx`, or `node`, and paths use forward slashes,
so the same command works on Windows and macOS. Tooling scripts are `.mjs` — never `.ps1`, `.bat`, or
`.sh` — and shell out through argument arrays rather than `shell: true`, which would bring per-OS
quoting rules back in through the side door.

**This is enforced.** `node .claude/check-skills.mjs` sweeps every tracked file for OS-specific
scripts, PowerShell and Windows-only syntax, hardcoded drive letters, and `shell: true`, and fails
the build on any of them. It runs in CI. Nothing to remember — write it portable or the build tells
you.

Install Expo packages with `npx expo install`, never `npm install` — it picks the version compatible
with this project's SDK.
