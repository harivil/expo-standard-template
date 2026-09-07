# Testing

Jest with the `jest-expo` preset, and `@testing-library/react-native` for anything that renders.
Check `package.json` for the test script before running — step 0 of `SKILL.md` establishes it.

## Two layers, one toolchain

RNTL is a renderer and a set of queries running **on** Jest — not a second runner. So a unit test
and a functional test use identical tooling, and what separates them is a decision you make when
you start writing: **how much do I render, and what do I mock?**

|         | Unit                                 | Functional / integration                         |
| ------- | ------------------------------------ | ------------------------------------------------ |
| Renders | one hook, helper, or leaf component  | a whole screen body from `src/screens/<slug>/`   |
| Mocks   | nearly everything around the subject | only the edges — network, storage, permissions   |
| Asserts | a return value, or one branch        | user-visible behaviour across several components |
| Costs   | milliseconds                         | tens of milliseconds                             |
| Example | `hooks/use-color-scheme.test.ts`     | `screens/counter/index.test.tsx`                 |

Both are cheap, both run on every PR, and a screen with real branching deserves the second one.
Reach for it when a bug came from two components interacting correctly in isolation and wrongly
together — which is most of them.

**The boundary that catches people out: navigation is not testable here.** `jest.setup.js` mocks
`expo-router` down to a stub — `Link` renders as `Text`, `Stack` and `Tabs` render `null`, and the
hooks return empty. That is deliberate (there is no navigation container in a unit test), and it
means a functional test can render a screen but **cannot** prove a route is reachable, that params
arrive, or that back works. Those are E2E questions — Maestro and Playwright, via
[`write-e2e`](../../write-e2e/SKILL.md). A Jest test that appears to prove navigation is asserting
against the stub.

Mock at the edge, not in the middle. Mocking a component inside the screen you are testing removes
the interaction that was the reason to write a functional test at all.

## Where tests live

Beside the file they test, same name plus `.test`:

```
utils/format-date.ts
utils/format-date.test.ts
hooks/use-theme.ts
hooks/use-theme.test.ts
```

Colocation makes it obvious at a glance which files are covered and which are not — that visibility
is the point, so keep it rather than gathering tests into a distant folder.

## What earns a test

| Earns one                                  | Covered another way                                       |
| ------------------------------------------ | --------------------------------------------------------- |
| Pure helpers in `utils/`                   | Route files — thin by design; running the app covers them |
| Hooks with branching or state              | Pure layout with no logic                                 |
| Components that branch on props            | Styling — assert behaviour, not appearance                |
| A screen whose parts interact (functional) | Navigation between screens — stubbed under Jest; use E2E  |
| Anything a bug was just filed against      | Third-party library behaviour                             |

## Writing one

Assert what a user or caller observes. Query the way a person finds things — by text, by label, by
role — rather than by implementation detail.

**`render` and `renderHook` are async** in the installed React Native Testing Library (14.x).
Awaiting them is not optional — an un-awaited `render` returns a promise and every query then
fails on an empty tree:

```tsx
import { render, screen, userEvent } from "@testing-library/react-native";
import { Card } from "./card";

describe("Card", () => {
  it("shows the title it is given", async () => {
    await render(<Card title="Weekly summary" />);
    expect(screen.getByText("Weekly summary")).toBeTruthy();
  });

  it("calls onPress when tapped", async () => {
    const onPress = jest.fn();
    await render(<Card title="Weekly summary" onPress={onPress} />);
    await userEvent.press(screen.getByText("Weekly summary"));
    expect(onPress).toHaveBeenCalled();
  });
});
```

Hooks use `renderHook`, also awaited:

```tsx
const { result } = await renderHook(() => useTheme());
expect(result.current.background).toBe(Colors.light.background);
```

The jest matchers (`toHaveStyle`, `toBeDisabled`, `toHaveTextContent`) ship in the main entry.
The old `@testing-library/react-native/extend-expect` import no longer exists — importing it
fails the whole suite with a module-not-found.

Name tests as sentences describing the behaviour — `"returns the dark palette when the system is
dark"`. When it fails, the name alone should say what broke.

## Snapshots

Prefer explicit assertions. A snapshot passes for the wrong reasons and gets re-recorded without
being read; an assertion says what the code is supposed to do. Reach for a snapshot only when the
serialised output genuinely _is_ the contract.

## Mocking

Mock **your own** indirection, not the framework. If a component reads the colour scheme through
`@/hooks/use-color-scheme`, mock that hook — mocking `react-native` internals couples the test to a
version of React Native rather than to your app.

```tsx
jest.mock("@/hooks/use-color-scheme");
const mockUseColorScheme = useColorScheme as jest.MockedFunction<typeof useColorScheme>;
```

Three libraries cannot render under Jest without a mock, and `jest.setup.js` already carries
all three — read it before adding a fourth:

| Library                          | Why                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `expo-router`                    | reads a real navigation container, which no unit test has                                                                                                                                                                                        |
| `react-native-reanimated`        | needs its own shipped mock (`react-native-reanimated/mock`)                                                                                                                                                                                      |
| `react-native-safe-area-context` | insets come from a native provider; use the library's own mock via `require("react-native-safe-area-context/jest/mock").default` — **the `.default` matters**, the mock is a default export and without it `useSafeAreaInsets` is not a function |

Any component built on `Screen` uses safe-area insets, so that third one is needed far more
often than it looks. Keep test-specific mocks in the test that needs them.

## Config gotchas

Two things break a fresh Expo test setup, both in `jest.config.js`:

- **`transformIgnorePatterns`** — Expo packages ship untranspiled. The pattern must let
  `expo-*`, `react-native`, `@react-native`, `react-native-reanimated` and `react-native-worklets`
  through the transform, or the suite dies on an unexpected `import`.
- **`moduleNameMapper` order** — your own entries go _above_ any spread of the preset's map, or the
  preset's broader patterns win and yours never match. Non-JS imports (`.css`, images) need a stub
  mapped here.

## End-to-end

Unit tests cannot see a blank screen. For flows that matter — cold start, sign-in, the tab a feature
adds — write a Maestro flow under `.maestro/` and run it on demand:

```bash
maestro test -e APP_ID=<bundle id> .maestro/<flow>.yaml
```

Each flow is two YAML documents: the `appId`, then the steps.
