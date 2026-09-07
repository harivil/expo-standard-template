#!/usr/bin/env node
// Fails a pull request that changes app code without citing an artifact that exists.
//
// This is the gate that turns PULL_REQUEST_TEMPLATE.md's Artifacts section from a prompt
// into a requirement. Before it, the template asked for
//
//   - Intent: `docs/intent/<slug>.md`
//   - Spec:   `docs/specs/<slug>.md`
//   - Plan:   `docs/plans/<slug>.md`
//
// and nothing checked that the paths were filled in, that they pointed anywhere real, or
// that the files had been committed. A PR could leave the placeholders in place, or name a
// spec that only ever existed in the agent's context, and CI was perfectly happy.
//
// WHAT IT CHECKS
//   1. The PR body cites at least one docs/{intent,specs,plans}/<name>.md path, and
//   2. every path it cites exists in the repo at this commit.
//
// WHAT IT DELIBERATELY DOES NOT CHECK: whether the spec is any good, whether all three
// stages ran, or whether the plan matches the diff. Those are judgement, and judgement is
// change-reviewer's job and a human's — a CI job that tried would either be trivially
// satisfiable or wrong. This one only answers "does the artifact this PR claims exist,
// exist", which is the part a machine can actually settle.
//
// SKIPPED when the diff touches no app code. A dependency bump, a docs fix, or a change
// confined to .claude/ needs no spec, and failing them would train people to paste a
// placeholder path to get green — which is worse than not asking.
//
// Usage:  node .claude/scripts/check-artifacts.mjs <base-ref>
//         PR_BODY is read from the environment (GitHub gives it as a workflow expression).

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const baseRef = process.argv[2];
const body = process.env.PR_BODY ?? "";

/** Only app code requires an artifact. Matches the stage-check hook's definition. */
const NEEDS_AN_ARTIFACT = /^src\//;

/** The three artifact directories feature-loop commits to, in stage order. */
const ARTIFACT = /docs\/(?:intent|specs|plans)\/[A-Za-z0-9._-]+\.md/g;

/** The template's own placeholders. Citing one is the same as citing nothing. */
const PLACEHOLDER = /<slug>|<name>|TEMPLATE\.md/;

function changedFiles() {
  if (!baseRef) return null;
  try {
    const out = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (e) {
    return null;
  }
}

const files = changedFiles();
if (files === null) {
  // No diff available is a broken check, not a passing one — say so rather than exiting 0
  // and letting a green tick stand for something that never ran.
  console.log(
    `Could not diff against '${baseRef ?? "(no base ref given)"}' — this check did not run.`,
  );
  console.log(`Give it a base ref:  node .claude/scripts/check-artifacts.mjs origin/main`);
  process.exit(1);
}

const appCode = files.filter((f) => NEEDS_AN_ARTIFACT.test(f));

if (appCode.length === 0) {
  console.log(
    `No changes under src/ — no artifact required. ${files.length} file(s) changed.`,
  );
  process.exit(0);
}

// Deduplicate: the template lists each artifact once, but a body often repeats a path in
// prose as well, and a doubled citation is not two artifacts.
const cited = [...new Set(body.match(ARTIFACT) ?? [])].filter((p) => !PLACEHOLDER.test(p));

const problems = [];

if (cited.length === 0) {
  problems.push(
    `This PR changes ${appCode.length} file(s) under src/ but cites no artifact.\n` +
      `  Fill in the Artifacts section of the PR description with the real paths:\n` +
      `    - Intent: docs/intent/<your-slug>.md\n` +
      `    - Spec:   docs/specs/<your-slug>.md\n` +
      `    - Plan:   docs/plans/<your-slug>.md\n` +
      `  A placeholder <slug> or a TEMPLATE.md path does not count as a citation.`,
  );
}

const missing = cited.filter((p) => !existsSync(p));
if (missing.length > 0) {
  problems.push(
    `The PR description cites ${missing.length} artifact(s) that do not exist at this commit:\n` +
      missing.map((p) => `    ${p}`).join("\n") +
      `\n  Commit the artifact, or correct the path. A cited file that is not in the repo is\n` +
      `  the failure this check exists to catch: review reads it, finds nothing, and waves through.`,
  );
}

console.log(`${appCode.length} file(s) under src/ changed.`);
console.log(
  cited.length > 0 ? `Artifacts cited: ${cited.join(", ")}` : `Artifacts cited: none`,
);

if (problems.length === 0) {
  const found = cited.filter((p) => existsSync(p));
  console.log(`\nAll ${found.length} cited artifact(s) exist.`);
  process.exit(0);
}

console.log("");
for (const p of problems) console.log(`✗ ${p}\n`);
process.exit(1);
