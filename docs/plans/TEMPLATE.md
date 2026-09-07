# Plan: <short title>

Spec: [`../specs/<slug>.md`](../specs/<slug>.md) · Branch: `<slug>`

Copy to `docs/plans/<slug>.md`. Written in plan mode, before any file changes. Review checks the
finished diff against this, so when the build departs from it, update this file in the same commit.

The bar: someone who never saw the conversation could build this from the plan alone.

## Files that change

Real paths, one per line, each with what happens to it. New files marked `(new)`.

```
src/app/settings.tsx                 (new)  route, thin
src/screens/settings/index.tsx       (new)  screen body
src/screens/settings/index.test.tsx  (new)  behaviour tests
src/app/(tabs)/_layout.tsx                  register the tab
```

## Order of work

Numbered, smallest first, each step leaving the app in a working state. A step that cannot be
verified on its own is two steps.

1.
2.

## Risks

What this could break, and which step is riskiest. Name the thing you are least sure about — that is
the one worth a reviewer's attention.

## Alternatives not taken

What you considered and rejected, and why. This is what stops the same debate reopening in review.

## Proof

Specifically what will be run or seen to show it worked. Name the test file and the surfaces.

> `settings.test.tsx` covers the loading, empty and error states; the panel matches the mock on iOS
> and web; dark mode checked on both.

"Tests pass" is not proof.
