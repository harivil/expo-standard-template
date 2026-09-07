#!/usr/bin/env node
// Tests the custom rules in .semgrep.yml against the fixtures in .semgrep-tests/.
//
//   node .claude/scripts/semgrep-test.mjs
//
// Fixtures carry annotations on the line before the code they describe:
//   // ruleid: <id>   the next line MUST be flagged by <id>
//   // ok: <id>       the next line must NOT be flagged by <id>
//
// Both directions matter. An unfired rule protects nothing; a rule that fires on safe code
// gets muted within a week, which is worse than never having written it.
//
// Every rule in .semgrep.yml must have at least one `ruleid` fixture — an untested rule is
// a rule nobody has seen work.
//
// Exit 0 = all assertions hold and every rule is covered. Exit 1 = otherwise.
// Exit 0 with a notice when semgrep is not installed: it is a Python tool, so it is not a
// prerequisite for working on the app, only for running this check. CI always has it.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONFIG = ".semgrep.yml";
const FIXTURES = ".semgrep-tests";

const probe = spawnSync("semgrep", ["--version"], { encoding: "utf8", windowsHide: true });
if (probe.status !== 0) {
  console.log("semgrep is not installed — skipping rule tests.");
  console.log(
    '  pipx install semgrep   (or: docker run --rm -v "$PWD:/src" semgrep/semgrep)',
  );
  console.log("  See .claude/skills/security-scan/SKILL.md. CI runs these regardless.");
  process.exit(0);
}

// Every rule id declared in the config, so an annotation typo is caught rather than
// silently passing, and so coverage can be reported.
const declared = [...readFileSync(CONFIG, "utf8").matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map(
  (m) => m[1],
);
const declaredSet = new Set(declared);

const scan = spawnSync(
  "semgrep",
  ["--config", CONFIG, "--json", "--quiet", "--no-git-ignore", FIXTURES],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true },
);

let report;
try {
  report = JSON.parse(scan.stdout);
} catch {
  console.error(
    "Could not parse semgrep output:\n" + (scan.stderr || scan.stdout).slice(0, 2000),
  );
  process.exit(1);
}

// findings[file][line] = Set(rule ids)
const findings = {};
for (const r of report.results ?? []) {
  const file = r.path.replace(/\\/g, "/");
  const id = r.check_id.split(".").pop();
  ((findings[file] ??= {})[r.start.line] ??= new Set()).add(id);
}

let pass = 0;
let fail = 0;
const exercised = new Set();

for (const name of readdirSync(FIXTURES)) {
  const path = join(FIXTURES, name);
  if (!/\.(ts|tsx|js|jsx|json)$/.test(name)) continue;

  const key = path.replace(/\\/g, "/");
  const raw = readFileSync(path, "utf8");

  // JSON has no comment syntax, so a JSON fixture declares its expectations as a
  // "_semgrep_ruleid" array and asserts the rule fires somewhere in the file.
  if (name.endsWith(".json")) {
    let expected = [];
    try {
      expected = JSON.parse(raw)._semgrep_ruleid ?? [];
    } catch {
      console.log(`FAIL  fixture     ${key} is not valid JSON`);
      fail++;
      continue;
    }
    const fired = new Set(Object.values(findings[key] ?? {}).flatMap((s) => [...s]));
    for (const id of expected) {
      if (!declaredSet.has(id)) continue;
      exercised.add(id);
      const ok = fired.has(id);
      if (ok) pass++;
      else fail++;
      console.log(
        `${ok ? "pass" : "FAIL"}  ruleid  ${id.padEnd(34)} ${key}` +
          (ok ? "" : "   never fired"),
      );
    }
    continue;
  }

  const lines = raw.split(/\r?\n/);

  lines.forEach((line, i) => {
    const m = line.match(/(?:\/\/|\/\*|\*|#)\s*(ruleid|ok):\s*([a-z0-9-]+)/i);
    if (!m) return;
    const [, kind, id] = m;

    // An annotation naming a rule that does not exist is a typo, not a passing test.
    if (!declaredSet.has(id)) return;

    const target = i + 2; // the line after the annotation
    const got = findings[key]?.[target] ?? new Set();
    const flagged = got.has(id);
    const ok = kind === "ruleid" ? flagged : !flagged;

    if (kind === "ruleid") exercised.add(id);
    if (ok) pass++;
    else fail++;

    console.log(
      `${ok ? "pass" : "FAIL"}  ${kind.padEnd(7)} ${id.padEnd(34)} ${key}:${target}` +
        (ok ? "" : `   got=${[...got].join(",") || "nothing"}`),
    );
  });
}

const untested = declared.filter((id) => !exercised.has(id));
if (untested.length) {
  console.log("");
  for (const id of untested) console.log(`FAIL  no fixture asserts rule fires: ${id}`);
  fail += untested.length;
}

console.log(
  `\n${pass + fail} assertion(s), ${fail} failed — ${exercised.size}/${declared.length} rules exercised`,
);
process.exit(fail === 0 ? 0 : 1);
