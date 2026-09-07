---
name: release-app
description: Ship this Expo app to TestFlight, the App Store and Google Play with EAS — first-time project setup, credentials, build and submit profiles, store review requirements, OTA updates and rollback. Use when preparing a release, running eas build or eas submit, shipping a build to testers, or when a submission is rejected.
---

# Release

Stage 7 of [`feature-loop`](../feature-loop/SKILL.md) ends at a merge. This is what happens
after: a binary on a device that is not yours.

Decide the version numbers with [`versioning`](../versioning/SKILL.md) **before** starting —
this file assumes `expo.version` is already set and the version gate is clean. That gate is
the first command of every release:

```bash
node .claude/scripts/version-check.mjs
```

**Windows and macOS both work here.** EAS builds on its own macOS and Linux machines, so an
iOS build and an App Store submission need no Mac and no Xcode. That is the whole reason this
repo uses EAS Build and Submit rather than Fastlane.

---

## 0 · Once per project

None of this is per-release. Do it once, in this order, and commit what it writes.

```bash
npm i -g eas-cli
```

```bash
eas login
```

```bash
eas init
```

```bash
eas update:configure
```

`eas init` creates the EAS project and writes `extra.eas.projectId` into `app.json`.
`eas update:configure` writes `expo.updates.url`, without which the channels declared in
`eas.json` resolve to nothing.

Then signing. Let EAS hold the credentials — a certificate on one laptop is how a team
discovers it cannot ship while that person is on leave:

```bash
eas credentials
```

| Platform       | What EAS needs                                  | Where it comes from                                                           |
| -------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| iOS build      | Distribution certificate + provisioning profile | EAS generates them from your Apple account                                    |
| iOS submit     | **App Store Connect API key** (`.p8`)           | App Store Connect → Users and Access → Integrations                           |
| Android build  | Upload keystore                                 | EAS generates it — **back it up**; a lost upload key needs Google to reset it |
| Android submit | Play service account JSON                       | Google Cloud, in the project linked to Play Console                           |

Two things EAS cannot create for you, both one-time and both manual:

- **The App Store Connect app record.** Create the app in App Store Connect with the same
  bundle identifier as `ios.bundleIdentifier` in `app.json`, then put its Apple ID number into
  `eas.json` as `submit.production.ios.ascAppId`.
- **The first Play Store upload.** Google requires the first `.aab` to be uploaded by hand in
  the Play Console. Every upload after that can be `eas submit`.

Prefer the ASC API key over an app-specific password. The password belongs to one human and
expires; the key is a project credential and works unattended in CI.

---

## 1 · Which build am I making?

Four profiles in [`eas.json`](../../../eas.json), and picking the wrong one wastes twenty
minutes of build time.

| Profile       | Produces                                 | Use it for                                                              |
| ------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `development` | dev client, internal distribution        | day-to-day work against a dev server, with native modules Expo Go lacks |
| `preview`     | installable build, internal distribution | putting a change in a colleague's hands without a store                 |
| `e2e-test`    | unsigned simulator build / apk           | Maestro in `.eas/workflows/e2e.yml`; never distributed                  |
| `production`  | App Store build / Play app bundle        | TestFlight, then the stores                                             |

```bash
eas build --platform all --profile production
```

`autoIncrement` on the profile plus `cli.appVersionSource: "remote"` means **EAS owns the
build number**. Do not set `ios.buildNumber` or `android.versionCode` anywhere — the version
gate fails on it, because a number left in `app.json` is ignored by EAS and becomes a stale
claim someone later reasons from.

---

## 2 · TestFlight

Submitting to App Store Connect is what puts a build in TestFlight. There is no separate
TestFlight upload step.

```bash
eas submit --platform ios --profile production --latest
```

What happens next, and how long each part really takes:

1. **Upload** — minutes.
2. **Processing** by Apple — usually 5 to 30 minutes. The build shows as "Processing" and
   cannot be tested yet. This is normal. Do not resubmit.
3. **Internal testers** — up to 100, all of whom must be on your App Store Connect team — get
   it immediately after processing, with no review.
4. **External testers** — up to 10,000 — need **Beta App Review** first. Roughly a day on the
   first submission of a version, usually faster afterwards; a new build of an
   already-reviewed version often skips it.

Two things stall a first TestFlight upload, both avoidable:

- **Export compliance.** Answer it once in `app.json` via
  `ios.config.usesNonExemptEncryption` so nobody is prompted on every upload. Setting it to
  `false` is a legal statement that the app uses nothing beyond standard HTTPS — read it
  rather than copying it.
- **A missing test information block.** Beta App Review needs a description and a contact
  email in App Store Connect, and rejects without them.

---

## 3 · Google Play

```bash
eas submit --platform android --profile production --latest
```

The submit profile in `eas.json` sends it to the `internal` track as a **draft**,
deliberately, so a mistaken submit cannot become a live release. Promote it in the Play
Console when you mean to: internal → closed → open → production.

Let Play App Signing hold the app signing key and EAS hold the upload key. That combination
survives a lost laptop; a self-managed signing key does not.

---

## 4 · Store review — what actually gets rejected

All of this is checkable long before you submit, so read it at spec time rather than after a
rejection. Most of it is checkable **automatically** — run the compliance scan first and work from
its output rather than from this table alone:

```bash
npm run compliance        # greenlight preflight .
```

[`greenlight`](../greenlight/SKILL.md) owns that scan and the triage. It runs on every pull request
already, and the production pipeline gates `submit_ios` / `submit_android` on a scan of the built
`.ipa` and `.aab` — so a non-compliant binary cannot reach TestFlight or Play from
[`release-production.yml`](../../../.eas/workflows/release-production.yml). Note what a pass does not
buy you: **GREENLIT means no CRITICAL or HIGH findings in a static scan, not that the store will
approve the release.** The rows below that a scanner cannot see — the questionnaire, screenshots, the
demo account — are still yours.

| Requirement                                                         | Where it lives                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Privacy policy URL                                                  | [`store.config.json`](../../../store.config.json), and both consoles |
| **Data collection questionnaire** — every category the app collects | App Store Connect; Play Data Safety form                             |
| Screenshots for each required device size                           | both consoles                                                        |
| Age rating                                                          | both consoles                                                        |
| Each permission's purpose string, in plain language                 | `app.json`, under `ios.infoPlist` and `android.permissions`          |
| An in-app account deletion route, if the app has accounts           | the app itself — Apple requires it                                   |
| A demo account, if anything sits behind a login                     | App Store Connect review notes                                       |

For an app handling health or personal data the questionnaire is the part most often wrong,
because it gets filled in by whoever is submitting rather than by whoever wrote the code.
Answer it from the code: what does the app actually send, and where to. The
[`dast-scan`](../dast-scan/SKILL.md) skill's mitmproxy procedure is how you find that out
instead of assuming it.

---

## 5 · OTA update, or a new build?

[`versioning`](../versioning/SKILL.md) section 5 owns this decision. In one line: JavaScript,
styles, copy and already-bundled images can go over the air; a native dependency, a config
plugin, a permission string, an `app.json` field that reaches the native project, and an SDK
upgrade all need a build.

```bash
eas update --branch production --message "fix: retry a failed sync"
```

The `fingerprint` runtime policy enforces that mechanically — a native change moves the
fingerprint, so older builds stop matching and the update never reaches them. That is the
policy earning its cost, not a bug to work around.

**Store policy still applies.** An OTA update may fix bugs and adjust content; both stores
take a dim view of one that materially changes what the app does, or adds a feature that was
never reviewed. When in doubt, ship a build.

---

## 6 · When it goes wrong

| Symptom                               | Cause, nearly always                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Build number already used"           | `appVersionSource` is `local`, or two builds went out from different machines. Switch to `remote`.                                                          |
| An OTA update never arrives           | The channel is not mapped to a branch, or the runtime fingerprint moved. Check with `eas channel:view production`.                                          |
| A bad update reached users            | `eas update:rollback`, or republish the previous update to that branch. Rolling back beats building.                                                        |
| An update installed and the app broke | `expo-updates` rolls back to the last working update after a failed launch. Users still had a broken launch — treat it as an incident and write the intent. |
| An iOS build fails only on EAS        | A native dependency missing from `package.json`, or a config plugin that needs prebuild. Read the whole log with `eas build:view <id>`.                     |
| "Invalid binary" on submission        | Almost always a missing usage-description string for a permission the binary declares.                                                                      |

`eas build:list` and `eas build:view <id>` are the two commands worth knowing by heart. The
full log says what a summary cannot.

---

## 7 · The release itself

1. Run the version gate. Clean before anything else.
2. Follow [`versioning`](../versioning/SKILL.md) section 4: decide the bump, set
   `expo.version`, update [`CHANGELOG.md`](../../../CHANGELOG.md) with what changed for a
   **user**, commit `chore(release): x.y.z`, and tag `vx.y.z`.
3. Build both platforms on the `production` profile — or push the tag and let
   [`release-production.yml`](../../../.eas/workflows/release-production.yml) do it.
4. Submit both platforms.
5. Verify the build **in TestFlight on a real device** before promoting it. A simulator does
   not exercise signing, push, or the store's own install path.
6. Promote: TestFlight → App Store, Play internal → production.

**Gate:** the tag exists, the changelog says what a user gets, and someone has installed the
build from the store on a device that did not build it.

> `.eas/workflows/release-production.yml` has not yet been run against EAS from this repo —
> its own header says so. Validate it with `eas workflow:validate` before relying on it. Until
> then the CLI path above is the verified one.
