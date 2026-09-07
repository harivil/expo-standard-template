#!/usr/bin/env node
// Gives every locationless SARIF result a location, so GitHub code scanning can ingest it.
//
//   node .claude/scripts/sarif-locations.mjs <file.sarif> [--anchor <path>]
//
// Why this exists: GitHub's SARIF ingest rejects the WHOLE file when any single result has an
// empty `locations` array —
//
//   Error: Code Scanning could not process the submitted SARIF file:
//   locationFromSarifResult: expected at least one location
//
// and it fails the upload, not just that result. greenlight legitimately produces findings with
// no file to point at: "no app icon configured", "no privacy manifest", "required-reason API
// undeclared" are statements about the project, not about a line. The SARIF spec allows that;
// GitHub does not. So one locationless finding takes every other finding in the run with it —
// which is the failure mode this repo cares about most, a scan that reports nothing while
// looking like it ran.
//
// The anchor is a deliberate, visible compromise: a project-level finding is pinned to the file
// that configures the thing it is about (app.json, by default) at line 1, and the message is
// prefixed so nobody reads that line as the actual defect site. The alternative — dropping the
// results — is worse: it turns a real finding into silence.
//
// Rewrites the file in place. Exits non-zero when the file is missing or unparseable: an
// unreadable scan report must never be mistaken for a clean one.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

const argv = process.argv.slice(2);
const anchorFlag = argv.indexOf("--anchor");
const anchorArg = anchorFlag === -1 ? null : argv[anchorFlag + 1];
const anchorValueAt = anchorFlag === -1 ? -1 : anchorFlag + 1;
const file = argv.find((a, i) => !a.startsWith("--") && i !== anchorValueAt);

if (!file) {
  console.error(
    "usage: node .claude/scripts/sarif-locations.mjs <file.sarif> [--anchor <path>]",
  );
  process.exit(2);
}

const target = resolve(ROOT, file);
if (!existsSync(target)) {
  console.error(`${file} does not exist — nothing to normalize, and nothing was scanned.`);
  process.exit(1);
}

// Where a finding with no file of its own gets pinned. app.json is the honest default here:
// every project-level greenlight rule is about app configuration. Overridable, because the
// next scanner wired through this script may not be.
function pickAnchor() {
  if (anchorArg) return anchorArg;
  for (const candidate of ["app.json", "app.config.js", "app.config.ts", "package.json"]) {
    if (existsSync(resolve(ROOT, candidate))) return candidate;
  }
  return null;
}

const anchor = pickAnchor();
if (!anchor) {
  console.error("No anchor file found. Pass --anchor <path> naming a file that exists.");
  process.exit(1);
}
if (!existsSync(resolve(ROOT, anchor))) {
  console.error(
    `Anchor '${anchor}' does not exist. GitHub rejects a location it cannot resolve.`,
  );
  process.exit(1);
}

let sarif;
try {
  sarif = JSON.parse(readFileSync(target, "utf8"));
} catch (err) {
  console.error(`${file} is not valid JSON: ${err.message}`);
  process.exit(1);
}

const PREFIX = "[project-level] ";
let patched = 0;
let total = 0;

for (const run of sarif.runs ?? []) {
  for (const result of run.results ?? []) {
    total += 1;
    if (Array.isArray(result.locations) && result.locations.length > 0) continue;

    result.locations = [
      {
        physicalLocation: {
          artifactLocation: { uri: anchor },
          region: { startLine: 1 },
        },
      },
    ];

    const text = result.message?.text ?? "";
    if (result.message && !text.startsWith(PREFIX)) {
      result.message.text = `${PREFIX}${text}`;
    }
    result.properties = { ...result.properties, projectLevel: true, anchoredTo: anchor };

    // Every patched result now sits on the same file and line, so GitHub's own fingerprint —
    // which hashes the line's *content* — would collapse two same-rule findings into one alert.
    // A partialFingerprint derived from the rule and the message keeps them distinct.
    const id = createHash("sha256")
      .update(`${result.ruleId ?? ""}\n${text}`)
      .digest("hex");
    result.partialFingerprints = {
      ...result.partialFingerprints,
      projectLevelHash: id.slice(0, 32),
    };

    patched += 1;
    console.log(`  anchored to ${anchor}:1  ${result.ruleId ?? "(no rule id)"}`);
  }
}

if (patched === 0) {
  console.log(`${file}: ${total} result(s), all located. Nothing to do.`);
  process.exit(0);
}

writeFileSync(target, `${JSON.stringify(sarif, null, 2)}\n`);
console.log(
  `${file}: anchored ${patched} of ${total} result(s) to ${anchor}:1 — they describe the project, not a line.`,
);
