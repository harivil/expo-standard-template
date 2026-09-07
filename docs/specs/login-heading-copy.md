# Spec — login-heading-copy

## Outcome

The login screen's heading names the product instead of greeting the user: **"10x Health Login"**
in place of **"Welcome"**.

A copy change, sized **Small** by the [`feature-loop`](../../.claude/skills/feature-loop/SKILL.md)
skill — build, verify, ship. It gets a spec anyway because CI requires a PR touching `src/` to cite
an artifact that exists, and a ten-line spec is cheaper than an exemption.

## Surfaces

iOS, Android **and** web — one string in `src/app/login.tsx`, shared by all three.

## Acceptance criteria

1. The login screen shows the heading `10x Health Login`.
2. The word `Welcome` no longer appears on the login screen.
3. The heading renders on one line at the default text size on a 390pt-wide phone, and wraps
   rather than clipping or truncating when the text size is increased (the heading already caps at
   `maxFontSizeMultiplier={1.8}`).
4. Everything else on the screen is untouched: the `10x Health` wordmark, the `Sign in to continue`
   subheading, the `Login` button, and the error region.
5. `login-screen`, `login-submit` and `login-error` testIDs are unchanged, so the Maestro flow and
   the web specs keep working.

## Out of scope

- The `10x Health` wordmark above the heading. It now says the brand name twice on one screen; that
  is a **design decision, not a copy fix**, and it is left for a reviewer to call — see the note in
  the PR.
- The `Welcome to 10x Health` copy on the signed-in home tab (`src/app/(tabs)/index.tsx`), which is
  a different screen and was not asked about.
- Any change to authentication behaviour.

## Verification

`npm run verify -- --full`, plus before/after captures of the login screen on the surfaces the
capturing machine can reach. On Windows that is web (light and dark) and Android; **iOS is a gap**
and the PR names it.
