# Components and styling

## Shape of a component file

One component per file, named export, `function` declaration, styles at the bottom.

```tsx
import { StyleSheet, Text, View, type ViewProps } from "react-native";

export type CardProps = ViewProps & {
  title: string;
  tone?: "default" | "muted";
};

export function Card({ title, tone = "default", style, ...rest }: CardProps) {
  return (
    <View style={[styles.card, tone === "muted" && styles.muted, style]} {...rest}>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
  },
  muted: {
    opacity: 0.6,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
});
```

The pattern in that snippet, spelled out:

- **Props are a `type`, not an `interface`** — so they can be built by intersection from the React
  Native base type (`ViewProps`, `TextProps`, `PressableProps`). Export it as `<Name>Props` when
  callers need it; keep it a local `type Props` when they don't.
- **Take the base props and spread `...rest` last**, so every consumer keeps access to
  `accessibilityLabel`, `testID`, `onLayout` and the rest without you enumerating them.
- **Accept `style` and put it last in the array**, so a caller can always override.
- **Defaults go in the destructure**, not in a `defaultProps` object.
- **Type imports use the inline `type` keyword** — `import { View, type ViewProps }`.

## Styling

`StyleSheet.create` at the bottom of the file. Every key it defines is referenced; an unused key is
dead code that lint will flag.

Reach for an inline object only for a genuinely dynamic value:

```tsx
<View style={[styles.container, { backgroundColor: theme.background }]} />
```

Conditional styles go in the array (`cond && styles.x`), which keeps the static values in the
stylesheet where they can be shared and checked.

## Theme and dark mode

Colours come from the theme, never from a hex literal in a screen. That is what lets light and dark
flip without editing a single component.

`src/theme.ts` holds the tokens — a `light` and a `dark` palette with identical keys, plus
spacing, radius and typography. Both hooks already exist; use them rather than rewriting them:

```tsx
import { useTheme } from "@/hooks/use-theme"; // the active palette
import { useColorScheme } from "@/hooks/use-color-scheme"; // "light" | "dark", never anything else
```

React Native's own `useColorScheme()` has a third value — `"unspecified"` — for a platform
that has not reported a preference yet, and `Colors["unspecified"]` is `undefined`: one frame
of an unstyled screen. `@/hooks/use-color-scheme` narrows it, so read the scheme through that
and never from `react-native` directly. It is also the seam tests mock — mocking
`react-native` couples a test to a React Native version instead of to this app.

A hex literal outside `src/theme.ts` fails `npm run lint`, so this is enforced rather than
requested.

When several screens need the same themed primitive, build it once instead of calling
`useTheme()` in every leaf. Four already exist: `ThemedText`, `ThemedView`, `Screen` (page
container, safe-area and web max width) and `Button`. Compose those before adding a fifth —
[`design-system`](../../design-system/SKILL.md) covers when a new one is actually warranted.

## Platform differences

Small ones inline:

```tsx
const inset = Platform.select({ ios: 50, android: 80, default: 0 });
```

Large ones as separate files. `bar-chart.tsx` and `bar-chart.web.tsx`, imported extension-free as
`@/components/bar-chart`; Metro picks per target. Two rules make this work:

- **Identical props across variants** — the import site cannot tell which file it got.
- **A plain file with no extension always exists.** If the component is web-only, the plain file
  still needs to be there, returning `null`.

Supported extensions: `.ios`, `.android`, `.native`, `.web`.

## Web

The app builds to web through `react-native-web`, so every screen is a web page too. Two habits
prevent most of the surprises:

- Give scrollable content a max width and centre it, or it stretches across a desktop monitor.
- Check that touch targets still work with a mouse — `onPress` translates, but hover and cursor
  styling need `Platform.OS === "web"` handling if you want them.

Web-only CSS lives in a `*.module.css` beside the `.web.tsx` that imports it.

## Images and icons

- Images through `expo-image`, sourced with `require("@/assets/images/name.png")` for bundled files.
- Icons through `expo-symbols` (`SymbolView`), which takes a per-platform name map, or an icon font
  package if the project already has one. Follow whichever the app already uses rather than adding a
  second.

## Animation

`react-native-reanimated` is the default. Keep animation callbacks marked `"worklet"` and hop back
to the JS thread deliberately when a callback needs React state. Prefer `Animated.View` with
`entering` / `exiting` presets over hand-driven shared values for simple enter and exit.
