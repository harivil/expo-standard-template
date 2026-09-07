# Routes and navigation

Expo Router is file-based: the path of a file under `app/` is its URL. Read the versioned docs for
the SDK found in step 0 before relying on any API here.

## The shapes a route file takes

| Filename         | URL                  | Purpose                         |
| ---------------- | -------------------- | ------------------------------- |
| `index.tsx`      | `/`                  | the folder's own route          |
| `settings.tsx`   | `/settings`          | a plain route                   |
| `[id].tsx`       | `/42`                | a dynamic segment               |
| `[...rest].tsx`  | `/a/b/c`             | catch-all                       |
| `+not-found.tsx` | any unmatched        | 404                             |
| `_layout.tsx`    | —                    | wraps every route in its folder |
| `(group)/`       | omitted from the URL | groups routes under one layout  |

A folder named `(tabs)` groups its routes under `(tabs)/_layout.tsx` without adding `/tabs` to any
URL. That is how a tab bar is built: the layout declares the navigator, the sibling files are the
tabs.

## Layouts

A `_layout.tsx` renders the navigator and persists across its children — put providers, theme, and
chrome here rather than repeating them per screen.

```tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack />;
}
```

For tabs, the `name` of each screen matches its filename without the extension. **Import
`Tabs` from `expo-router/js-tabs`** — the re-export from `expo-router` itself is deprecated as
of SDK 57:

```tsx
import { Tabs } from "expo-router/js-tabs";

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarButtonTestID: "tab-home" }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarButtonTestID: "tab-settings" }}
      />
    </Tabs>
  );
}
```

`tabBarButtonTestID` is how a Maestro or Playwright flow taps a tab — a tab bar renders no
`testID` of its own, so without it the flow has to select by visible copy and breaks on the
next wording change. Add it with the tab, not from a test branch later.

`src/app/(tabs)/_layout.tsx` in this repo is a working example.

**Adding a tab is two edits**: create `app/(tabs)/<slug>.tsx`, then add its `<Tabs.Screen name="<slug>" />`
to the layout. Skip the second and the file becomes a route the tab bar never shows.

## Reading params

```tsx
import { useLocalSearchParams } from "expo-router";

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Item id={id} />;
}
```

`useLocalSearchParams` gives the params of _this_ screen; `useGlobalSearchParams` gives the current
URL's, which keeps updating as the user navigates away. Reach for the local one unless you
specifically want to track the global URL.

## Typed routes

When `app.json` has `experiments.typedRoutes` enabled, route strings are checked against the files
that exist, and the `Href` type from `expo-router` types any prop that carries one:

```tsx
import { Link, type Href } from "expo-router";

type Props = { href: Href; label: string };
```

A typed-route error after adding a file usually means the types are stale — restart the dev server
to regenerate them.

## Navigating

Prefer `<Link>` for anything a user taps. It renders a real anchor on web, so it gets middle-click,
open-in-new-tab, and keyboard focus for free — all of which imperative navigation loses.

```tsx
import { Link } from "expo-router";

<Link href="/settings">Settings</Link>;
```

To make a custom component the tappable target, pass `asChild`:

```tsx
<Link href="/settings" asChild>
  <Pressable>
    <Text>Settings</Text>
  </Pressable>
</Link>
```

Use `useRouter()` for navigation that follows an event rather than a tap — after a form submits,
after auth resolves, or to go back:

```tsx
const router = useRouter();
router.replace("/home"); // replace, so back doesn't return to the form
```

## Links that leave the app

A bare `<Link>` to an `https://` URL kicks the user out to their system browser on native. To keep
them in the app, open external URLs through `expo-web-browser` on native and let the anchor behave
normally on web:

```tsx
import { openBrowserAsync } from "expo-web-browser";
import { Link } from "expo-router";
import { Platform } from "react-native";

export function ExternalLink({ href, ...rest }: Props) {
  return (
    <Link
      target="_blank"
      href={href}
      {...rest}
      onPress={async (event) => {
        if (Platform.OS !== "web") {
          event.preventDefault();
          await openBrowserAsync(href);
        }
      }}
    />
  );
}
```

## Deep links

The `scheme` in `app.json` is what makes `myapp://settings` resolve. Adding a route makes it
deep-linkable automatically — no registration step. Test one with:

```bash
npx uri-scheme open myapp://settings --ios
```
