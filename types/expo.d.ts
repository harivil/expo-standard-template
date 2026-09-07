// Expo's ambient type declarations: `*.css` and `*.module.css` modules, the
// react-native-web JSX surface, and the `process.env.EXPO_PUBLIC_*` shape.
//
// Expo generates `expo-env.d.ts` with this same reference, but `.gitignore` excludes
// it (Expo's own instruction) and only `expo start` / `expo prebuild` / `expo export`
// write it — so it is absent in CI and in a fresh clone, and `tsc --noEmit` then fails
// on `import "@/global.css"` (TS2882) and `./animated-icon.module.css` (TS2307).
//
// This file is tracked, so the declarations are always present. `/// <reference>` is
// idempotent, so it costs nothing when the generated file is there too.
/// <reference types="expo/types" />
