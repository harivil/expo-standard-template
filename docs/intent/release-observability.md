# Intent: post-release observability — closing the maintain loop

Author: 10X Health mobile team · Status: draft — **deferred, not scheduled**

> Raised while auditing our agent tooling against the Expo plugin's current skill set. Written now so
> the gap is an artifact rather than a memory, per `feature-loop` stage 8: _"the trigger is written
> down as an artifact, not carried in someone's head."_ Nobody is working on this yet.

## Problem

[`feature-loop`](../../.claude/skills/feature-loop/SKILL.md) claims to be a loop — stage 8 sends work
back to stage 1 on a bug, a repeated agent mistake, or a repeated review finding. Two of those three
are internal signals we generate ourselves. The first one, a production bug, is not: today it reaches
us only when a person notices and tells us.

So the loop does not actually close. We have no measurement of what happens after
[`release-app`](../../.claude/skills/release-app/SKILL.md) finishes:

- **§5 tells you to choose between an OTA update and a new build. §6 tells you how to roll back.**
  Neither has an input. We publish an update to a channel and learn nothing about whether it made
  things worse — no crash rate, no launch count, no split between users on the embedded build and
  users who took the OTA.
- Nothing measures cold start, time-to-interactive, or crash rate on a real device after ship.
- A regression that is not visually obvious — a slow screen, a crash on one OS version, an OTA that
  never downloaded — can sit in production indefinitely.

This matters more than usual here because we ship **OTA updates**. An OTA reaches users in minutes
with no store review in between, which is exactly why the rollback path in §6 exists — and rollback
without a health signal is a fire alarm nobody is listening for.

## Proposed outcome

Someone shipping a release can answer "is this rollout healthy?" from data rather than from the
absence of complaints, and a bad rollout triggers the existing §6 rollback before a user reports it.

Concretely, the shape this probably takes:

- `eas-update-insights` wired into the OTA decision in `release-app` §5 — crash rate, install and
  launch counts, and the embedded-vs-OTA split per channel.
- `eas-observe` for post-launch runtime metrics — cold and warm launch, TTI, crash reporting.
- A fourth bullet in `feature-loop` stage 8 naming the production signal as a trigger that sends work
  back to stage 1, alongside the three that already exist.

That is a sketch of a solution, not a decision. The spec stage owns the shape.

## Affected users and systems

App users on every surface, most sharply anyone who takes an OTA update. Internally: whoever cuts a
release, and the `feature-loop` and `release-app` skills. Touches EAS Update channels and, if
`eas-observe` is adopted, the app's runtime entry point.

## Constraints

- **Both candidate tools are paid EAS features.** This is a cost decision before it is an engineering
  one, and it must be flagged the way `eas-simulator` already is in
  [`capture-evidence`](../../.claude/skills/capture-evidence/SKILL.md) and
  [`write-e2e`](../../.claude/skills/write-e2e/SKILL.md) — named as paid, never assumed as a default.
- **This app is in the health and wellness domain.** Any telemetry added here must be reviewed for
  what it collects before it is enabled. Metrics must stay aggregate and device-level; nothing
  identifying a user, and nothing about a user's health, may reach a metrics pipeline. The
  `.semgrep.yml` rules on personal data reaching logs or URLs apply to this code like any other.
  Adding SDK-level telemetry is a **large** change under `feature-loop` sizing — spec goes to a human
  before the plan.
- `eas-observe` adds a runtime dependency and wraps the app root. Anything that runs on every launch
  is on the startup path and has to earn it.
- Whatever is adopted must not become a fourth version number or a fifth thing to remember at release
  time. It either shows up in `release-app`'s existing steps or it will be skipped.

## Open questions

- **Are we on a paid EAS plan, and does it include these?** If not, the honest fallback is smaller
  and still worth doing: write down in `release-app` that post-release health is unmonitored, and
  name who checks the stores and user reports manually after a release. That version costs nothing
  and removes the silent assumption.
- Do we need both, or does `eas-update-insights` alone close enough of the gap? It is the cheaper
  half and maps directly onto the OTA decision we already make.
- What crash rate or launch-count delta should actually trigger the §6 rollback? A dashboard nobody
  has agreed a threshold for is decoration.
- Does anything here need Legal or compliance sign-off before telemetry is enabled in a health app?
- Who owns watching it? An unowned dashboard degrades to an unread one.
