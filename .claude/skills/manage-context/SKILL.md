---
name: manage-context
description: Keep an agent session working well as it grows — what to hand forward, when to dispatch a subagent, when to start fresh. Use when a session is getting long, when handing work over, when resuming someone else's change, or when quality starts slipping mid-task.
---

# Manage context

A session degrades before it fails. Work slows, decisions get re-derived, files get re-read, and the
agent starts contradicting things it settled an hour ago. This is how to notice and what to do.

## The artifact chain is the context protocol

The central idea, and the reason `feature-loop` commits a file at every stage:

> A change whose `intent.md`, `spec.md` and `plan.md` are current can be picked up by anyone, in a
> fresh window, on a different machine, in a different agent — without the conversation that produced
> them.

The artifacts are not only an audit trail. They are the mechanism that makes context disposable. When
they are current, losing a session costs nothing; when they have drifted, the session is the only
place the work exists and losing it costs the work.

So: **keep the artifacts current as you go**, not at the end. The plan is the live document — a step
finished is a line updated.

## Dispatch to protect the window

A subagent has its own context. Work sent there returns a conclusion; work done inline returns a
conclusion _and_ everything read along the way. For anything that reads widely and concludes
narrowly, that difference is the whole budget.

| Send to a subagent                                            | Keep inline                                 |
| ------------------------------------------------------------- | ------------------------------------------- |
| Searching a wide area for where something lives               | Editing a file you already have open        |
| Verification — running the app, exercising flows (`verifier`) | A change you are actively iterating on      |
| Review of a finished diff (`change-reviewer`)                 | Anything needing the conversation's history |
| Reading a spec adversarially (`spec-reviewer`)                | Two-file changes you can hold in your head  |

The loop's three agents exist as much for this as for independence. Verification inline means every
log line and screenshot lands in the main window; verification dispatched means one report does.

## Reading budget

- **Locate, then read.** Grep or Glob to find the lines, then read around them. Reading a whole file
  to find one function spends the window on the other ninety percent.
- **Read the part.** Large files take an offset and a limit. Use them.
- **Do not re-read to be sure.** If you read it this session, you have it. Re-reading is a symptom —
  see below.

## Signs of decay

Stop and act when you notice:

- reading a file you already read this session,
- re-deriving a decision that is already written in the plan,
- losing track of the slug, or which stage you are in,
- contradicting `plan.md` without noticing you did,
- summarising your own earlier work incorrectly.

The instinct is to push through. The cheaper move is almost always to update the plan and start
fresh — the artifacts make that nearly free, which is the point of keeping them current.

## Handing off

Ending a session mid-change, whether to a person or to your own next session:

1. Update `docs/plans/<slug>.md` — tick what is done, note what is next, and add anything you learned
   that would not be obvious from the diff (a dead end, a surprising constraint, a flaky step).
2. Commit the work-in-progress on the branch. An uncommitted change on one laptop is invisible to
   everyone, including you tomorrow.
3. Say which stage the change is in.

That is the whole handoff. Resist writing a separate note — a second document immediately disagrees
with the plan, and then nobody knows which is true.

## One slug per session

Run one change per window. Two features in one session blur: decisions from one leak into the other,
and neither plan stays accurate. When several changes are genuinely in flight, give each its own
worktree and its own session:

```bash
git worktree add ../work-<slug> -b <slug>
```

The practical ceiling is not how many sessions you can start — it is how many you can review
properly. Add one only while review is keeping up.

## Compact, or start fresh?

**Compact** when the thread still matters — mid-implementation, iterating on something where the
recent back-and-forth is the value.

**Start fresh** when the stage changed. Moving from build to review, or from spec to plan, is a
natural boundary: the new stage reads a different artifact and benefits from not inheriting the last
one's assumptions.

That second case is worth stating plainly, because it is two ideas turning out to be one:

> **Stage boundaries are context boundaries.** Starting review in a fresh session keeps the window
> small _and_ keeps the reviewer independent of the reasoning that produced the code. Context hygiene
> and reviewer independence are the same move.

## Long-running and autonomous work

For a session that runs unattended, the same rules harden into requirements: artifacts current before
each stage boundary, verification dispatched rather than inline, and a plan detailed enough that the
next session can resume from it cold. An autonomous loop that cannot be resumed from its artifacts is
one interruption away from losing everything it did.
