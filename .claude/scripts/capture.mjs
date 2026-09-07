#!/usr/bin/env node
// Capture screenshots and screen recordings of the running app, for PR evidence.
//
//   node .claude/scripts/capture.mjs before <slug> [--surfaces ios,android,web] [--record]
//   node .claude/scripts/capture.mjs after  <slug> [--surfaces ios,android,web] [--record]
//
// Writes to .evidence/<slug>/<before|after>/ and updates .evidence/<slug>/manifest.json.
//
// Cross-platform by construction: no shell syntax, no PowerShell, no bash. It shells out
// only to tools that exist on more than one OS, and where a tool genuinely cannot exist on
// this machine (an iOS simulator on Windows) it records that as a gap rather than failing.
// A gap you can see is reviewable; a silent skip is not.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RECORD_SECONDS = 12;

// Resolved from this file rather than the working directory, so capture works from anywhere.
const SHOOT_WEB = resolve(dirname(fileURLToPath(import.meta.url)), "shoot-web.mjs");

// ---------------------------------------------------------------- arguments

const [, , phaseArg, slugArg, ...rest] = process.argv;
const phase = phaseArg;
const slug = slugArg;

if (!["before", "after"].includes(phase) || !slug) {
  console.error(
    "usage: node .claude/scripts/capture.mjs <before|after> <slug> [--surfaces ios,android,web] [--record]\n" +
      "\n" +
      "  before   capture the current state, BEFORE you change anything\n" +
      "  after    capture the same views once the change is built\n" +
      "  --record also capture a screen recording, not just a still\n",
  );
  process.exit(1);
}

const flag = (name) => rest.includes(name);
const value = (name, fallback) => {
  const i = rest.indexOf(name);
  return i !== -1 && rest[i + 1] ? rest[i + 1] : fallback;
};

const surfaces = value("--surfaces", "ios,android,web")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const wantRecording = flag("--record");

const outDir = join(".evidence", slug, phase);
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- helpers

/** Run a command without a shell. Returns {ok, stdout, stderr}. Never throws. */
function run(cmd, args, { buffer = false, timeout = 120000 } = {}) {
  try {
    const r = spawnSync(cmd, args, {
      encoding: buffer ? "buffer" : "utf8",
      timeout,
      windowsHide: true,
    });
    return {
      ok: r.status === 0 && !r.error,
      stdout: r.stdout,
      stderr: buffer ? String(r.stderr ?? "") : (r.stderr ?? ""),
    };
  } catch (e) {
    return { ok: false, stdout: buffer ? Buffer.alloc(0) : "", stderr: String(e) };
  }
}

const have = (cmd, args = ["--version"]) => run(cmd, args, { timeout: 15000 }).ok;

const results = [];
const record = (surface, kind, status, detail) =>
  results.push({ surface, kind, status, detail });

// ---------------------------------------------------------------- android

function androidShot() {
  const file = join(outDir, "android.png");
  const r = run("adb", ["exec-out", "screencap", "-p"], { buffer: true });
  if (!r.ok || !r.stdout || r.stdout.length < 100) {
    return record(
      "android",
      "screenshot",
      "unavailable",
      "no booted emulator or device (adb)",
    );
  }
  writeFileSync(file, r.stdout);
  record("android", "screenshot", "captured", file);
}

function androidVideo() {
  const remote = "/sdcard/capture.mp4";
  const file = join(outDir, "android.mp4");
  console.log(`  recording android for ${RECORD_SECONDS}s — exercise the flow now`);
  const rec = run(
    "adb",
    ["shell", "screenrecord", "--time-limit", String(RECORD_SECONDS), remote],
    { timeout: (RECORD_SECONDS + 30) * 1000 },
  );
  if (!rec.ok) {
    return record(
      "android",
      "recording",
      "unavailable",
      "screenrecord failed (emulators vary)",
    );
  }
  const pull = run("adb", ["pull", remote, file], { timeout: 60000 });
  run("adb", ["shell", "rm", remote]);
  if (!pull.ok || !existsSync(file)) {
    return record("android", "recording", "unavailable", "could not pull the recording");
  }
  record("android", "recording", "captured", file);
}

// ---------------------------------------------------------------- ios

function iosShot() {
  if (process.platform !== "darwin") {
    return record(
      "ios",
      "screenshot",
      "impossible-here",
      "the iOS simulator only exists on macOS — a Mac teammate or a macOS CI runner covers this",
    );
  }
  const file = join(outDir, "ios.png");
  const r = run("xcrun", ["simctl", "io", "booted", "screenshot", file]);
  if (!r.ok || !existsSync(file)) {
    return record("ios", "screenshot", "unavailable", "no booted simulator (xcrun simctl)");
  }
  record("ios", "screenshot", "captured", file);
}

function iosVideo() {
  if (process.platform !== "darwin") {
    return record(
      "ios",
      "recording",
      "impossible-here",
      "iOS simulator recording requires macOS",
    );
  }
  const file = join(outDir, "ios.mp4");
  console.log(`  recording ios for ${RECORD_SECONDS}s — exercise the flow now`);
  // recordVideo runs until interrupted; give it a deadline and take what it wrote.
  const r = spawnSync("xcrun", ["simctl", "io", "booted", "recordVideo", "--force", file], {
    timeout: RECORD_SECONDS * 1000,
    killSignal: "SIGINT", // SIGINT makes simctl finalise the file; SIGKILL corrupts it
    windowsHide: true,
  });
  if (!existsSync(file)) {
    return record(
      "ios",
      "recording",
      "unavailable",
      `recordVideo produced nothing (${r.error ?? "no booted simulator"})`,
    );
  }
  record("ios", "recording", "captured", file);
}

// ---------------------------------------------------------------- web

// Delegated to shoot-web.mjs, which exports the app and serves the export rather than asking
// for a dev server to already be running. Three reasons that is the right shape here:
//
//   - it needs nothing running, so one command is genuinely one command
//   - the Metro dev server never fires the browser `load` event in this project, so a plain
//     `playwright screenshot` against :8081 waits out its timeout and reports a false gap
//   - it shoots light AND dark, which is half of what this repo asks a reviewer to check
//
// It is a separate script because it is worth running on its own, and because the export and
// the little static server are more machinery than belongs inside this file.
function webShot() {
  if (!existsSync(SHOOT_WEB)) {
    return record("web", "screenshot", "unavailable", `${SHOOT_WEB} is missing`);
  }

  const r = spawnSync(process.execPath, [SHOOT_WEB, outDir], {
    stdio: "inherit",
    timeout: 12 * 60 * 1000,
    windowsHide: true,
  });

  for (const scheme of ["light", "dark"]) {
    const file = join(outDir, `web-${scheme}.png`);
    if (existsSync(file)) {
      record("web", `screenshot (${scheme})`, "captured", file);
    } else {
      record(
        "web",
        `screenshot (${scheme})`,
        "unavailable",
        r.error
          ? `shoot-web.mjs could not run: ${r.error}`
          : "shoot-web.mjs produced nothing — read its output above",
      );
    }
  }
}

function webVideo() {
  record(
    "web",
    "recording",
    "manual",
    "record the browser with the OS recorder or Playwright trace, and attach it to the PR",
  );
}

// ---------------------------------------------------------------- run

console.log(`Capturing ${phase} for '${slug}' — surfaces: ${surfaces.join(", ")}`);

for (const s of surfaces) {
  if (s === "android") {
    androidShot();
    if (wantRecording) androidVideo();
  } else if (s === "ios") {
    iosShot();
    if (wantRecording) iosVideo();
  } else if (s === "web") {
    webShot();
    if (wantRecording) webVideo();
  } else {
    record(s, "screenshot", "unknown-surface", `not one of ios, android, web`);
  }
}

// ---------------------------------------------------------------- manifest

const manifestPath = join(".evidence", slug, "manifest.json");
let manifest = { slug, phases: {} };
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    /* start fresh rather than fail the capture */
  }
}
manifest.phases[phase] = {
  at: new Date().toISOString(),
  platform: process.platform,
  results,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// ---------------------------------------------------------------- report

const icon = {
  captured: "  ok  ",
  unavailable: " miss ",
  "impossible-here": " n/a  ",
  manual: "manual",
  "unknown-surface": " ???  ",
};
for (const r of results) {
  console.log(`${icon[r.status] ?? "      "} ${r.surface}/${r.kind}: ${r.detail}`);
}

const captured = results.filter((r) => r.status === "captured").length;
const gaps = results.filter(
  (r) => r.status === "unavailable" || r.status === "impossible-here",
);

console.log(
  `\n${captured} captured into ${outDir}, ${gaps.length} gap(s), manifest at ${manifestPath}`,
);

if (gaps.length) {
  console.log(
    "\nName every gap in the PR rather than leaving it implied. An unverified surface that is\n" +
      "written down can be picked up by someone with the right machine; a silent one cannot.",
  );
}

// Gaps are information, not failure — exit clean so this never blocks the loop.
process.exit(0);
