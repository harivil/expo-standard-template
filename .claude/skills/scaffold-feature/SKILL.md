---
name: scaffold-feature
description: Write a screen, route, tab, shared component, or hook the way this Expo app does it. Use when building any UI or app code here — file placement, routing, props, styling, theming, platform splits, tests.
---

# Scaffold a feature

This app's conventions for writing code, and where each file belongs. It is stage 4 of the
**`feature-loop`** skill — that file owns the surrounding lifecycle (spec, plan, verify, review,
ship); this one owns the code.

Claude Code and Codex both run this file, and `AGENTS.md` gives each the same Expo skills and the same
Expo MCP server. Where a step names a plugin skill, reach for it when installed. The `references/`
files beside this one carry the same ground independently, so the procedure holds on a machine where
setup was skipped.

---

## 0 · Orient

Expo changes hard between major versions, and a confidently-recalled API is often a stale one.
Establish ground truth before writing anything.

- Read `package.json` — the `expo` version, and the **actual** `scripts` available.
- Read `app.json` (or `app.config.ts`) — `experiments.typedRoutes`, `newArchEnabled`, `scheme`.
- Find where routes live: the folder containing `_layout.tsx`. It is either `app/` or `src/app/`.
  Everything below writes `<root>/` for the parent of that folder — `src/` when the project uses it,
  the repo root otherwise.
- Read the docs **for the SDK you found**. With the Expo MCP server connected, search and fetch
  through it — it serves the version-correct page directly. Without it, use the pinned URL in
  `AGENTS.md`.

Adding a package is part of this step, not an afterthought: install with `npx expo install <pkg>`,
never `npm install`, so the version stays compatible with the SDK. A hook blocks the wrong form.

**Done when:** you have stated the SDK version and the route folder.

---

## 1 · Place the files

Decide every path before creating any of them — a file written into the wrong folder is cheap to
avoid now and expensive to move later.

→ **`references/placement.md`** — the decision table for where each kind of file lives.

The `expo-project-structure` skill carries the fuller rationale.

**Done when:** you can list every file the change needs, by full path, including its test.

---

## 2 · Route file

A file in the routes folder **is** a URL. Keep that folder to routes only, and keep each route thin:
it reads params and route-level concerns, then renders a body that lives elsewhere.

```tsx
import { Settings } from "@/screens/settings";

export default function SettingsScreen() {
  // route-level concerns only — params, redirects
  return <Settings />;
}
```

Routes use `export default`; everything else in the app uses named exports.

A new tab also needs registering in its `_layout.tsx`, and a new route users navigate to needs a
`<Link>` pointing at it — a route nothing links to is unreachable.

→ **`references/route-and-navigation.md`** — layouts, groups, dynamic segments, typed routes, links,
tabs, external URLs. The `expo-router` skill covers navigation in more depth.

**Done when:** the route is reachable by tapping through the UI, not merely present on disk.

---

## 3 · Screen body and components

Write the UI in `<root>/screens/` (screen bodies) or `<root>/components/` (anything reused).
Filenames are kebab-case; exports are named; props are a `type`; the `StyleSheet.create` object sits
at the bottom of the file.

Read colours from the theme rather than pinning them, so light and dark both work without editing the
screen. This is the single most common review finding in a universal app.

→ **`references/component-and-styling.md`** — props, styling, theming, platform variants. The
`expo-ui` skill covers the native component set when you want platform-native controls.

**Done when:** the component renders on iOS, Android, and web.

---

## 4 · Tests

Cover the logic you added. A pure helper, a hook, or a component with real branching earns a test; a
thin route file does not — running the app covers that.

Write the failing test first, watch it fail, then make it pass. The `tdd` skill drives this step.

Never edit a test to make a fix pass. When a test is wrong, that is its own change with its own
reasoning — and review will ask why the test moved.

→ **`references/testing.md`** — file placement, what to assert, what to mock.

**Done when:** the test fails without your change and passes with it.

---

## Next

Proving it works is the **`verify-app`** skill — static checks, then the app on every surface the spec
claims, in light and dark, with screenshots as evidence.

Committing, review and the PR are stages 6 and 7 of **`feature-loop`**.

---

## Cross-platform

This team works on Windows and macOS. Commands in this repo are `npm` and `npx` only, and paths are
written with forward slashes — both behave identically on either machine.
