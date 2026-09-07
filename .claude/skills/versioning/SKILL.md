---
name: versioning
description: Decide and change version numbers for this Expo app — app version, build numbers, runtimeVersion for OTA updates, and the commit convention that drives them. Use when cutting a release, bumping a version, changing native code, or when a store rejects a build number.
---

# Versioning

A web app has one version. This app has **four**, with four different owners, and nothing in the
toolchain makes them agree.

| Number                | Where                       | Owner        | Changes when                   |
| --------------------- | --------------------------- | ------------ | ------------------------------ |
| `version`             | `app.json` → `expo.version` | **you**      | you ship a user-facing release |
| `ios.buildNumber`     | EAS (remote)                | **EAS**      | every build                    |
| `android.versionCode` | EAS (remote)                | **EAS**      | every build                    |
| `runtimeVersion`      | `app.json`                  | **a policy** | native code changes            |

`package.json`'s `version` is a fifth, and it reaches nothing — no store ever sees it. Keep it in
step with `expo.version` for sanity, not because anything depends on it.

Check them with:

```bash
node .claude/scripts/version-check.mjs
```

It runs in CI and fails on a real inconsistency. Run it before a release.

---

## 1 · Let EAS own the build numbers

```json
{
  "cli": { "appVersionSource": "remote" },
  "build": { "production": { "autoIncrement": true } }
}
```

Recommended from EAS CLI 12.0.0 onwards, and the reason is prosaic: both stores reject a submission
that reuses a build number, and a human incrementing an integer before every upload will eventually
forget. EAS keeps the counter server-side and increments it per build.

**With `remote`, delete `ios.buildNumber` and `android.versionCode` from `app.json`.** EAS ignores
them, so a number left behind is not config — it is a stale statement that someone will later read
and believe. `version-check.mjs` fails on this.

## 2 · `runtimeVersion` — the one that can break a live app

A build has two layers: **native code**, frozen at build time, and the **JavaScript bundle**, which
EAS Update can swap out afterwards. `runtimeVersion` is the contract between them. An update is only
delivered to a build carrying the same runtime version.

Get it wrong and you push JavaScript calling a native module that is not in the binary. `expo-updates`
will usually detect the failure and roll back to the last working update rather than crash outright —
but your users have already had a broken launch, and the rollback is a mechanism you would rather
never exercise.

```json
{ "expo": { "runtimeVersion": { "policy": "fingerprint" } } }
```

| Policy                        | Runtime derives from                         | Verdict                                                              |
| ----------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| **`fingerprint`**             | everything that actually affects native code | **use this**                                                         |
| `appVersion`                  | `expo.version`                               | works, until someone changes native code without bumping the version |
| `sdkVersion`, `nativeVersion` | superseded                                   | migrate off                                                          |
| a literal string              | you, by hand                                 | every native change needs a manual bump you will forget              |

`fingerprint` costs more builds — adding a native dependency changes the fingerprint, so old builds
stop receiving updates and need rebuilding. That is the correct behaviour, stated as a cost. The
alternative is shipping an update to a binary that cannot run it.

**A native change is not only a new package.** It also includes: a config plugin, a permission
string, an `app.json` field that reaches the native project, a new asset bundled at build time, and
an SDK upgrade.

## 3 · What bumps the user-facing version

Conventional Commits carry the intent, so the bump follows from the log rather than from memory:

| Commits since the last release | Bump  | Example       |
| ------------------------------ | ----- | ------------- |
| any `feat:`                    | minor | 1.2.0 → 1.3.0 |
| only `fix:`, `perf:`           | patch | 1.2.0 → 1.2.1 |
| any `!` or `BREAKING CHANGE:`  | major | 1.2.0 → 2.0.0 |

`commitlint.config.js` enforces the format at commit time, so the log stays queryable:

```bash
git log --oneline "$(git describe --tags --abbrev=0)..HEAD"
```

**A human decides the release version.** Semver for a mobile app is a marketing signal as much as a
technical one — a small change to a screen everyone uses may deserve a minor bump that the commit
types would not have suggested. Automate the count; keep the decision.

## 4 · Cutting a release

1. `node .claude/scripts/version-check.mjs` — clean before you start.
2. Read the commits since the last tag and decide the bump.
3. Set `expo.version` in `app.json`, and match it in `package.json`.
4. Update `CHANGELOG.md` — what changed for a **user**, not the commit subjects.
5. Commit: `chore(release): 1.3.0`.
6. Tag: `git tag v1.3.0 && git push --tags`.
7. Build. EAS increments the build numbers; you do not touch them.

## 5 · OTA update, or a new build?

The question this whole page exists to answer.

| Change                                           | Ship how               |
| ------------------------------------------------ | ---------------------- |
| JavaScript, styles, copy, images already bundled | **OTA** — `eas update` |
| A new native dependency                          | **build**              |
| A config plugin, or a permission string          | **build**              |
| An `app.json` field reaching the native project  | **build**              |
| An SDK upgrade                                   | **build**              |

Under the `fingerprint` policy you do not have to adjudicate this by hand: a native change moves the
fingerprint, older builds stop matching, and the update simply does not reach them. That is the
policy earning its cost.

**Store policy still applies.** An OTA update may fix bugs and adjust content; both stores take a dim
view of one that materially changes what the app does or adds features that were never reviewed. When
in doubt, ship a build.

## 6 · When a store rejects a build number

Nearly always the same cause: `appVersionSource` is `local` and someone forgot to increment, or two
builds went out from different machines. Switch to `remote` and the class of problem disappears.

The one number you can never reuse or lower is the build number — `android.versionCode` in
particular must increase monotonically, forever. There is no way to walk it back, so a mistakenly
large value is permanent.
