# Where does this file go?

`<root>` is the parent of the routes folder — `src/` when the project uses it, the repo root
otherwise. Step 0 of `SKILL.md` establishes which.

| What you're adding                       | Where it goes                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| A route                                  | `<root>/app/<slug>.tsx`                                                  |
| A layout for a group of routes           | `<root>/app/<group>/_layout.tsx`                                         |
| A server API route                       | `<root>/app/api/<name>+api.ts`                                           |
| Server-only helpers                      | `<root>/server/<name>.ts`                                                |
| A screen's body, plus parts only it uses | `<root>/screens/<slug>/index.tsx`, sub-components beside it              |
| Reusable UI                              | `<root>/components/<kebab-name>.tsx`                                     |
| Reusable UI that grew                    | `<root>/components/<name>/index.tsx` + its private parts in that folder  |
| A hook                                   | `<root>/hooks/use-<name>.ts`                                             |
| A pure helper                            | `<root>/utils/<name>.ts`, with `<name>.test.ts` beside it                |
| Design tokens (colours, spacing, fonts)  | `<root>/theme.ts`                                                        |
| Other shared constants                   | `<root>/constants.ts`                                                    |
| A platform variant of any of the above   | a sibling file: `<name>.web.tsx`, `<name>.ios.tsx`, `<name>.android.tsx` |
| Images, fonts, icons                     | `assets/` at the repo root — outside `<root>/`                           |
| Build and tool config                    | repo root: `app.json`, `eas.json`, `package.json`, `tsconfig.json`       |

## The routes folder is routes only

Every file under `app/` becomes a URL, so a component parked there silently becomes a navigable
screen. Give shared UI a home in `components/` and screen bodies a home in `screens/`, and let each
route file stay thin.

`screens/` exists for exactly this reason: a screen that has grown big enough to split into parts
has nowhere to put those parts inside `app/`. Move the body to `screens/<slug>/index.tsx` and let
the route render it. A bonus is that the same screen can then be rendered under more than one route.

## Import paths

`tsconfig.json` aliases `@/*` to the `<root>` folder. Import through the alias for anything outside
the current folder, and use a relative `./name` for a sibling:

```tsx
import { Settings } from "@/screens/settings";
import { Button } from "@/components/button";
import { Row } from "./row";
```

Platform variants are imported **without** their extension — `@/components/bar-chart` resolves to
`bar-chart.web.tsx` on web and `bar-chart.tsx` everywhere else. Metro picks the file.

## Naming

- Files and folders: kebab-case — `bar-chart.tsx`, `use-color-scheme.ts`.
- Components and hooks inside them: PascalCase and `useCamelCase` as usual.
- Routes: the filename is the URL segment, so `settings.tsx` → `/settings`. Keep it lowercase.

## Moving to `src/`

Expo Router reads either `app/` or `src/app/`. To switch, move the folder and restart the bundler,
then update the `@/*` alias in `tsconfig.json` to match. Do this once, early, as its own commit —
not partway through a feature.
