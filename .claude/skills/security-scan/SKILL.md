---
name: security-scan
description: Run and triage static security analysis for this Expo app — Semgrep, CodeQL, ESLint security rules, secret and dependency scanning. Use before a PR touching auth, storage, network or personal data, when a scan reports a finding, or when adding a security rule.
---

# Security scanning

Five layers, each catching what the one before it cannot. They are cumulative, not alternatives.

| Layer          | Tool                             | Catches                                              | Runs                             |
| -------------- | -------------------------------- | ---------------------------------------------------- | -------------------------------- |
| While you type | `security-guidance` plugin hooks | injection, XSS, SSRF, hardcoded secrets, ~25 classes | on every edit                    |
| On save / lint | **ESLint security plugins**      | unsafe regex, `eval`, object injection, RN-specific  | `npm run lint`, pre-commit       |
| Pattern SAST   | **Semgrep** + `.semgrep.yml`     | this stack's own rules + OWASP packs                 | CI, every PR                     |
| Semantic SAST  | **CodeQL**                       | dataflow across files — taint from input to sink     | CI, every PR _(cost note below)_ |
| Deep review    | `claude-security` plugin         | logic flaws no pattern expresses                     | on demand, before a release      |

Secrets (gitleaks) and dependencies (`npm audit`, `expo-doctor`) run alongside in the same workflow.

---

## Running it locally

**Semgrep is a Python tool**, so it is the one exception to this repo's "everything through npm"
rule. It is not needed to work on the app — CI runs it regardless — but it is worth having:

```bash
pipx install semgrep          # or: pip install semgrep, brew install semgrep
semgrep scan --config .semgrep.yml --config p/typescript --config p/secrets .
```

No Python? Docker works identically on Windows and macOS:

```bash
docker run --rm -v "${PWD}:/src" semgrep/semgrep semgrep scan --config /src/.semgrep.yml /src
```

Everything else is npm-native:

```bash
npm run lint          # ESLint, including the security plugins
npm audit --audit-level=high
npx expo-doctor
```

CodeQL does not run locally in any convenient form. Let CI do it.

## ESLint security configuration

Merge into `eslint.config.js` — `eslint-config-expo` does not include these:

```js
const security = require("eslint-plugin-security");

module.exports = defineConfig([
  // …existing expo config…
  security.configs.recommended,
  {
    rules: {
      // Fires on every Colors[theme] style lookup. Semgrep and CodeQL cover real
      // injection properly; leaving this on trains people to ignore the linter.
      "security/detect-object-injection": "off",
      "security/detect-unsafe-regex": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-fs-filename": "off", // no fs in a React Native app
    },
  },
]);
```

```bash
npx expo install -- -D eslint-plugin-security
```

---

## This repo's own rules

`.semgrep.yml` holds 11 rules for what the generic packs do not know: an Expo app handling
health data. They cover personal data reaching logs or URLs, `EXPO_PUBLIC_` names holding
secrets, tokens in `AsyncStorage` instead of `expo-secure-store`, plaintext HTTP, dynamic
WebView injection, unchecked deep-link parameters, and cleartext traffic in `app.json`.

**Every rule is tested.** `.semgrep-tests/` holds fixtures annotated with `// ruleid:` for a
must-fire case and `// ok:` for a must-not-fire case:

```bash
node .claude/scripts/semgrep-test.mjs
```

The suite also fails when a rule has no fixture at all, because an unfired rule protects
nothing. Both directions matter: a rule that fires on safe code gets muted within a week,
which is worse than never having written it.

**Adding a rule:** write the fixture first — the failing case and the safe case — then the
rule, then watch the fixture go green. A rule should have cost someone real time or protect
data that would be expensive to leak. A rule that fires on style is a rule people learn to
ignore, and it takes the real findings down with it.

## Triage

Work findings in this order, because it is cheapest first:

1. **Is it real?** Semgrep patterns and CodeQL taint tracking both produce false positives.
   Read the code, not just the message.
2. **Is it reachable?** A pattern in a test fixture or an unreferenced file is noise. Reachable
   from a user action, a deep link, or a network response is not.
3. **What is the blast radius?** Personal or health data, credentials, and anything crossing to
   a third party outrank everything else.
4. **Fix, or suppress with a reason.** Never suppress silently:

```ts
// nosemgrep: insecure-http-request -- local dev server only, never reached in a release build
```

A suppression with no reason is a finding someone will re-discover in six months and re-argue.
An unexplained one is a review finding in its own right.

## A secret in the diff

Deleting the line is not enough — git history keeps it, and anyone with a clone has it.

1. **Rotate the credential first.** Before the cleanup, before the PR.
2. Then remove it from the code and read it from the server or `expo-secure-store`.
3. Tell whoever owns the credential that it was exposed and when.

`EXPO_PUBLIC_*` deserves its own warning: those values are **inlined into the JS bundle** and
readable by anyone who downloads the app. It is not a secret store with an awkward name.

---

## SCA — dependencies

Three tools, and the third is the one people get wrong.

```bash
npm audit --audit-level=high   # known CVEs in the tree
npx expo-doctor                # versions match the SDK, and the tree is sane
npx expo install --check       # which packages have drifted from the SDK
```

**Dependabot must not bump Expo-governed packages.** An Expo SDK version-governs `expo`, `react`,
`react-native`, and every `expo-*`, `react-native-*` and `@expo/*` module through its bundled
native-modules map. A PR bumping `expo-camera` to its latest release is not an upgrade, it is a
desynchronisation: it passes `npm audit`, passes unit tests, then fails `expo-doctor` — or builds
fine and crashes on a device nobody was testing.

`.github/dependabot.yml` therefore ignores all of them by design, and owns only what sits outside
the SDK's control: dev tooling, test libraries, and GitHub Actions. Those packages move when the SDK
moves:

```bash
npx expo install --fix     # realign everything to the current SDK
```

An SDK upgrade is its own piece of work — use the `expo-upgrade` skill, not a dependency PR.

**Security alerts are a repository setting, not this file.** Turn on Dependabot alerts and security
updates in Settings → Code security. Those _do_ raise PRs for Expo packages when a real CVE lands —
which is correct, and each one still needs `expo-doctor` run against it before merge.

### Triaging a vulnerability alert

1. **Is it reachable?** A CVE in a transitive dev dependency that never runs in the app is not the
   same as one in a runtime package. `npm ls <package>` shows why it is in the tree.
2. **Does a fix exist at an SDK-compatible version?** For an Expo-governed package this is the
   binding constraint, not the latest release.
3. **If not:** record it. A known, documented, accepted risk with a date and an owner beats a silent
   one, and beats a bump that breaks the build.

## Secrets — gitleaks

Configured in `.gitleaks.toml`: the default ~150 rules plus Expo and EAS token patterns, Google API
keys, and `EXPO_PUBLIC_*` names that claim to hold secrets. The Semgrep fixtures are allowlisted —
they contain planted credentials on purpose, and a scanner that cries wolf on them teaches everyone
to pass `--no-verify`.

It runs in three places: a hook before every commit (`guard-secrets.mjs`), CI on every push, and
against full history on the weekly schedule.

```bash
gitleaks git --staged --redact       # what a commit would introduce
gitleaks git --redact                # the whole history
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest git /repo --redact
```

gitleaks is a Go binary, not an npm package, so it is fine for it to be absent locally — the hook
says so and lets the commit through rather than blocking on a missing tool.

## Cost: CodeQL

CodeQL is free on public repositories. On a **private** one it needs GitHub Code Security,
around **$30 per active committer per month** (~$49 under Enterprise). Billing is per committer
who pushes to a repo with it enabled.

If that is not budgeted, delete the `codeql` job from `.github/workflows/security.yml`. Semgrep
plus the ESLint plugins cover most of the same ground; what you give up is cross-file dataflow —
tracking a value from a deep-link parameter through three helpers into a `fetch`. That is a real
loss, and it is a budget decision rather than a technical one.

Do not leave the job failing. A red check nobody is able to fix is a check everybody learns to
scroll past, and it takes the useful ones with it.
