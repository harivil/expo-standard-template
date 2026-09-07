# Review instructions

The policy the `change-reviewer` agent applies, and the bar a human reviewer holds to. It exists so
every change gets the same review rather than whichever review its reviewer had time for.

## Passes

Run three, and tag every finding with its pass.

- **Bugs** — logic errors, broken edge cases, subtle regressions.
- **Security** — secrets in the diff, personal or health data reaching logs, error messages or URLs,
  data crossing to a third party, permission strings not updated, `EXPO_PUBLIC_` on something that
  should stay private. The scanners in `.github/workflows/security.yml` cover the mechanical half;
  read the diff for what a pattern cannot see — a check in the wrong order, an authorisation decision
  made on the client, a record fetched wider than the screen needs.
- **Compliance** — does the diff deliver `docs/specs/<slug>.md`'s acceptance criteria, stay inside
  its "out of scope", and match `docs/plans/<slug>.md`? Where it departs from the plan, was the plan
  updated in the same commit?

## What Important means here

Reserve **Important** for a finding that would break behaviour, leak data, breach a policy, or ship a
feature that does not do what its spec says. Everything else is a **Nit**.

Naming, formatting, and import order are always nits — prettier and eslint own those, and a human
arguing about them is spending attention the process exists to protect.

## Cap the nits

Report at most five nits. Summarise the rest as a count. A review of forty nits and one real bug
hides the bug.

## This app's recurring findings

Check these explicitly. Each has cost someone real time.

- A colour pinned in a component instead of read from the theme — dark mode breaks silently.
  ESLint now fails on a hex literal outside `src/theme.ts`, so this should only reach review as a
  non-hex colour (`rgba(...)`, a named colour) or a suppressed rule.
- The colour scheme read from `react-native` rather than from `@/hooks/use-color-scheme`, which is
  what narrows `"unspecified"` away.
- A route added without registering its tab, or with nothing linking to it — unreachable.
- A platform variant (`.web.tsx`, `.ios.tsx`) without its plain no-extension sibling — the other
  platforms fail to resolve the import.
- **A test edited to make a fix pass.** Always Important. Name which test moved and how. A test that
  existed before a fix and was not touched is what proves the bug is gone; a rewritten one proves
  nothing.
- An Expo package added via `npm install` rather than `npx expo install` — check `package.json` for a
  version inconsistent with the SDK.
- A screen that handles only the happy path — no empty, loading, error, or offline state.
- A UI change with no `.maestro/` or `e2e/web/` flow added or extended. `test-integrity.mjs` reports
  this; ask about it rather than assuming it was considered.
- An E2E flow selecting by visible copy (`text: "Continue"`) instead of by `testID` (`id:`). It
  passes today and breaks on the next wording change, which is how a suite gets disabled.

## Do not report

- Generated paths: `node_modules/`, `.expo/`, `android/`, `ios/`, `dist/`, `build/`, `coverage/`,
  `expo-env.d.ts`.
- Anything CI already enforces — formatting, lint rules, type errors. If CI is green, it is not a
  finding.
- Style preferences the codebase does not state anywhere.

## Approval

Findings do not approve or block on their own. A human code owner approves the merge, informed by the
findings. The agent that wrote the code has no route to approve it, and neither does the reviewer.

## Keeping this file honest

When the same finding appears across three changes, it stops being a review finding and becomes
either a line in `AGENTS.md`, a rule in the relevant skill, or a hook. Move it, and delete it from
here. A review policy that only grows is one nobody finishes reading.
