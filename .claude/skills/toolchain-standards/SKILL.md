---
name: toolchain-standards
description: Check and set up this Expo project's code-quality toolchain — Prettier, ESLint, husky, commitlint, lint-staged — so the standard holds after an agent hands the project to a human. Use when scaffolding a project, when a config exists but nothing runs it, or before handing work over.
---

# Toolchain standards

```bash
node .claude/scripts/toolchain-check.mjs          # report
node .claude/scripts/toolchain-check.mjs --fix    # write what is missing
```

## The failure this exists to stop

Not a missing config. A config that is present and inert.

`commitlint.config.js` sat in this repo, carefully written, with the install commands for
`@commitlint/cli` and `husky` in a comment at the top. Nobody ran them. For every commit since,
the file looked like enforcement, read like enforcement in review, and enforced nothing — while
the versioning skill downstream assumed the log it produced was reliable.

So every check here has two halves, and a tool counts as present only when both are true:

| Tool        | The config                                                  | The thing that runs it                                                                   |
| ----------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ESLint      | `eslint.config.js`                                          | `eslint` installed, `lint` script                                                        |
| Prettier    | `.prettierrc`, `.prettierignore`                            | `prettier` installed, `format` + `format:check` scripts                                  |
| commitlint  | `commitlint.config.js`                                      | `@commitlint/cli` installed **and `.husky/commit-msg` calling it**                       |
| husky       | `.husky/pre-commit`, `.husky/commit-msg`, `.husky/pre-push` | `husky` installed, `prepare` script — without it, `npm install` never installs the hooks |
| lint-staged | `lint-staged` in `package.json`                             | `lint-staged` installed                                                                  |

`lint-staged` is not optional here. A pre-commit hook that lints the whole repo is slow enough
that people reach for `--no-verify`, and a hook people bypass enforces nothing at all.

## Protecting `main`, and what it costs

`.husky/pre-push` runs [`guard-push.mjs`](../../hooks/guard-push.mjs), which refuses to
force-push or delete `main` — computed from the refs git hands the hook, so it catches a rewrite
however it was spelled, and lets an ordinary fast-forward through untouched.

This matters because the other guards in `.claude/hooks/` are **Claude Code hooks**: they bind an
agent session in this directory and nothing else. A teammate on the command line walks straight
past them. A git hook binds whoever pushes from the clone, regardless of what wrote the commit.

Be clear about the ceiling, though:

| Layer                    | Bypassed by                                             | Reaches a teammate? |
| ------------------------ | ------------------------------------------------------- | ------------------- |
| `guard-bash.mjs`         | not using Claude Code                                   | no                  |
| `.husky/pre-push`        | `--no-verify`, or a clone where `npm install` never ran | yes                 |
| GitHub branch protection | nothing                                                 | yes                 |

**Only the last one cannot be walked around**, and it is not a file in this repo, so it does not
arrive with a clone. Turn it on per repo and check it is on before trusting it:

```bash
node .claude/scripts/protect-main.mjs --apply
```

One caveat to expect rather than discover: on a **private repository on a Free plan**, both the
rulesets and branch-protection APIs answer `403 Upgrade to GitHub Pro or make this repository
public`. Making a work repo public to get it is not a trade worth making, so until the repo is on a
paid plan or in an organisation, the pre-push hooks are the strongest layer available — which is
considerably better than nothing, and worth saying out loud rather than assuming the server is
holding a line it cannot.

## Why four layers

Each one catches what the others structurally cannot:

| Layer                          | Catches                                        | Survives the agent leaving? |
| ------------------------------ | ---------------------------------------------- | --------------------------- |
| `.husky/` at commit time       | a human, offline, before the bad commit exists | **yes**                     |
| `npm run verify` before a push | an agent, and a human who runs it              | **yes**                     |
| The `verify` job on a PR       | everyone, including a first-time contributor   | **yes**                     |
| This skill                     | the next agent session                         | no — it needs an agent      |

Only the first three are the answer to "will this hold when a human takes over". This skill is
how it gets set up; it is not how it stays set up.

## Running `--fix`

It writes config files, adds the `package.json` scripts, and creates the husky hooks. It does
**not** install anything — installing reaches the network and rewrites the lockfile, which is a
decision with a diff attached, not a side effect of an audit. It prints the one command to run:

```bash
npm install -D prettier @commitlint/cli @commitlint/config-conventional husky lint-staged
```

`npm install` then runs `prepare`, which is what actually installs the git hooks into `.git/`.

**Then normalize once**, before `format:check` becomes a gate — otherwise the first PR to touch
any file fails on formatting nobody in that PR introduced:

```bash
npm run format
```

Expect that commit to be large and to touch files unrelated to any feature. Land it on its own,
with a subject that says what it is, so it never has to be reviewed as if it were a change.

## When the standard and the code disagree

Prettier's settings here are in [`.prettierrc`](../../../.prettierrc) — 92 columns, double quotes,
semicolons, trailing commas. The values are arbitrary; agreeing on them is not. The only wrong
answer is two answers in one repo, which is what produces diffs where every line changed and
nothing happened.

If you change a rule, run `npm run format` in the same commit. A config change that leaves the
tree unformatted hands the next person a failing check they did not cause.

## Where this sits

Stage 4 of the **`feature-loop`** skill, the first time a project is scaffolded — the
**`scaffold-feature`** skill covers the code, this covers what keeps it consistent. After that it
runs by itself, in `npm run verify` and in the `verify` job on every PR.
