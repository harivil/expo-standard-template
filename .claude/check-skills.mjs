#!/usr/bin/env node
// Structural checks on the skills and agents in this repo.
//
//   node .claude/check-skills.mjs
//
// Catches the failures that silently stop a skill working: frontmatter that does not parse,
// a name that does not match its folder, a missing description on a model-invoked skill, and
// — the most common one — a pointer to a reference file that has been renamed or deleted.
//
// Exit 0 = everything resolves. Exit 1 = at least one problem.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const CLAUDE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(CLAUDE_DIR, "..");

const problems = [];
const note = (file, msg) =>
  problems.push(`${relative(ROOT, file).replace(/\\/g, "/")}: ${msg}`);

/** Minimal frontmatter reader — enough for `key: value` pairs, which is all a skill uses. */
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

/** Every markdown link in the body that points at a local file. */
function localLinks(text) {
  const out = [];
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const href = m[1];
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) out.push(href);
  }
  return out;
}

function checkDoc(file, { requireName, folderName }) {
  const text = readFileSync(file, "utf8");
  const fm = frontmatter(text);

  if (!fm) {
    note(file, "no YAML frontmatter — the file will not be loaded");
    return;
  }
  if (requireName) {
    if (!fm.name) note(file, "frontmatter is missing `name`");
    else if (fm.name !== folderName)
      note(file, `name "${fm.name}" does not match its folder "${folderName}"`);
  }
  if (!fm.description) {
    note(file, "frontmatter is missing `description` — nothing can discover this");
  } else if (fm.description.length < 30) {
    note(file, "description is too short to trigger reliably");
  }

  for (const href of localLinks(text)) {
    const target = resolve(dirname(file), href);
    if (!existsSync(target)) note(file, `broken link: ${href}`);
  }

  // A pointer written as `references/foo.md` in prose rather than as a link.
  for (const m of text.matchAll(/`(references\/[\w.-]+\.md)`/g)) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) note(file, `broken reference: ${m[1]}`);
  }
}

function dirs(p) {
  if (!existsSync(p)) return [];
  return readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory());
}

// Skills: .claude/skills/<name>/SKILL.md
const skillsDir = join(CLAUDE_DIR, "skills");
const skills = dirs(skillsDir);
if (skills.length === 0) problems.push("no skills found under .claude/skills/");
for (const name of skills) {
  const file = join(skillsDir, name, "SKILL.md");
  if (!existsSync(file)) {
    note(join(skillsDir, name), "folder has no SKILL.md");
    continue;
  }
  checkDoc(file, { requireName: true, folderName: name });
}

// Agents: .claude/agents/<name>.md
const agentsDir = join(CLAUDE_DIR, "agents");
if (existsSync(agentsDir)) {
  for (const f of readdirSync(agentsDir).filter((n) => n.endsWith(".md"))) {
    checkDoc(join(agentsDir, f), { requireName: true, folderName: f.replace(/\.md$/, "") });
  }
}

// Every agent a skill dispatches by name must exist.
const agentNames = new Set(
  existsSync(agentsDir)
    ? readdirSync(agentsDir)
        .filter((n) => n.endsWith(".md"))
        .map((n) => n.replace(/\.md$/, ""))
    : [],
);
for (const name of skills) {
  const file = join(skillsDir, name, "SKILL.md");
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\*\*`([a-z][a-z0-9-]*)`\*\* agent/g)) {
    if (!agentNames.has(m[1]))
      note(file, `dispatches agent "${m[1]}", which has no .claude/agents/${m[1]}.md`);
  }
}

// ---------------------------------------------------------------- portability
//
// This team works on Windows and macOS, with Claude Code or Codex. A shell script or a
// hardcoded drive letter works fine for whoever wrote it and breaks silently for everyone
// else — the worst failure shape, because it looks like the repo is broken rather than the
// commit. Catch it here rather than in someone's first hour on a new laptop.

const PORTABILITY = [
  {
    what: "OS-specific shell scripts",
    files: /\.(ps1|bat|cmd|sh|zsh|fish)$/i,
    fix: "write it as a Node script (.mjs) — node is already a dependency of this project",
  },
];

// `codeOnly` rules fire only where the text is actually executable — inside a fenced block,
// inside backticks, or on a `run:` line. Documentation has to be able to name the thing it
// forbids ("no PowerShell-only scripts") without tripping the check that forbids it. Guessing
// at prose by keyword is what produces the false positives that teach people to ignore a check.
const CONTENT_RULES = [
  {
    re: /\bpwsh\b|\bpowershell\b/i,
    why: "PowerShell does not exist on macOS",
    codeOnly: true,
  },
  { re: /\bSet-Location\b|\$env:[A-Za-z_]/, why: "PowerShell-only syntax", codeOnly: true },
  {
    re: /%USERPROFILE%|%APPDATA%/i,
    why: "Windows-only environment syntax",
    codeOnly: false,
  },
  {
    re: /(^|[\s"'`(])[A-Za-z]:\\\\?[A-Za-z0-9_.]/,
    why: "a hardcoded Windows drive path",
    codeOnly: true,
    // A test necessarily contains the inputs it tests: hooks.test.mjs asserts that a Windows
    // absolute path is blocked, which it cannot do without writing one down.
    allowTests: true,
  },
];

/**
 * Reduce each line to the part that would actually execute, so a rule matches the command and
 * not the sentence describing it. Returns "" for a line that is entirely prose.
 *
 *   markdown prose   → only what sits inside `backticks`
 *   fenced block     → the whole line
 *   `run:` / `$ `    → the whole line
 *   .mjs / .ts       → the line minus its // and /* *​/ comments
 *
 * Classifying whole lines was the earlier mistake: a sentence carrying one unrelated code span
 * is not code, and a comment inside a script is not code either.
 */
function executableText(lines, isScript) {
  let fenced = false;
  let blockComment = false;

  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return "";
    }
    if (fenced) return line;
    if (/^\s*(run:|\$ |> \$)/.test(line)) return line;

    if (isScript) {
      let s = line;
      if (blockComment) {
        const end = s.indexOf("*/");
        if (end === -1) return "";
        blockComment = false;
        s = s.slice(end + 2);
      }
      s = s.replace(/\/\*.*?\*\//g, " ");
      const open = s.indexOf("/*");
      if (open !== -1) {
        blockComment = true;
        s = s.slice(0, open);
      }
      return s.replace(/\/\/.*$/, "");
    }

    // Markdown: only the inline code spans are executable.
    return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]).join(" ");
  });
}

/** Walk the repo, skipping anything generated or vendored. */
function walk(dir, out = []) {
  const SKIP = new Set([
    "node_modules",
    ".git",
    ".expo",
    "dist",
    "build",
    "coverage",
    ".evidence",
    "ios",
    "android",
    // husky's own generated runtime. It ships a POSIX shell script we neither wrote nor
    // commit (husky gitignores .husky/_ itself), so sweeping it produces a finding nobody
    // can act on. The git hooks we DO own are extensionless and portable.
    "_",
  ]);
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const TEXT = /\.(md|mjs|cjs|js|jsx|ts|tsx|json|ya?ml|txt)$/i;
const files = walk(ROOT);

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");

  for (const rule of PORTABILITY) {
    if (rule.files.test(rel)) note(file, `${rule.what} — ${rule.fix}`);
  }

  if (!TEXT.test(rel)) continue;
  // This file necessarily contains the patterns it bans, and the PR template and gitignore
  // legitimately describe them. Exempt by path, not by a magic comment nobody would notice.
  if (/^\.claude\/check-skills\.mjs$/.test(rel)) continue;

  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  const isTestFile = /\.(test|spec)\.[mc]?[jt]sx?$/.test(rel);
  const isScript = /\.[mc]?[jt]sx?$/.test(rel);
  const code = executableText(lines, isScript);

  for (const rule of CONTENT_RULES) {
    if (rule.allowTests && isTestFile) continue;
    lines.forEach((line, i) => {
      const subject = rule.codeOnly ? code[i] : line;
      if (!subject || !rule.re.test(subject)) return;
      note(file, `line ${i + 1}: ${rule.why} — "${line.trim().slice(0, 70)}"`);
    });
  }
}

// `shell: true` re-introduces per-OS quoting rules through the back door.
//
// Reduced to executable text first, for the same reason the rules above are: a comment
// explaining why a script no longer passes `shell: true` has to be able to write it down.
// Flagging the explanation is the false positive that teaches people to ignore the check.
for (const file of files.filter(
  (f) => /\.mjs$/.test(f) && relative(ROOT, f).includes(".claude"),
)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (rel === ".claude/check-skills.mjs") continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const code = executableText(lines, true);
  lines.forEach((line, i) => {
    if (!/shell:\s*true/.test(code[i] ?? "")) return;
    // format-after-edit needs it: npx on Windows is a .cmd shim that spawn cannot exec.
    if (/process\.platform === "win32"/.test(line)) return;
    note(
      file,
      `line ${i + 1}: 'shell: true' brings per-OS quoting rules back — pass an argument array instead`,
    );
  });
}

// ---------------------------------------------------------------- CI parity
//
// ci-local.mjs — what `npm run verify` runs — claims to run what CI runs. That claim decays the
// moment someone adds a job to a workflow and not to the script: silently, because the script
// still passes and now proves less than the person running it believes. The preflight-ci skill
// says to change both; this is what makes that hold when nobody remembers reading it.
//
// A new job forces a decision rather than a default: cover it locally, or name it here as
// something no local run can honestly stand in for.
{
  const LOCAL_EXEMPT = new Map([
    ["codeql", "no practical local runner; needs GitHub Code Security on the repo"],
    [
      "zap-web",
      "weekly, and needs a served build rather than a source tree — see the dast-scan skill",
    ],
    [
      "commits",
      "enforced locally per commit by the husky commit-msg hook, not per verify run",
    ],
    [
      "artifacts",
      "needs the pull request to exist — it reads the PR's own diff against base",
    ],
    ["test-integrity", "needs a base ref to diff against, which a local run may not have"],
    [
      "dependencies",
      "npm audit and Dependabot read advisory data that changes without the code, so a local pass does not stay true",
    ],
  ]);

  const script = join(CLAUDE_DIR, "scripts", "ci-local.mjs");
  const workflows = join(ROOT, ".github", "workflows");

  if (existsSync(script) && existsSync(workflows)) {
    // Job ids are the two-space-indented keys under `jobs:`. Regex rather than a YAML parser
    // on purpose: this file must run with no dependencies installed.
    const declared = new Map();
    for (const name of readdirSync(workflows).filter((n) => /\.ya?ml$/.test(n))) {
      const text = readFileSync(join(workflows, name), "utf8");
      const body = text.slice(text.search(/^jobs:\s*$/m));
      for (const m of body.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm))
        declared.set(m[1], name);
    }

    const covered = new Set();
    const scriptText = readFileSync(script, "utf8");
    for (const m of scriptText.matchAll(/^\s*job:\s*"([^"]+)"/gm)) {
      // A check can stand in for more than one job — write it as "a+b".
      for (const part of m[1].split("+")) covered.add(part.trim());
    }

    for (const job of covered) {
      if (!declared.has(job)) {
        note(
          script,
          `claims CI job "${job}", which no workflow defines — renamed or removed?`,
        );
      }
    }
    for (const [job, file] of declared) {
      if (covered.has(job) || LOCAL_EXEMPT.has(job)) continue;
      note(
        join(workflows, file),
        `job "${job}" has no check in ci-local.mjs — add one, or exempt it in check-skills.mjs ` +
          `with the reason it cannot run locally`,
      );
    }
  }
}

if (problems.length) {
  console.error("Problems found:\n");
  for (const p of problems) console.error("  " + p);
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  process.exit(1);
}

console.log(
  `OK — ${skills.length} skill(s), ${agentNames.size} agent(s), ${files.length} file(s) swept.\n` +
    `     Links and pointers resolve; nothing OS-specific.`,
);
