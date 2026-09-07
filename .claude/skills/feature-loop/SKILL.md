---
name: feature-loop
description: Run the delivery loop for any change to this Expo app — intent, spec, plan, design, build, verify, review, ship, maintain. Use when handed a new feature, a bug report, an issue, or a change request, before any other work starts.
---

# Feature loop

Every change to this app — a feature, a bug, an incident follow-up — runs the same six stages. This
file is the spine. Each stage **ends by committing an artifact the next stage reads**, and that chain
is the audit trail: what was asked, what was decided, what was built, what was checked.

```
intent ──▶ spec ──▶ plan ──▶ design ──▶ build ──▶ verify ──▶ review ──▶ ship
   ▲                                                                       │
   └──────────────── maintain writes the next intent ◀────────────────────┘
```

Pick a **slug** for the change at the start — short, kebab-case, e.g. `claim-status-panel` — and use
it for every artifact: `docs/intent/<slug>.md`, `docs/specs/<slug>.md`, `docs/plans/<slug>.md`, the
branch name, the commit scope.

## Sizing — decide this before stage 1

Not every change earns six stages. Decide once, say which you chose, and hold to it rather than
quietly dropping stages later.

| Size         | Looks like                                                              | Stages run                                          |
| ------------ | ----------------------------------------------------------------------- | --------------------------------------------------- |
| **Small**    | copy change, a colour, a prop, an obvious one-line bug                  | 4 build → 5 verify → 7 ship                         |
| **Standard** | a screen, a component, an endpoint, a real bug fix                      | all except intent (the request _is_ the intent)     |
| **Large**    | new surface area, a data model, anything touching auth or personal data | all six, and stage 2 goes to a human before stage 3 |

When unsure, size up. A spec on a small change costs ten minutes; a large change without one costs a
rebuild.

---

## 1 · Intent — what is wanted, and why

**Skip when** the request already states the problem, the affected users, and the constraints. Most
direct requests from a teammate do. Write it when the request came from outside the team, from an
incident, or from a message where the reasoning still lives in someone's head.

Write `docs/intent/<slug>.md` from [`../../../docs/intent/TEMPLATE.md`](../../../docs/intent/TEMPLATE.md):
the problem in the originator's own words, the proposed outcome, who and what it affects, the
constraints, and the open questions.

Interview rather than assume. Ask what the person cannot do today, who is affected, what better looks
like, and what is explicitly out of scope — then write down what they said, not what you would have
said.

**Gate:** the originator agrees this is their problem, stated their way. Their correction is the
point of the stage.

---

## 2 · Spec — what will be true when it ships

Write `docs/specs/<slug>.md` from [`../../../docs/specs/TEMPLATE.md`](../../../docs/specs/TEMPLATE.md):
outcome, **which of iOS / Android / web**, acceptance criteria, out of scope.

Flag concerns rather than resolving them silently. Anything touching personal or health data,
authentication, a permission prompt, a store-review surface, or a platform you cannot test — name it
in the spec and say who decides. A concern buried inside an implementation choice is a concern nobody
reviewed.

Dispatch the **`spec-reviewer`** agent on the finished spec. It reads adversarially from a clean
context and reports what is ambiguous, untestable, or missing. Address what it finds.

**Gate:** every acceptance criterion is checkable by another person without reading code, the
surfaces question is answered, and `spec-reviewer` has no unaddressed finding. For a **large** change
a human approves the spec here — the cheapest point at which changing course is still editing a
document.

---

## 3 · Plan — how it will be built

Start in **plan mode**, so the codebase can be read without being changed. Produce
`docs/plans/<slug>.md` from [`../../../docs/plans/TEMPLATE.md`](../../../docs/plans/TEMPLATE.md): the
files that change, the order of the work, the risks, and the proof that will show it worked.

Interrogate the plan before accepting it — what could this break, which step is riskiest, what did you
choose _not_ to do. Iterate until someone who never saw the conversation could build it from the plan
alone.

**Gate:** the plan names real paths, and the proof line says specifically what will be run or seen.
"Tests pass" is not proof; "settings.test.ts covers the three states, and the panel matches the mock
on web and iOS" is.

---

## 3.5 · Design — what it will look like

**Skip when** nothing visual changes. Any new or changed screen runs it.

Follow the **[`design-system`](../design-system/SKILL.md)** skill. It is short and it is
cheap here: it answers the surfaces, names the empty/loading/error/offline states, traces
every colour and spacing value to a token in `src/theme.ts`, and decides whether this is a new
component or an existing one. Doing that after the code exists means rewriting the code.

**Gate:** every state named, every value traced to a token or a new token justified, both
appearance modes considered, and nothing duplicating a component that already exists.

---

## 4 · Build

**Capture the baseline first.** Once you start editing, the _before_ is gone and cannot be
reconstructed without stashing and rebuilding.

```bash
node .claude/scripts/capture.mjs before <slug> --surfaces ios,android,web --record
```

For a new screen there is no before — capture the entry point it will appear from and say in the PR
that the before is an absence. The **`capture-evidence`** skill covers what a recording has to show
and what to do about surfaces this machine cannot reach.

Then follow the **`scaffold-feature`** skill — it carries this app's conventions for routes, screens,
components, hooks, and where each file belongs.

Work on a branch off `main`, never on `main` itself. When several changes run at once, each gets its
own worktree: `git worktree add ../work-<slug> -b <slug>`.

Write the failing test first and watch it fail. When the implementation departs from the plan — it
often should, once the code is real — update `docs/plans/<slug>.md` in the same commit. A plan that
silently diverged is worse than no plan, because review checks the diff against it.

**A UI change adds or extends an E2E flow in this same PR** — not the whole suite, the flow for the
journey it touched. The **`write-e2e`** skill covers Maestro for native, Playwright for web, and the
selector discipline that keeps them from going flaky.

**Gate:** the change is complete against the plan, the plan matches what was built, and any journey
it added is covered by a flow.

---

## 5 · Verify

Follow the **`verify-app`** skill: the repo's own checks, then the app running on every surface the
spec claims, in light and dark. Run the checks CI will run _here_, not on the pull request — the
**`preflight-ci`** skill covers what maps to what, and what a local run cannot cover:

```bash
npm run verify -- --full
```

Capture the _after_ on the same surfaces and journeys as the baseline:

```bash
node .claude/scripts/capture.mjs after <slug> --surfaces ios,android,web --record
```

Then dispatch the **`verifier`** agent. It works from the spec and the running app — never from
`AGENTS.md` or your summary — and hunts adversarially for the states the happy path skipped. It
cannot fix anything, deliberately, so its verdict is not coloured by the assumptions that produced
the code.

**Gate:** every check green with its output read — including `npm run verify -- --full`, which is
what makes the pull request green on the first push rather than the fourth — every acceptance
criterion from stage 2 observed to hold, and `verifier` reporting no behaviour that contradicts the
plan.

---

## 6 · Review

**Start a fresh session here.** A stage boundary is a context boundary: the reviewer should not
inherit the reasoning that produced the code, and the window should not carry the build's file dumps
into the review. The artifacts make this free — see the **`manage-context`** skill.

Dispatch the **`change-reviewer`** agent. It reads the diff against [`REVIEW.md`](../../../REVIEW.md)
in three passes — bugs, security, and compliance with the spec and plan — and reports findings by
severity. It judges the diff against the **spec**, not against `AGENTS.md`, so it can catch a change
that followed every convention and still failed to deliver what was asked.

Address each finding, or accept it with a written reason. An accepted finding says why in the PR, not
in a session that scrolls away.

**Gate:** no unaddressed Important finding, and a human approves the merge. The agent that wrote the
code has no route to approve it.

---

## 7 · Ship

One change per commit. Conventional Commit subject scoped to the slug — `feat(claim-status): add
status panel`.

The PR carries **evidence, not assertion**:

- A UI change ships before/after screenshots — the stage 5 captures are the _after_.
- A logic-only change says so explicitly and shows the test output or numbers that prove it.
- Link the intent, spec and plan. Name anything in the diff the spec does not cover.

Push the branch and open a PR. **`main` moves only by merging one** — a direct push is blocked
both in-session and by `.husky/pre-push`, and by branch protection on the server, so there is no
version of "just push it" that works. If a push is refused, that is the guard doing its job: open
the PR.

The **`open-pr`** skill does the whole of it in one command — captures the surfaces this machine
can reach, uploads them, and opens the PR with its evidence table already rendering the images:

```bash
node .claude/skills/open-pr/scripts/open-pr.mjs <slug> --capture --what "one sentence"
```

By hand instead, and then drag the captures in:

```bash
git push -u origin <slug>
```

**Gate:** CI green, evidence attached, a code owner approved.
[`CODEOWNERS`](../../../.github/CODEOWNERS) is what makes that last one enforceable rather
than hoped for. `guard-pr.mjs` holds the first one before CI ever runs: a pull request opens for
review only once `npm run verify -- --full` has passed **against the code being reviewed**, so a
green run from before your last edit does not count. A draft is never blocked — sharing unfinished
work is not what the gate is for.

Getting the merged change onto a device is its own procedure — versions first with
[`versioning`](../versioning/SKILL.md), then build and submit with
**[`release-app`](../release-app/SKILL.md)**. Merging is not shipping.

---

## 8 · Maintain — where the loop closes

Once a change is live, three things send work back to the start:

- **A bug or incident.** Write `docs/intent/<slug>.md` describing what broke and the evidence, then
  re-enter at stage 1. A production bug also earns a test that would have caught it — commit that
  test _before_ the fix, so it proves the bug is gone rather than describing it.
- **A repeated agent mistake.** When an agent gets the same thing wrong twice, the correction goes
  into `AGENTS.md` or the relevant skill. Skipping this means paying for the same mistake forever.
- **A repeated review finding.** When `change-reviewer` flags one class of problem across several
  changes, it belongs in `REVIEW.md` or in a hook — not in a reviewer's memory.

Anything that fits in one PR re-enters at stage 3. Anything wider re-enters at stage 1.

**Gate:** the trigger is written down as an artifact, not carried in someone's head.

---

## What is enforced, and what is not

The hooks in `.claude/settings.json` deterministically block a short list: committing to `main`,
force-pushing over someone's work, installing Expo packages the wrong way, and writing to generated
or protected paths. They are guardrails, not the process.

Everything else here is advisory — it holds because sessions follow it and review checks it. When a
rule starts being skipped, that is the signal to make it a hook, not to write it in bolder text.
