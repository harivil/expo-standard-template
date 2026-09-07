# Expo delivery harness — template

A starting point for a new **Expo SDK 57** app targeting **iOS, Android and web**, with the delivery
process already wired up: agent instructions, guard hooks, review agents, five test layers, five
security scanning layers, a release path through EAS, and CI that runs the same checks locally and on
every pull request.

The app inside it is deliberately small — tabs, a themed counter, a not-found route. It exists to
prove the harness works end to end, not to be the app you are building. Replace it.

**Works from Windows or macOS.** Every command goes through `npm`, `npx` or `node`, and
`node .claude/check-skills.mjs` fails the build on any OS-specific script that sneaks in. The one
genuine gap is iOS: there is no iOS simulator for Windows, and the harness reports that as a named
gap rather than pretending otherwise — see [Platform reality](#platform-reality) below.

---

## Start a new app from this

```bash
git clone https://github.com/10XHS/10X-Mobile.git my-new-app
```

```bash
cd my-new-app && rm -rf .git && git init && npm install
```

Then check the machine has everything. It reports what is missing and the command to fix each,
and never installs anything behind your back:

```bash
node .claude/scripts/setup.mjs
```

Then confirm the harness is green **before** you change a line:

```bash
npm run verify
```

A green run here is what tells you a later red one is your change and not the template.

### Running it

```bash
npm run web
```

`npm run android` and `npm run ios` do the same for the native surfaces. `npm start` gives you the
picker.

---

## Make it yours

The template ships with **working placeholder identifiers**, not `__TOKENS__`, on purpose: the repo
verifies green out of the box, so you can tell a real failure from an unconfigured one. The cost is
that you have to change them. All of them are below.

| Change                                                             | Where                                            |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| `name`, `slug`, `scheme`                                           | [`app.json`](app.json) — `expo.*`                |
| `ios.bundleIdentifier`, `android.package` — from `com.tenxhealth.` | [`app.json`](app.json)                           |
| `name`                                                             | [`package.json`](package.json)                   |
| Store listing, privacy and support URLs — from `example.com`       | [`store.config.json`](store.config.json)         |
| Review owners — from `@your-org/mobile-reviewers`                  | [`.github/CODEOWNERS`](.github/CODEOWNERS)       |
| The `Unreleased` block, once it describes your app                 | [`CHANGELOG.md`](CHANGELOG.md)                   |
| App name in the smoke flows                                        | [`.maestro/`](.maestro/), [`e2e/web/`](e2e/web/) |
| The token palette                                                  | [`src/theme.ts`](src/theme.ts)                   |
| Icons and splash                                                   | [`assets/`](assets/)                             |

Two more that are not text edits:

- **`eas init`** writes `extra.eas.projectId` into `app.json` and links the repo to an EAS project.
  It is deliberately absent here — a template carrying someone else's project id would silently
  build into their account.
- **`.env`** — copy [`.env.example`](.env.example). Never commit the result; a secret that lands in
  history is rotated, not deleted.

Leave the four version numbers alone until you have read
[`versioning`](.claude/skills/versioning/SKILL.md) — you own `expo.version` and EAS owns the rest,
and the check in CI enforces that split.

---

## How work moves through it

Every change — feature, bug, incident — runs one loop, sized first:

```
intent ──▶ spec ──▶ plan ──▶ design ──▶ build ──▶ verify ──▶ review ──▶ ship
   ▲                                                                       │
   └──────────────── maintain writes the next intent ◀────────────────────┘
```

Each stage commits an artifact the next one reads, under one kebab-case slug, so a change can be
picked up by anyone in a fresh session without the conversation that produced it.
[`.claude/skills/feature-loop/SKILL.md`](.claude/skills/feature-loop/SKILL.md) is the spine;
[`AGENTS.md`](AGENTS.md) is the full reference and the file your agent reads first.

Three review agents run inside the loop, each given a **different ground truth** from the builder —
`spec-reviewer`, `verifier`, `change-reviewer`. That asymmetry is the point, and `AGENTS.md`
explains why widening their tools breaks it.

---

## The checks

One command runs what CI runs:

```bash
npm run verify
```

Format, types, lint, unit and functional tests, `expo-doctor`, the version gate, the hook and skill
tests, and the Semgrep rule fixtures. Add `-- --full` for the Playwright web suite. It reports
**green**, **failed**, or **incomplete** — and never green when a required check could not run,
which is what stops a missing local tool from reading as a pass.

App Store and Google Play compliance is its own scan, because "is this safe?" and "will this be
rejected?" are different questions:

```bash
npm run compliance
```

It reports privacy-manifest, purpose-string, tracking, account-deletion, placeholder-content and
secret findings with the store guideline behind each one. **GREENLIT means no CRITICAL or HIGH
findings in a static scan — it does not mean Apple has approved the app.** The scanner is a Go
binary, pinned in `.greenlight-version`, with no Windows build upstream;
`node .claude/scripts/setup.mjs` names the install route for your platform. Detail lives in
[`greenlight`](.claude/skills/greenlight/SKILL.md).

### On a pull request

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) already triggers on **every** pull request,
whatever the target branch, plus pushes to `main`. It runs `verify`, Playwright, commit-message
linting across the whole PR range, the hook and skill tests, and a test-integrity check.
[`security.yml`](.github/workflows/security.yml) adds Semgrep, CodeQL and dependency scanning;
[`dast.yml`](.github/workflows/dast.yml) runs ZAP against the exported web build;
[`compliance.yml`](.github/workflows/compliance.yml) scans for store-rejection risk and uploads its
findings to the Security tab. That last one is **report-only** until the repo's existing placeholder
and privacy debt is cleared — one documented toggle makes it blocking.

**CI running is not the same as CI being required.** Making a red check block a merge is a GitHub
repository setting, not a file in this repo — so a fresh repo starts with every local guard and none
of the real one. After your first push:

```bash
node .claude/scripts/protect-main.mjs --apply
```

It prints the policy and changes nothing without `--apply`. Every change then reaches `main` through
a pull request with green checks; no force pushes, no deleting the branch.

It defaults to **solo** mode — a PR is required but no approval is, because GitHub will not let you
approve your own PR and requiring one on a single-maintainer repo turns every merge into an admin
override. Add `--team` the moment a second person can actually approve, and CODEOWNERS review turns
on with it. Protected branches on a **private** repo need GitHub Pro or above; the script says so
plainly rather than reporting a success it did not get.

### Before a commit or a push

Three git hooks, installed by `npm install` via husky, so they apply to any agent and to a plain
`git` command alike:

| Hook                              | Refuses                                     |
| --------------------------------- | ------------------------------------------- |
| [`commit-msg`](.husky/commit-msg) | a message that is not a Conventional Commit |
| [`pre-commit`](.husky/pre-commit) | a staged diff containing a secret           |
| [`pre-push`](.husky/pre-push)     | any push that lands on `main` or `master`   |

The secret scan skips with a note when `gitleaks` is not installed locally — CI scans every push
regardless.

Claude Code sessions get more on top: hooks that block `npm install` of an Expo package, a commit on
`main`, a force push, and writes to generated directories. [`AGENTS.md`](AGENTS.md) lists all of them
under _What is enforced_.

`main` therefore moves **only by merging a reviewed pull request**. When you genuinely need to update
it — seeding a fresh repo from this template is the usual reason — say so deliberately rather than
reaching for `--no-verify`:

```bash
ALLOW_PUSH_TO_MAIN=1 git push origin main
```

---

## Platform reality

| Surface     | Windows                      | macOS |
| ----------- | ---------------------------- | ----- |
| Web         | yes                          | yes   |
| Android     | yes                          | yes   |
| iOS (local) | **no** — no simulator exists | yes   |

From Windows, iOS is covered by CI, by a teammate on a Mac, or by the paid `eas-simulator` cloud
simulator. `capture.mjs` reports the gap as `impossible-here` rather than failing, and the PR names
who covers it. That honesty is the feature: an unverified surface that is written down gets picked
up, one that is merely implied ships broken.

---

## What this template deliberately does not include

Each of these is a decision with reasoning written down, not an omission — read it before reversing
it.

- **Detox** — would make iOS E2E macOS-only and cannot test web. Maestro plus Playwright covers all
  three surfaces from either OS. Full comparison in
  [`write-e2e`](.claude/skills/write-e2e/SKILL.md).
- **Fastlane** — needs Ruby and a Mac for iOS signing. EAS Build and Submit already do that for a
  team on Windows.
- **A state management or data-fetching library** — pick one per app. The `expo-data-fetching`
  skill, listed in [`AGENTS.md`](AGENTS.md), carries the current guidance.
- **Post-release observability** — the loop's one open gap, written up as a deferred intent at
  [`docs/intent/release-observability.md`](docs/intent/release-observability.md) rather than left as
  a memory. Read it before your first release.
