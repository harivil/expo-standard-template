---
name: design-system
description: Design a screen for this Expo app before writing it — tokens from src/constants/theme.ts, component variants, native platform conventions, light and dark, accessibility, and the phone-to-desktop widths web adds. Use when designing or reviewing a screen's look, adding a colour, spacing or type value, extracting a repeated view into a shared component, or when screens have drifted out of step with each other.
---

# Design

Stage 3.5 of [`feature-loop`](../feature-loop/SKILL.md): after the plan names the files, before
[`scaffold-feature`](../scaffold-feature/SKILL.md) writes them. It exists because the failures
it prevents are the ones that are cheap now and expensive later — a colour that breaks dark
mode, a spacing value that makes one screen not match its neighbour, a tap target nobody can
hit.

The rule underneath all of it: **the design lives in
[`src/constants/theme.ts`](../../../src/constants/theme.ts), not in the screen.** A screen composes tokens. When a
screen needs a value the tokens do not have, that is a decision about the design system, made
deliberately and once — not a literal typed into a component.

---

## 1 · Answer these before drawing anything

Five questions. Answering them wrong is what produces a screen that has to be rebuilt.

| Question                                         | Why it changes the design                                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Which surfaces?** iOS, Android, web            | The spec already answered it. Web means a desktop width exists; native means platform conventions apply.                                                       |
| **What are the states?**                         | Empty, loading, error, offline, no permission, very long content. Every one of these is a design, and the happy path is the one that gets designed by default. |
| **Is this a new pattern, or an existing one?**   | A second way to do the same thing is the most expensive thing you can add. Search first.                                                                       |
| **What is the primary action?**                  | Exactly one per screen, and it should be obvious without reading.                                                                                              |
| **Does any of it hold personal or health data?** | Changes what may appear on a lock-screen notification, in a screenshot, or in a list someone else can see over a shoulder.                                     |

**Design the empty and error states in the same pass as the happy path.** They are the states
a builder is least likely to reach for, so a spec that does not name them ships without them —
and the `verifier` agent hunts for exactly this.

---

## 2 · Tokens, and when to add one

Everything visual comes from [`src/constants/theme.ts`](../../../src/constants/theme.ts):

| Token group                    | Holds                                 | Rule                                                                                                                                          |
| ------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Colors.light` / `Colors.dark` | every colour, by role                 | **Identical keys in both.** A key in one and not the other renders `undefined`, which is an unstyled element. There is a test asserting this. |
| `Spacing`                      | a four-point scale                    | Padding, gaps and margins come from here. A raw `13` is how two screens stop matching.                                                        |
| `Radius`                       | corner radii                          |                                                                                                                                               |
| `Typography`                   | size, line height and weight together | Never a bare `fontSize` — line height is what makes a paragraph readable, and it gets forgotten.                                              |
| `ContentMaxWidth`              | the widest a column goes              | Web only in effect, but it lives with the rest.                                                                                               |

Colours are named by **role, not by appearance**: `textMuted`, `border`, `danger` — never
`grey400` or `lightBlue`. A role survives a rebrand and reads correctly in dark mode; an
appearance name becomes a lie the first time the palette changes.

Adding a token is a real change:

1. Check no existing token means the same thing. Two names for one colour is the beginning of
   drift.
2. Add it to **both** palettes, and check the dark value against a dark background rather than
   guessing at it.
3. Check the contrast — see section 5.
4. Say in the PR why the existing tokens did not cover it.

ESLint fails the build on a hex literal outside `src/constants/theme.ts`, so this is enforced rather than
requested.

---

## 3 · When a view becomes a component

The threshold, and the reason for it:

| Situation                                        | Do                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Used once                                        | Leave it inline in the screen.                                                            |
| Used twice                                       | Leave it, unless the two are genuinely the same thing rather than coincidentally similar. |
| Used three times, or twice with the same meaning | Extract to `src/components/<name>.tsx`.                                                   |
| Screen body has grown past a screenful           | Split into parts beside it in `src/screens/<slug>/`.                                      |

Premature extraction costs more than duplication: a component built from one use site encodes
that site's assumptions, and the second caller then adds a prop that turns it into a
configuration surface nobody wanted. Two similar blocks are cheaper to read and cheaper to
change.

Component APIs in this app follow one shape — variant, size, state — and
[`component-and-styling`](../scaffold-feature/references/component-and-styling.md)
carries the mechanics. The design part is the naming:

- **Variants are semantic**: `primary` / `secondary`, `default` / `muted` / `danger`. Not
  `blue` / `outlined`.
- **A boolean prop that switches appearance is usually a missing variant.** `isBig` and
  `isSmall` become `size`.
- **The default variant is the common case**, so the common call site passes nothing.

`Screen`, `ThemedText`, `ThemedView` and `Button` already exist. Compose them before writing a
fifth primitive.

---

## 4 · Native conventions

The app should feel like it belongs on each platform, which is not the same as looking
identical on both.

|                     | iOS                                               | Android                                        |
| ------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Back                | swipe from the left edge, plus a header back item | system back gesture and button — **must** work |
| Primary navigation  | bottom tabs                                       | bottom tabs (or a nav bar)                     |
| Modal               | sheet, with a grabber                             | full screen or dialog                          |
| Destructive confirm | action sheet                                      | dialog                                         |
| Typography          | dynamic type, San Francisco                       | Roboto                                         |

The `expo-ui` and `expo-native-ui` plugin skills carry the platform component sets. Reach for a
real native control before styling a `View` to look like one — a rebuilt switch is never quite
right, and it will not match the platform when the OS updates.

**Minimum tap target is 44×44.** `Button` enforces it; anything else pressable needs checking,
and an icon-only control is where it is nearly always missed. On web, check the same control
with a mouse: `onPress` translates, but hover and cursor do not come for free.

---

## 5 · Light, dark, and contrast

Both modes are first-class. The system flips them, and nobody is going to design a second set
of screens.

- Read colours through `useTheme()`. That is the whole mechanism.
- **Look at both** before calling it done, on device or in a simulator. Fifteen seconds, and it
  catches a class of review finding on its own.
- Body text needs **4.5:1** against its background; large text and UI borders need **3:1**.
  Check the dark palette separately — a colour that passes on white frequently fails on near
  black, which is why `tint` differs between the two palettes here.
- Never carry meaning in colour alone. A red border needs a message beside it; a colour-blind
  user and a screenshot in grayscale see the same thing.

---

## 6 · Web is a different shape, not a smaller one

Every screen is also a web page, and `react-native-web` diverges quietly.

- **Give content a max width and centre it.** `Screen` does this via `ContentMaxWidth`; a
  screen that bypasses `Screen` needs to do it itself, or a phone layout stretches across a
  monitor.
- Check one narrow and one wide width. There is no tablet-versus-phone breakpoint system here
  on purpose — a max width plus a wrapping row covers nearly everything without one.
- Shadows, `Platform.select` defaults, gesture handling and anything measuring layout are the
  four places web behaves differently. Test them, do not reason about them.

---

## 7 · Before handing it to the builder

- Every state named, not only the happy path.
- Every colour, space and type value traced to a token — or a new token justified in writing.
- Both appearance modes considered, and contrast checked on the dark palette too.
- Native conventions respected per platform, using real controls.
- Tap targets at least 44×44, including icon-only ones.
- The web width answered.
- Nothing duplicating a component that already exists.

Then [`scaffold-feature`](../scaffold-feature/SKILL.md) writes it, and
[`verify-app`](../verify-app/SKILL.md) checks it on every surface in both modes.
