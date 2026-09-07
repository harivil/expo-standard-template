---
name: write-e2e
description: Write or extend an end-to-end flow for this Expo app — Maestro for iOS and Android, Playwright for web. Use when a feature adds a user journey, when a bug escaped unit tests, or when a PR touches UI and has no flow covering it.
---

# Write an E2E flow

Unit tests prove a function is right. Functional tests prove a screen behaves. **E2E is the only
layer that proves the app is usable**, because it is the only one with a real router, a real
navigation stack and a real device — `expo-router` is mocked to a stub under Jest, so anything about
reaching a route, passing params, or going back belongs here and nowhere else.

This app ships to three surfaces, and two tools cover them:

| Surface      | Tool           | Lives in            |
| ------------ | -------------- | ------------------- |
| iOS, Android | **Maestro**    | `.maestro/*.yaml`   |
| Web          | **Playwright** | `e2e/web/*.spec.ts` |

Maestro drives the app from outside through platform accessibility APIs, so it runs against any
binary EAS Build produces — no native project, no Xcode, no Mac.

**Detox is deliberately not used**, and the reason is not that it cannot work. With Continuous
Native Generation (`npx expo prebuild`) Detox does run against an Expo app; anyone who has used it
recently knows that, so it is worth being accurate about why this repo does not:

1. **It would break the Windows half of the team.** Detox drives iOS through Xcode's simulator
   tooling, so iOS flows become macOS-only, locally and in CI. EAS Workflows has `type: maestro` as
   a first-class job and no Detox equivalent — so the thing that gives Windows developers iOS
   coverage today ([`e2e.yml`](../../../.eas/workflows/e2e.yml)) would have to become a macOS runner
   somebody maintains.
2. **It forces prebuild into the repo.** Detox needs the native projects in order to add its test
   target and instrumentation. `/ios` and `/android` are gitignored here and `guard-write` blocks
   writes to them, because they are generated. The alternatives are committing them — losing CNG and
   turning every SDK upgrade into a merge — or prebuilding in CI before every run.
3. **It cannot touch web**, which is one of the three surfaces this app claims. Playwright would
   stay regardless, so the cost is three E2E tools and two selector dialects instead of two and one.
4. **New Architecture.** Detox is grey-box: it hooks React Native's internals to know when the app
   is idle. That is the layer the New Architecture changed, and SDK 57 has it on by default. Verify
   support at the exact version you would pin rather than trusting either project's docs.

Being fair to what is given up: that grey-box design is a real advantage. Detox knows when the app
has settled, so flows need no arbitrary waits and are less flaky in principle, tests are TypeScript
that can share fixtures with the Jest suite, and `device.*` can relaunch, grant permissions and
background the app. Maestro is black-box and less precise — which is exactly why it needs no native
access and runs on EAS's own hardware.

Revisit the decision only if a flow turns up that Maestro genuinely cannot drive **and** mac-only
iOS E2E is acceptable. Write down which flow, in an intent, rather than switching on preference.

---

## 1 · One `testID`, both tools

This is the detail that makes maintaining two E2E suites bearable. A React Native `testID` becomes:

- `accessibilityIdentifier` on iOS,
- `resource-id` on Android,
- `data-testid` in the DOM via `react-native-web`.

So a single prop is addressable from Maestro **and** Playwright:

```tsx
<Pressable testID="settings-save" accessibilityLabel="Save settings">
```

```yaml
- tapOn:
    id: "settings-save"
```

```ts
await page.getByTestId("settings-save").click();
```

Add the `testID` while writing the component, not while writing the test. Retrofitting means editing
production files from a test branch, which review will rightly question.

## 2 · Selector discipline — the whole flakiness story

Flaky E2E is nearly always a selector problem, not a timing one.

| Use                                 | Avoid                     | Why                                                                 |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| `id: "cart-checkout"`               | `text: "Checkout"`        | a copy change breaks the test and teaches people to ignore failures |
| `accessibilityLabel`                | index or position         | reordering a list should not fail a test                            |
| `assertVisible` on a stable element | `wait` with a fixed delay | a sleep is either too short (flaky) or too long (slow)              |

Text selectors are acceptable for content the test is _about_ — asserting an error message reads
correctly is the point of that assertion. They are not acceptable for navigation.

Maestro auto-waits on `assertVisible` and `tapOn`. Reach for `extendedWaitUntil` when something is
genuinely slow; never `- wait`.

---

## 3 · Maestro flows

Two YAML documents: the app id, then the steps.

```yaml
appId: ${APP_ID}
---
- launchApp:
    clearState: true
- assertVisible:
    id: "home-title"
- tapOn:
    id: "tab-settings"
- assertVisible:
    id: "settings-screen"
```

Conventions here:

- **One journey per file**, named for the journey: `.maestro/settings-toggle-theme.yaml`.
- **`clearState: true`** on launch, so a flow never depends on what the previous one left behind.
- **`${APP_ID}`** rather than a hardcoded bundle id — EAS injects it, and it keeps dev and CI the
  same file. Run locally with `maestro test -e APP_ID=<your.bundle.id> .maestro/<flow>.yaml`.
- Assert the **outcome**, not the tap. `tapOn` succeeding proves a button exists; `assertVisible` on
  what follows proves it worked.

Run one flow:

```bash
maestro test -e APP_ID=com.example.app .maestro/settings-toggle-theme.yaml
```

## 4 · Playwright, for web

```ts
import { test, expect } from "@playwright/test";

test("theme toggle persists across reload", async ({ page }) => {
  await page.goto("/settings");
  await page.getByTestId("settings-theme-toggle").click();
  await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.getByTestId("settings-screen")).toHaveAttribute("data-theme", "dark");
});
```

Web is not a free copy of the native flow. Test what only web can break: deep-linking straight to a
URL, browser back and forward, reload mid-flow, and a desktop-width viewport.

```bash
npx playwright test
```

---

## 5 · What earns a flow

E2E is the slowest, most expensive test you own. Spend it on journeys, not on units.

| Write a flow                                                      | Leave it to Jest                |
| ----------------------------------------------------------------- | ------------------------------- |
| A path a user actually takes end to end                           | A pure function's edge cases    |
| A bug that escaped unit tests                                     | A component's prop permutations |
| Anything crossing a boundary — nav, storage, network, permissions | A hook's return value           |
| The critical path: launch, sign in, the app's core action         | Styling                         |

**Every UI change adds or extends a flow in the same PR.** Not the full suite — the flow for the
journey it touched. `node .claude/scripts/test-integrity.mjs` reports when UI changed and no flow
did, and review asks about it.

When a bug escapes to production, its flow is the fix's proof: write it first, watch it fail, then
fix.

## 6 · In CI

EAS Workflows runs Maestro natively — `type: maestro` needs no custom plumbing. See
[`.eas/workflows/e2e.yml`](../../../.eas/workflows/e2e.yml): it builds with the `e2e-test` profile,
then runs the flows on a real emulator and simulator.

Full regression stays on a schedule, not on every PR — E2E is slow and a suite that adds ten minutes
to every push gets disabled. A feature's own flow runs on demand before merge; everything else runs
nightly.

Web runs in the ordinary CI job, since Playwright needs no device.

---

## 7 · Running these from Windows

Android works everywhere. iOS needs a simulator, and there is no iOS simulator for Windows.

- **Android, local:** works on Windows and macOS alike.
- **iOS, local:** macOS only.
- **iOS, from Windows:** either EAS Workflows runs it in CI, or the `eas-simulator` skill drives a
  cloud-hosted simulator — including screenshots, which also covers PR evidence. It is a **paid EAS
  feature**; treat it as a cost decision, not a default.
- **Web:** everywhere.

State which surfaces a flow was actually run on. A flow that has only ever run on Android is an
Android flow until someone runs it on iOS.
