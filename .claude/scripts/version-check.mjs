#!/usr/bin/env node
// Checks that this app's version numbers agree with each other and with how EAS is configured.
//
//   node .claude/scripts/version-check.mjs
//
// An Expo app carries four different version numbers with four different owners, and nothing
// in the toolchain makes them agree. The failures are quiet: a build rejected by App Store
// Connect for a duplicate build number, or — the expensive one — an OTA update delivered to a
// binary whose native code cannot run it.
//
// Exit 0 = consistent (warnings allowed). Exit 1 = a real inconsistency.
// Missing files are not failures: this runs before the app exists.

import { readFileSync, existsSync } from "node:fs";

const problems = [];
const warnings = [];
const notes = [];

const readJson = (path) => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    problems.push(`${path} is not valid JSON — ${e.message}`);
    return null;
  }
};

const pkg = readJson("package.json");
const appJson = readJson("app.json");
const easJson = readJson("eas.json");

if (!pkg && !appJson) {
  console.log("No package.json or app.json yet — nothing to check.");
  process.exit(0);
}

if (existsSync("app.config.js") || existsSync("app.config.ts")) {
  notes.push(
    "app.config.js/ts is present. It is evaluated at build time and can override app.json, " +
      "so treat the checks below as covering the static half only.",
  );
}

const expo = appJson?.expo ?? {};
const appVersion = expo.version;
const pkgVersion = pkg?.version;
const semver = /^\d+\.\d+\.\d+(?:[-+].*)?$/;

// ---------------------------------------------------------------- the user-facing version

if (appVersion && !semver.test(appVersion)) {
  problems.push(
    `app.json expo.version is "${appVersion}", which is not semver. Both stores sort versions ` +
      `numerically; a non-semver string is rejected or ordered unpredictably.`,
  );
}

if (pkgVersion && appVersion && pkgVersion !== appVersion) {
  warnings.push(
    `package.json version (${pkgVersion}) and app.json expo.version (${appVersion}) disagree. ` +
      `Only app.json reaches the stores, so this is cosmetic — but a drifting pair is a reliable ` +
      `source of "which one is the real version?" during a release.`,
  );
}

// ---------------------------------------------------------------- who owns the build numbers

const versionSource = easJson?.cli?.appVersionSource;
const iosBuild = expo.ios?.buildNumber;
const androidCode = expo.android?.versionCode;

if (easJson && !versionSource) {
  warnings.push(
    'eas.json does not set cli.appVersionSource. EAS CLI 12+ recommends "remote", which keeps ' +
      "build numbers on EAS and increments them for you.",
  );
}

if (versionSource === "remote") {
  // With remote versioning EAS is the source of truth. A number left in app.json is ignored,
  // so it silently becomes a lie that someone will later reason from.
  if (iosBuild !== undefined) {
    problems.push(
      `appVersionSource is "remote", but app.json pins ios.buildNumber (${iosBuild}). EAS ignores ` +
        `it and manages the number itself — remove it so the file stops disagreeing with reality.`,
    );
  }
  if (androidCode !== undefined) {
    problems.push(
      `appVersionSource is "remote", but app.json pins android.versionCode (${androidCode}). EAS ` +
        `ignores it and manages the number itself — remove it.`,
    );
  }
}

if (versionSource === "local") {
  if (iosBuild === undefined || androidCode === undefined) {
    problems.push(
      `appVersionSource is "local", so YOU own the build numbers, but app.json is missing ` +
        `${iosBuild === undefined ? "ios.buildNumber" : ""}${iosBuild === undefined && androidCode === undefined ? " and " : ""}` +
        `${androidCode === undefined ? "android.versionCode" : ""}. Both stores reject a submission ` +
        `that reuses a build number.`,
    );
  }
  if (androidCode !== undefined && !Number.isInteger(androidCode)) {
    problems.push(
      `android.versionCode must be an integer, found ${JSON.stringify(androidCode)}.`,
    );
  }
}

// autoIncrement only means something under a matching version source.
const profiles = easJson?.build ?? {};
for (const [name, profile] of Object.entries(profiles)) {
  if (profile?.autoIncrement && versionSource === undefined) {
    warnings.push(
      `Build profile "${name}" sets autoIncrement but eas.json has no cli.appVersionSource.`,
    );
  }
}

// ---------------------------------------------------------------- runtimeVersion, the dangerous one

const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
const usesUpdates = "expo-updates" in deps;
const runtime = expo.runtimeVersion;

if (usesUpdates) {
  if (runtime === undefined) {
    problems.push(
      "expo-updates is installed but app.json sets no runtimeVersion. runtimeVersion is what " +
        "stops an update reaching a build whose native code cannot run it — without it, OTA " +
        "compatibility is unenforced.",
    );
  } else {
    const policy = typeof runtime === "object" ? runtime.policy : null;
    if (policy === "sdkVersion" || policy === "nativeVersion") {
      warnings.push(
        `runtimeVersion policy "${policy}" is superseded. "fingerprint" derives the runtime from ` +
          `everything that actually affects native code, which is the only policy that catches a ` +
          `native change nobody remembered to version.`,
      );
    }
    if (policy === "appVersion") {
      notes.push(
        'runtimeVersion policy is "appVersion": an OTA update reaches every build sharing that ' +
          "version string. Change native code without bumping version and the update lands on a " +
          'binary that cannot run it. "fingerprint" removes that footgun.',
      );
    }
    if (typeof runtime === "string") {
      notes.push(
        `runtimeVersion is pinned to "${runtime}". Every native change now needs a manual bump — ` +
          "a policy does this for you.",
      );
    }
  }
}

if (!usesUpdates && runtime !== undefined && pkg) {
  notes.push(
    "runtimeVersion is set but expo-updates is not installed, so nothing consumes it yet.",
  );
}

// ---------------------------------------------------------------- report

const line = (icon, msgs) => msgs.forEach((m) => console.log(`${icon} ${m}\n`));

if (problems.length) {
  console.log("Problems\n");
  line("  ✗", problems);
}
if (warnings.length) {
  console.log("Warnings\n");
  line("  !", warnings);
}
if (notes.length) {
  console.log("Notes\n");
  line("  ·", notes);
}

const summary = [
  appVersion ? `version ${appVersion}` : null,
  versionSource ? `appVersionSource ${versionSource}` : null,
  runtime
    ? `runtimeVersion ${typeof runtime === "object" ? runtime.policy : runtime}`
    : null,
]
  .filter(Boolean)
  .join(" · ");

console.log(
  `${problems.length} problem(s), ${warnings.length} warning(s)` +
    (summary ? `\n${summary}` : ""),
);

process.exit(problems.length ? 1 : 0);
