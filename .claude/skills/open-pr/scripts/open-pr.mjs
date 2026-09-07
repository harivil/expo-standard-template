#!/usr/bin/env node
// Push the current branch and open a pull request whose body renders the app's screenshots.
//
//   node .claude/skills/open-pr/scripts/open-pr.mjs <slug> --capture --what "one sentence"
//
//   <slug>          the change's kebab-case slug — names the evidence folder and the artifacts
//   --capture       screenshot the running app now, as the 'after' phase
//   --surfaces      override the surfaces; the default is what this OS can actually do
//   --images <dir>  take the files from this folder instead of .evidence/<slug>/
//   --what "..."    the 'What changed' paragraph; without it the template's prompt is left
//   --title "..."   PR title; defaults to the last commit subject
//   --base <branch> base branch; defaults to the repository's default branch
//   --draft         open it as a draft, which skips the review gate
//   --allow-dirty   open the PR with uncommitted work in the tree
//   --dry-run       print the body and change nothing on the remote
//
// The order matters and is the whole point:
//
//   preflight → capture → host the images → push the branch → open the PR with a body that
//   already renders them
//
// The images are hosted *before* the PR exists, which is possible because the upload endpoint
// wants a repository id rather than a pull request — see ../references/image-hosting.md. That
// buys one thing worth having: the PR is never briefly published with broken images or local
// paths in its body, so nobody reviews the wrong version of it.
//
// Nothing here can touch the default branch: it pushes the branch you are standing on, and
// refuses outright when that is the base.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { host as hostImages, routes } from "./upload-attachments.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");

// The gate, shared with .claude/hooks/guard-pr.mjs. This script calls `gh` from inside node,
// where no Claude Code hook can see it — so the script that opens pull requests has to ask the
// same question the hook asks, or it would be the one way around the gate.
let receipt = null;
try {
  receipt = await import("../../../scripts/ci-receipt.mjs");
} catch {
  receipt = null;
}

// ---------------------------------------------------------------- arguments

const [, , slugArg, ...rest] = process.argv;

const flag = (n) => rest.includes(n);
const val = (n, d) => {
  const i = rest.indexOf(n);
  return i !== -1 && rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[i + 1] : d;
};

if (!slugArg || slugArg.startsWith("--")) {
  console.error(
    'usage: node open-pr.mjs <slug> [--capture] [--what "..."] [--title "..."]\n' +
      "                              [--surfaces ios,android,web] [--images <dir>]\n" +
      "                              [--base main] [--draft] [--allow-dirty] [--dry-run]\n",
  );
  process.exit(1);
}

// What this machine can actually capture. There is no iOS simulator for Windows, so asking for
// one there produces a gap in the manifest rather than a screenshot — better to say so up front
// than to let every Windows PR report iOS as "unavailable" and train people to ignore it.
const DEFAULT_SURFACES = process.platform === "darwin" ? "ios,android,web" : "web,android";

const slug = slugArg;
const base = val("--base", "");
const surfaces = val("--surfaces", DEFAULT_SURFACES)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const dryRun = flag("--dry-run");
const draft = flag("--draft");

// ---------------------------------------------------------------- shelling out

function run(cmd, args, { timeout = 180000 } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
  return {
    ok: r.status === 0 && !r.error,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim() || String(r.error ?? ""),
  };
}
const git = (...a) => run("git", a);
const gh = (...a) => run("gh", a);

const say = (s = "") => console.log(s);
const fail = (lines) => {
  console.error("\nCannot open the PR yet:\n");
  for (const l of lines) console.error(`  - ${l}`);
  console.error("");
  process.exit(1);
};

// ---------------------------------------------------------------- preflight

const inRepo = git("rev-parse", "--is-inside-work-tree");
if (!inRepo.ok) fail(["this is not a git repository"]);

const branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout;
const info = routes();
const baseBranch = base || info.repo?.defaultBranch || "main";

const problems = [];
if (!info.gh) problems.push("the GitHub CLI is not installed — see cli.github.com");
else if (!info.ghAuth) problems.push("gh is not signed in — run 'gh auth login'");
if (branch === baseBranch)
  problems.push(
    `you are on ${branch}, which is the base — a PR needs its own branch: git switch -c ${slug}`,
  );
if (!flag("--allow-dirty")) {
  const dirty = git("status", "--porcelain").stdout;
  if (dirty)
    problems.push(
      "there is uncommitted work — commit it, or pass --allow-dirty to open the PR without it:\n" +
        dirty
          .split(/\r?\n/)
          .slice(0, 10)
          .map((l) => `      ${l}`)
          .join("\n"),
    );
}

// The review gate. A draft is exempt, exactly as it is in the hook: sharing unfinished work is
// not the failure being guarded against.
if (!draft && !process.env.CLAUDE_SKIP_CI_PREFLIGHT && receipt) {
  const why = receipt.unproven();
  if (why)
    problems.push(
      `${why}\n` +
        `      run the gate, fix what it reports, then try again:  ${receipt.RUN}\n` +
        `      or share work in progress instead:                  --draft`,
    );
}

if (problems.length && !dryRun) fail(problems);
if (problems.length) for (const p of problems) say(`  (dry run, ignoring) ${p}`);

// ---------------------------------------------------------------- capture

if (flag("--capture")) {
  say(`\nCapturing the app as it is now — surfaces: ${surfaces.join(", ")}`);
  // The repo's own capture script, not a second one. It writes .evidence/<slug>/manifest.json,
  // records a surface it cannot reach as a typed gap, and is what capture-evidence documents.
  spawnSync(
    process.execPath,
    [
      join(ROOT, ".claude", "scripts", "capture.mjs"),
      "after",
      slug,
      "--surfaces",
      surfaces.join(","),
    ],
    { cwd: ROOT, stdio: "inherit", windowsHide: true },
  );
}

// ---------------------------------------------------------------- gather the evidence

const MEDIA = /\.(png|jpe?g|gif|webp|mp4|mov|webm)$/i;
const surfaceOf = (file) => {
  const n = basename(file).toLowerCase();
  return surfaces.find((s) => n.includes(s)) ?? "other";
};
// One spelling of a path, everywhere. A manifest written on macOS records a/b/c and a Windows
// directory scan produces a\b\c, and comparing the two raw is how the same screenshot ends up
// in the PR twice.
const norm = (p) => p.replace(/\\/g, "/");

/** Everything worth showing, plus every surface that could not be shown and why. */
function gather() {
  const shots = [];
  const gaps = [];
  const imagesDir = val("--images");

  if (imagesDir) {
    if (!existsSync(imagesDir)) fail([`--images ${imagesDir} does not exist`]);
    for (const f of readdirSync(imagesDir).filter((f) => MEDIA.test(f))) {
      shots.push({ phase: "after", surface: surfaceOf(f), file: norm(join(imagesDir, f)) });
    }
    return { shots, gaps };
  }

  const manifestPath = join(ROOT, ".evidence", slug, "manifest.json");
  if (existsSync(manifestPath)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = null;
    }
    for (const [phase, entry] of Object.entries(manifest?.phases ?? {})) {
      for (const r of entry.results ?? []) {
        const file = r.detail ? resolve(ROOT, r.detail) : "";
        if (r.status === "captured" && file && existsSync(file)) {
          shots.push({ phase, surface: r.surface, file: norm(r.detail) });
        } else if (r.status !== "captured") {
          gaps.push({ phase, surface: r.surface, status: r.status, detail: r.detail });
        }
      }
    }
  }

  // A file on disk that the manifest never mentioned still belongs in the PR.
  for (const phase of ["before", "after"]) {
    const dir = join(ROOT, ".evidence", slug, phase);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => MEDIA.test(f))) {
      const file = norm(join(".evidence", slug, phase, f));
      if (!shots.some((s) => s.file === file)) {
        shots.push({ phase, surface: surfaceOf(f), file });
      }
    }
  }
  return { shots, gaps };
}

const { shots, gaps } = gather();

say(`\nEvidence for '${slug}': ${shots.length} file(s), ${gaps.length} gap(s)`);
for (const s of shots) say(`  ${s.phase.padEnd(6)} ${s.surface.padEnd(8)} ${s.file}`);
for (const g of gaps)
  say(`  ${g.phase.padEnd(6)} ${g.surface.padEnd(8)} ${g.status}: ${g.detail}`);

// ---------------------------------------------------------------- the body

const GAP_WORDING = {
  "impossible-here": "not possible on this machine",
  unavailable: "not running when captured",
  manual: "captured by hand",
  "unknown-surface": "unknown surface",
};

/** One image: rendered, inline video, or the local path when hosting fell through. */
function image(shot, hosted) {
  const url = hosted[shot.file];
  if (!url) return `\`${norm(shot.file)}\``;
  if (/\.(mp4|mov|webm)$/i.test(shot.file)) return url; // GitHub renders these inline
  const appearance = /-dark\./i.test(shot.file)
    ? " dark"
    : /-light\./i.test(shot.file)
      ? " light"
      : "";
  return `<img src="${url}" width="300" alt="${shot.surface}${appearance} ${shot.phase}">`;
}

/**
 * One table cell. A surface can have more than one shot per phase — web is captured light
 * **and** dark, which is half of what this repo asks a reviewer to check — so a cell that
 * showed only the first one would quietly hide the other appearance.
 */
function cell(list, hosted, blank) {
  if (!list.length) return blank;
  return list.map((s) => image(s, hosted)).join(" ");
}

function evidenceTable(hosted) {
  const rows = ["| Surface | Before | After |", "| ------- | ------ | ----- |"];
  const label = { ios: "iOS", android: "Android", web: "Web" };
  const seen = new Set([...shots, ...gaps].map((s) => s.surface));
  for (const surface of [...surfaces, ...[...seen].filter((s) => !surfaces.includes(s))]) {
    const before = shots.filter((s) => s.surface === surface && s.phase === "before");
    const after = shots.filter((s) => s.surface === surface && s.phase === "after");
    if (!before.length && !after.length && !seen.has(surface)) continue;
    const gap = gaps.find((g) => g.surface === surface);
    const blank = gap ? `_${GAP_WORDING[gap.status] ?? gap.status}_` : "—";
    rows.push(
      `| ${label[surface] ?? surface} | ${cell(before, hosted, blank)} | ${cell(after, hosted, blank)} |`,
    );
  }
  return rows.join("\n");
}

function gapNotes() {
  if (!gaps.length) return "";
  // The same missing surface usually shows up in both phases; a reviewer needs to read it once.
  const seen = new Set();
  const lines = [];
  for (const g of gaps) {
    const key = `${g.surface}|${g.status}|${g.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- **${g.surface}** — ${GAP_WORDING[g.status] ?? g.status}: ${g.detail}`);
  }
  return (
    "\n**Unverified surfaces** — each one needs a named owner before merge:\n\n" +
    lines.join("\n") +
    "\n"
  );
}

/** Everything an unaided capture cannot reach, said once, so it is not mistaken for coverage. */
function authNote() {
  return (
    "\n**Behind the login guard:** an unaided capture reaches `/login` and no further, so a " +
    "change to a screen inside `(tabs)` is **not** shown above. Say which screen changed and how " +
    "it was checked — the `verify-app` skill covers running it for real.\n"
  );
}

/** `## What changed` and friends — heading match without building a regex from a string. */
const isHeading = (line, text) =>
  /^#{1,3}\s/.test(line) &&
  line
    .trim()
    .replace(/^#+\s*/, "")
    .toLowerCase() === text.toLowerCase();

/** Replace the paragraph under a heading, leaving the rest of the template untouched. */
function fillSection(lines, heading, text) {
  const at = lines.findIndex((l) => isHeading(l, heading));
  if (at === -1) return lines;
  let start = at + 1;
  while (start < lines.length && !lines[start].trim()) start += 1;
  let end = start;
  while (end < lines.length && lines[end].trim() && !/^#{1,3}\s/.test(lines[end])) end += 1;
  return [...lines.slice(0, start), text, ...lines.slice(end)];
}

function commitList() {
  const log = git("log", "--no-merges", "--pretty=- %s", `${baseBranch}..HEAD`);
  return log.ok && log.stdout ? log.stdout : `- (no commits found against ${baseBranch})`;
}

/**
 * Prefer the repository's own PR template and fill its evidence table in place; a team's
 * checklist is not ours to replace. Without one, write a minimal body of our own.
 */
function composeBody(hosted, title) {
  const templatePath = join(ROOT, ".github", "PULL_REQUEST_TEMPLATE.md");
  const table = evidenceTable(hosted) + "\n" + gapNotes() + authNote();

  if (existsSync(templatePath)) {
    let body = readFileSync(templatePath, "utf8").split(/\r?\n/);
    const start = body.findIndex((l) => /^\|\s*Surface\s*\|/i.test(l));
    if (start !== -1) {
      let end = start;
      while (end < body.length && body[end].trim().startsWith("|")) end += 1;
      body = [...body.slice(0, start), table, ...body.slice(end)];
    } else {
      body = [...body, "", "## Evidence", "", table];
    }
    const what = val("--what");
    if (what) body = fillSection(body, "What changed", what);
    return body
      .join("\n")
      .replace(/^#\s*<slug>.*$/m, `# ${title}`)
      .replace(/<slug>/g, slug);
  }

  return [
    `# ${title}`,
    "",
    "## What changed",
    "",
    val("--what") ?? commitList(),
    "",
    "## Evidence",
    "",
    table,
    "## Verified",
    "",
    "- [ ] Checks green, output read",
    "- [ ] Run on a device or simulator, not only in tests",
    "- [ ] Light **and** dark",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- host, push, open

const lastSubject = git("log", "-1", "--pretty=%s").stdout;
const title = val("--title", lastSubject || slug);

if (dryRun) {
  say("\n--- body (dry run; nothing was hosted, pushed or created) ---\n");
  say(composeBody({}, title));
  say("\n--- end ---");
  say(
    `\nRoutes here: gh ${info.gh ? "yes" : "no"}, signed in ${info.ghAuth ? "yes" : "no"}, ` +
      `upload token ${info.token ? "yes" : "no"}, surfaces ${surfaces.join(",")}`,
  );
} else {
  let hosted = {};
  let route = "none";
  let reason = "";
  if (shots.length) {
    say("\nHosting the evidence so the PR body can render it");
    const r = await hostImages({ files: shots.map((s) => resolve(ROOT, s.file)) });
    // hostImages keys by the absolute path it was handed; the body speaks in repo-relative
    // paths, so map it back rather than teaching the body two spellings of the same file.
    for (const s of shots) {
      const abs = resolve(ROOT, s.file);
      if (r.hosted[abs]) hosted[s.file] = r.hosted[abs];
    }
    route = r.route;
    reason = r.reason ?? "";
    say(`  ${Object.keys(hosted).length} of ${shots.length} hosted via ${route}`);
  }

  say(`\nPushing ${branch}`);
  const pushed = git("push", "--set-upstream", "origin", branch);
  if (!pushed.ok) fail([`git push failed: ${pushed.stderr}`]);
  say(pushed.stderr || "  pushed");

  const tmp = join(tmpdir(), `open-pr-${slug}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const bodyFile = join(tmp, "body.md");
  writeFileSync(bodyFile, composeBody(hosted, title));

  // An existing PR for this branch is updated rather than duplicated.
  const existing = gh("pr", "view", branch, "--json", "number,url");
  let prUrl;
  if (existing.ok) {
    prUrl = JSON.parse(existing.stdout).url;
    say(`\nPR already open: ${prUrl}`);
    const edited = gh("pr", "edit", prUrl, "--body-file", bodyFile);
    if (!edited.ok) {
      rmSync(tmp, { recursive: true, force: true });
      fail([`gh pr edit failed: ${edited.stderr}`]);
    }
  } else {
    const args = [
      "pr",
      "create",
      "--base",
      baseBranch,
      "--head",
      branch,
      "--title",
      title,
      "--body-file",
      bodyFile,
    ];
    if (draft) args.push("--draft");
    const created = gh(...args);
    if (!created.ok) {
      rmSync(tmp, { recursive: true, force: true });
      fail([`gh pr create failed: ${created.stderr}`]);
    }
    prUrl = created.stdout.split(/\s+/).find((s) => s.startsWith("http")) ?? created.stdout;
    say(`\nOpened ${prUrl}`);
  }
  rmSync(tmp, { recursive: true, force: true });

  // ---------------------------------------------------------------- report

  say("\n" + "-".repeat(70));
  say(`PR         ${prUrl}`);
  say(`Images     ${Object.keys(hosted).length} of ${shots.length} hosted via ${route}`);
  if (route === "manual" && shots.length) {
    say(
      `\nThe upload route was not usable (${reason}).\n` +
        "The body lists the local paths instead — open the PR and drag these files into it:",
    );
    for (const s of shots) say(`  ${s.file}`);
    say("\nTo check the route on this machine: node upload-attachments.mjs --probe");
  }
  if (gaps.length) {
    say(
      `\n${gaps.length} surface(s) went unverified and are named in the body. Give each one an\n` +
        "owner in the PR thread — a written gap gets picked up, an implied one ships broken.",
    );
  }
  if (!val("--what")) {
    say(
      "\nThe body still carries the template's own prompts. Fill them in before asking for a\n" +
        "review — a PR describing itself as 'One paragraph.' has not been written yet.",
    );
  }
  say("-".repeat(70));
}
