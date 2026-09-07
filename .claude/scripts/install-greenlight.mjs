#!/usr/bin/env node
// Put the PINNED greenlight on this machine, reproducibly:
//
//   node .claude/scripts/install-greenlight.mjs           install it, print its bin dir
//   node .claude/scripts/install-greenlight.mjs --check    report what is there, install nothing
//
// greenlight is a Go binary, not an npm package, so it does not arrive with `npm install` and
// Dependabot cannot see it. The version lives in ONE place — `.greenlight-version` at the repo
// root — and every consumer reads it from there: this script, the compliance workflow, and both
// release gates. Upgrading is a one-line edit with a visible diff, owned by a human on purpose.
//
// The checksum verification is the point of this script rather than a bare curl. A compliance
// gate that silently ran a substituted binary would be worse than no gate: it would still
// print GREENLIT.
//
// WINDOWS: upstream publishes darwin and linux archives only. There is no Windows binary to
// download, so this reports a typed gap with the two real routes instead of failing obscurely —
// the same shape as capture.mjs reporting "no iOS simulator on Windows". CI is the enforcing
// layer either way.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLAUDE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(CLAUDE_DIR, "..");
const REPO = "RevylAI/greenlight";

const check = process.argv.includes("--check");

// ---------------------------------------------------------------- the pin

function pinnedVersion() {
  const file = join(ROOT, ".greenlight-version");
  if (!existsSync(file)) {
    console.error(
      ".greenlight-version is missing. It is the single pin for the compliance scanner —\n" +
        "restore it rather than installing an unpinned build.",
    );
    process.exit(1);
  }
  const raw = readFileSync(file, "utf8").trim();
  if (!/^\d+\.\d+\.\d+$/.test(raw)) {
    console.error(`.greenlight-version holds "${raw}", which is not an x.y.z version.`);
    process.exit(1);
  }
  return raw;
}

// ---------------------------------------------------------------- what is already here

// `greenlight version` is the real subcommand; cobra does not necessarily wire up --version.
function installedVersion(bin = "greenlight") {
  const probe = spawnSync(bin, ["version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
  });
  if (probe.error || probe.status !== 0) return null;
  // "greenlight 0.2.0" / "greenlight v0.2.0"
  return (probe.stdout || "").trim().replace(/^greenlight\s+v?/i, "") || null;
}

const version = pinnedVersion();
const onPath = installedVersion();

if (check) {
  if (!onPath) {
    console.log(`greenlight  missing        (pinned: ${version})`);
    process.exit(0);
  }
  const agrees = onPath === version;
  console.log(
    `greenlight  ${onPath}${agrees ? "" : `  DRIFT — .greenlight-version pins ${version}`}`,
  );
  process.exit(0);
}

if (onPath) {
  // Never reinstall over a working binary. Report drift; do not silently "fix" a version
  // someone chose deliberately.
  if (onPath !== version) {
    console.error(
      `note: greenlight ${onPath} is on PATH but .greenlight-version pins ${version}.\n` +
        `      Findings may differ from CI. Reinstall the pinned version to match.`,
    );
  }
  process.exit(0);
}

// ---------------------------------------------------------------- windows: a named gap

if (process.platform === "win32") {
  console.error(
    [
      `greenlight ${version} is not installed, and upstream publishes no Windows binary.`,
      "",
      "Two routes that do work here — both give you the pinned version:",
      "",
      "  1. Go toolchain (recommended)",
      "       winget install GoLang.Go",
      `       go install github.com/${REPO}/cmd/greenlight@v${version}`,
      "",
      "  2. WSL2, then treat it as Linux",
      "       node .claude/scripts/install-greenlight.mjs",
      "",
      "Until then `npm run compliance` cannot run on this machine. That is a recorded gap,",
      "not a silent one: the compliance workflow in CI is the enforcing layer.",
    ].join("\n"),
  );
  process.exit(1);
}

// ---------------------------------------------------------------- download, verify, extract

const OS = { darwin: "darwin", linux: "linux" }[process.platform];
const ARCH = { x64: "amd64", arm64: "arm64" }[process.arch];

if (!OS || !ARCH) {
  console.error(
    `No greenlight ${version} archive is published for ${process.platform}/${process.arch}.\n` +
      `Build it instead: go install github.com/${REPO}/cmd/greenlight@v${version}`,
  );
  process.exit(1);
}

const asset = `greenlight_${version}_${OS}_${ARCH}.tar.gz`;
const base = `https://github.com/${REPO}/releases/download/v${version}`;
const dest = join(homedir(), ".cache", "greenlight", version);
const bin = join(dest, "greenlight");

async function get(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`GET ${url} — HTTP ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

try {
  if (!existsSync(bin)) {
    mkdirSync(dest, { recursive: true });

    // checksums.txt is goreleaser's "<sha256>  <filename>" list for the whole release.
    const [archive, checksums] = await Promise.all([
      get(`${base}/${asset}`),
      get(`${base}/checksums.txt`).then((b) => b.toString("utf8")),
    ]);

    const expected = checksums
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .find(([, name]) => name === asset)?.[0];

    if (!expected) {
      throw new Error(`checksums.txt for v${version} does not list ${asset}`);
    }

    const actual = createHash("sha256").update(archive).digest("hex");
    if (actual !== expected) {
      // Refuse rather than proceed. A compliance scanner is exactly the binary you cannot
      // afford to run unverified.
      throw new Error(
        `checksum mismatch for ${asset}\n  expected ${expected}\n  actual   ${actual}`,
      );
    }

    writeFileSync(join(dest, asset), archive);

    // tar ships with macOS, every Linux, and Windows 10+ (bsdtar). Argument array, no shell.
    //
    // Run it FROM the destination with a bare filename rather than passing absolute paths:
    // GNU tar reads any argument containing a colon as a remote `host:path`, so a Windows-shaped
    // path turns into "Cannot connect to C: resolve failed". A relative name has no colon to
    // misread, and it works identically under bsdtar.
    const untar = spawnSync("tar", ["-xzf", asset], {
      cwd: dest,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
    });
    if (untar.error || untar.status !== 0) {
      throw new Error(`tar failed: ${untar.error?.message ?? untar.stderr ?? "unknown"}`);
    }
    if (!existsSync(bin)) {
      throw new Error(`${asset} extracted without a greenlight binary at ${bin}`);
    }
  }

  const got = installedVersion(bin);
  console.error(`greenlight ${got ?? version} ready at ${bin}`);
  // stdout carries ONLY the bin dir, so a workflow can append it to the PATH file.
  console.log(dirname(bin));
} catch (err) {
  console.error(`Could not install greenlight ${version}: ${err.message}`);
  console.error(`Fallback: go install github.com/${REPO}/cmd/greenlight@v${version}`);
  process.exit(1);
}
