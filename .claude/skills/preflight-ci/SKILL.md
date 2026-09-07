---
name: preflight-ci
description: Run the checks GitHub Actions runs on a pull request, locally, before pushing — and triage a red check when one still lands. Use before opening or updating a PR, when a CI check fails, or when adding a check to CI.
---

# Preflight

A red pull request costs a push, a wait, and a context switch. Worse, it costs attention: a PR that
has been red four times stops being read, and the fifth failure — the real one — lands in a check
nobody looks at any more.

Almost everything CI proves on a pull request can be proven here first, in minutes, against the
same commands.

```bash
npm run verify              # everything that needs nothing but node
npm run verify -- --full    # adds the web E2E suite, which CI runs on every PR
```

Exit 0 means green. Exit 1 means **failed** or **incomplete**, and the summary says which. **Read
the output** — a check that exited zero with warnings you did not read has not been verified.

## Three verdicts, not two

This is the design rule the script exists to obey: **it never reports green when it skipped
something.**

| Verdict      | Means                                     | Exit |
| ------------ | ----------------------------------------- | ---- |
| `green`      | every required check ran and passed       | 0    |
| `failed`     | something ran and failed                  | 1    |
| `incomplete` | a **required** check could not run at all | 1    |

`incomplete` is the value that matters. A receipt claiming `green` with the checks sitting in
`skipped` is worse than no receipt — it is a false pass someone reasons from. An optional check
skipping (`gitleaks` or `greenlight` not installed) is a note; a required one skipping makes the
whole run incomplete, because it means the run cannot stand in for CI.

Every run writes `.claude/.ci-local.json` — the receipt [`guard-pr`](../../hooks/guard-pr.mjs)
reads. It is gitignored, and nothing else consumes it.

## What maps to what

Each step names the CI job it stands in for, so a red check on github.com maps to one step here.

| CI job                    | Local steps                                        | Proven locally                          |
| ------------------------- | -------------------------------------------------- | --------------------------------------- |
| `CI / verify`             | `format` `types` `lint` `test` `doctor` `versions` | fully                                   |
| `CI / web-e2e`            | `web-e2e` — needs `--full`                         | fully, once browsers are installed      |
| `CI / agent-config`       | `hooks` `skills` `toolchain`                       | fully                                   |
| `Security / semgrep`      | `semgrep-rules`                                    | the rule fixtures, with semgrep         |
| `Security / secrets`      | `secrets`                                          | only with gitleaks installed            |
| `Compliance / compliance` | `compliance`                                       | only with greenlight installed          |
| `CI / commits`            | —                                                  | the husky `commit-msg` hook, per commit |
| `CI / artifacts`          | —                                                  | **no** — needs the PR to exist          |
| `CI / test-integrity`     | —                                                  | **no** — needs a base ref to diff       |
| `Security / codeql`       | —                                                  | **no** — no practical local runner      |
| `Security / dependencies` | —                                                  | **no** — advisory data moves on its own |
| `DAST / zap-web`          | —                                                  | **no** — weekly, needs a served build   |

A check that cannot run reports `skip` with the reason. A skip is not a pass, and the summary lists
them separately for exactly that reason.

**That table is enforced, not documentation.** `node .claude/check-skills.mjs` reads the `job:`
field on every step and every job id in `.github/workflows/`, and fails when a job is covered by
neither a step nor a written exemption. So the mapping cannot silently rot: adding a job to CI
forces the decision.

## The four things a local run cannot tell you

1. **CodeQL.** No practical local runner, and on a private repository it needs GitHub Code
   Security. The semgrep _scan_ and its ERROR gate run either way.
2. **The SARIF upload.** Needs a workflow token and code scanning enabled on the repository.
3. **Workflow permissions.** Declaring `permissions:` in a workflow _replaces_ the default token
   scopes rather than adding to them, so an action that needs a scope nobody listed fails as a 403
   from inside its own code — never as anything that looks like a permission error. This class of
   failure only exists against the real API. When a job dies on
   `Resource not accessible by integration`, the fix is a scope in the workflow, not the code.
4. **Dependabot.** Runs on a schedule against the default branch.

Two more are honest gaps rather than impossibilities: **greenlight** ships no Windows binary, so
the compliance step skips on Windows and `.github/workflows/compliance.yml` is the enforcing layer;
and **gitleaks** is a Go binary rather than an npm dependency, so it skips when absent. CI runs
both regardless.

## Triage — what each red check actually means

| Symptom                                  | What it is                                                              | Fix                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Cannot find module '@playwright/test'`  | a committed config importing a dependency that is not in `package.json` | `npm i -D @playwright/test`                                                                      |
| `Cannot find module './x.module.css'`    | a web-only import with no type declaration                              | declare it in a `.d.ts`; see the **`scaffold-feature`** skill                                    |
| `expo-doctor`: version mismatch          | a package outside the SDK's pinned range                                | `npx expo install --check`, or `expo.install.exclude` when deliberate                            |
| `npm audit` high                         | a transitive advisory                                                   | `npm audit fix`, or pin the parent; never `--force` on a whim                                    |
| semgrep `N blocking findings`            | ERROR-severity rules only                                               | fix, or justify a narrow `nosemgrep` with a reason — the **`security-scan`** skill covers triage |
| greenlight `CRITICAL` / `HIGH`           | a store-rejection risk, not a code smell                                | the **`greenlight`** skill; two CRITICALs are permanent in a source scan and named there         |
| `Resource not accessible by integration` | a missing workflow scope                                                | add it under `permissions:` in the workflow                                                      |
| the `artifacts` job                      | a PR touching `src/` cites no intent, spec or plan that exists          | write the artifact, or cite the real path — a `TEMPLATE.md` path counts as citing nothing        |
| gitleaks finding                         | a secret in history                                                     | **rotate it**, then remove it. Deleting the line is not a fix                                    |

## The gate

[`guard-pr`](../../hooks/guard-pr.mjs) blocks `gh pr create`, `gh pr ready` and `gh pr merge` until
a full run has passed against the code being reviewed. It reads the receipt each run writes, and
treats four things as unproven:

- **no run** — the gate was never run here
- **a failed run** — CI fails the same way
- **an incomplete run**, or one without `--full` — green about a smaller set of checks than the one
  reporting on the PR, which is a different claim
- **a green run against a different tree** — the case people actually hit, because the working tree
  moved after the run. The receipt records the commit _and_ the state of the working tree, so an
  edit after a green run makes it stale rather than reusable.

A draft is deliberately never blocked:

```bash
gh pr create --draft        # share work in progress, ungated
```

The hook fails open on any internal error, and `CLAUDE_SKIP_CI_PREFLIGHT=1` overrides it. That
exists for a broken gate. Reaching for it twice means the gate is wrong — fix the gate.

## When you add a check to CI

Add it in both places in the same commit: the job in
[`ci.yml`](../../../.github/workflows/ci.yml),
[`security.yml`](../../../.github/workflows/security.yml) or
[`compliance.yml`](../../../.github/workflows/compliance.yml), and the step in
[`ci-local.mjs`](../../scripts/ci-local.mjs) carrying the same command and a `job:` naming that job.

A check that exists only in CI teaches people that local runs prove nothing, and the next person
stops running them. If a check genuinely cannot run locally, add the job id to `LOCAL_EXEMPT` in
[`check-skills.mjs`](../../check-skills.mjs) **with the reason it cannot** — that is the only way
the parity check goes quiet, and the reason is what a future reader needs. Either way, the build
tells you: you cannot forget one half.

## Where this sits in the loop

Stage 5 of the **`feature-loop`** skill: after the **`verify-app`** skill's checks and the app
itself, before review. Preflight proves the repo's checks agree; it says nothing about whether the
screen renders. Both are stage 5, and neither substitutes for the other.
