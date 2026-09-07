#!/usr/bin/env node
// Checks that this project's code-quality toolchain is present *and wired up*, and can create
// the missing pieces.
//
//   node .claude/scripts/toolchain-check.mjs           report
//   node .claude/scripts/toolchain-check.mjs --fix     write what is missing
//
// The failure this exists to stop is not "no config". It is a config file sitting in the repo
// that nothing executes. `commitlint.config.js` was committed here months before
// `@commitlint/cli` was installed: the file looked like enforcement, read like enforcement in
// review, and enforced nothing. Every commit that violated it was accepted.
//
// So each requirement below is checked in two halves — the config, and the thing that runs it.
// A tool counts as present only when both are true.
//
// Four layers, and only the first two survive an agent leaving the project:
//
//   commit time   husky runs lint-staged and commitlint     — catches a human, offline
//   pre-push      ci-local.mjs runs what CI runs            — catches an agent
//   pull request  the verify job runs this script           — catches everyone
//   session       the toolchain-standards skill             — catches the next agent
//
// Exit 0 = everything wired. Exit 1 = something is missing (or --fix wrote it and the install
// still has to run).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = process.argv.includes("--fix");

const pkgPath = join(ROOT, "package.json");
if (!existsSync(pkgPath)) {
  console.log("No package.json on this ref — nothing to standardize yet.");
  console.log("This runs against the branch that carries the app.");
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const dep = (name) => Boolean(pkg.devDependencies?.[name] ?? pkg.dependencies?.[name]);
const script = (name) => Boolean(pkg.scripts?.[name]);
const file = (...p) => existsSync(join(ROOT, ...p));

const written = [];
const install = new Set();
let pkgDirty = false;

const write = (rel, body) => {
  const target = join(ROOT, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
  written.push(rel);
};

const addScript = (name, value) => {
  pkg.scripts = pkg.scripts ?? {};
  if (pkg.scripts[name]) return;
  pkg.scripts[name] = value;
  pkgDirty = true;
  written.push(`package.json → scripts.${name}`);
};

// ---------------------------------------------------------------- the standard

// Matches this repo's own .prettierrc, so a scaffolded project and this one do not disagree.
// Formatting is arbitrary; agreeing on it is not, and the only wrong answer is two answers in
// one repo — that is what produces diffs where every line changed and nothing happened.
const PRETTIERRC = `{
  "printWidth": 92,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "arrowParens": "always"
}
`;

// Generated, vendored, or binary. Formatting any of it produces a diff nobody asked for.
const PRETTIERIGNORE = `node_modules/
.expo/
dist/
build/
coverage/
web-build/
/ios
/android
package-lock.json
*.sarif
playwright-report/
test-results/
.evidence/
`;

// Husky v9+: the hook file is the command, with no shebang boilerplate. These are only ever
// written when the file is absent, so they are the floor for a fresh project rather than a
// replacement for what this repo has — see .husky/ for the versions with their reasoning.
const PRE_COMMIT = `npx lint-staged

# Secrets, before they reach history. Skipped silently when gitleaks is absent; CI scans anyway.
node .claude/scripts/scan-staged.mjs
`;

const COMMIT_MSG = `npx --no -- commitlint --edit "$1"
`;

// The Claude Code hooks bind an agent session in this directory. These are git hooks, so they
// bind whoever pushes from this clone — a teammate on the command line, or Codex. Two rules:
// nothing LANDS on main except by merging a PR, and nothing REWRITES it, which still holds
// under ALLOW_PUSH_TO_MAIN=1. Both read the refs git hands the hook on stdin.
const PRE_PUSH = `refs=$(cat)

printf '%s\\n' "$refs" | node .claude/scripts/check-push-target.mjs --pre-push || exit 1
printf '%s\\n' "$refs" | node .claude/hooks/guard-push.mjs || exit 1
`;

const LINT_STAGED = {
  "*.{js,jsx,ts,tsx,mjs,cjs}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml,yaml,css}": ["prettier --write"],
};

const CHECKS = [
  {
    id: "eslint",
    title: "ESLint",
    // `expo lint` is the runner here; eslint-config-expo carries the rules.
    ok: () => dep("eslint") && file("eslint.config.js") && script("lint"),
    detail: () =>
      [
        dep("eslint") ? null : "eslint not installed",
        file("eslint.config.js") ? null : "no eslint.config.js",
        script("lint") ? null : "no lint script",
      ].filter(Boolean),
    fix: () => {
      if (!dep("eslint")) install.add("eslint");
      if (!dep("eslint-config-expo")) install.add("eslint-config-expo");
      addScript("lint", "expo lint");
      if (!file("eslint.config.js")) {
        write(
          "eslint.config.js",
          `const { defineConfig } = require('eslint/config');\nconst expoConfig = require('eslint-config-expo/flat');\n\nmodule.exports = defineConfig([\n  expoConfig,\n  { ignores: ['dist/*', 'coverage/*', '.expo/*'] },\n]);\n`,
        );
      }
    },
  },
  {
    id: "prettier",
    title: "Prettier",
    ok: () =>
      dep("prettier") &&
      (file(".prettierrc") || file("prettier.config.js")) &&
      script("format:check"),
    detail: () =>
      [
        dep("prettier")
          ? null
          : "prettier not installed — the format-after-edit hook is a no-op without it",
        file(".prettierrc") || file("prettier.config.js") ? null : "no prettier config",
        script("format:check")
          ? null
          : "no format:check script — CI's Format step passes vacuously",
      ].filter(Boolean),
    fix: () => {
      if (!dep("prettier")) install.add("prettier");
      if (!file(".prettierrc") && !file("prettier.config.js"))
        write(".prettierrc", PRETTIERRC);
      if (!file(".prettierignore")) write(".prettierignore", PRETTIERIGNORE);
      addScript("format", "prettier --write .");
      addScript("format:check", "prettier --check .");
    },
  },
  {
    id: "commitlint",
    title: "commitlint",
    // The config alone is the trap this script exists for: it needs the CLI *and* a git hook
    // that calls it, or every non-conforming commit is still accepted.
    ok: () =>
      dep("@commitlint/cli") &&
      dep("@commitlint/config-conventional") &&
      file("commitlint.config.js") &&
      file(".husky", "commit-msg"),
    detail: () =>
      [
        dep("@commitlint/cli")
          ? null
          : "@commitlint/cli not installed — the config is inert",
        dep("@commitlint/config-conventional")
          ? null
          : "@commitlint/config-conventional not installed",
        file("commitlint.config.js") ? null : "no commitlint.config.js",
        file(".husky", "commit-msg")
          ? null
          : "no .husky/commit-msg — nothing calls commitlint",
      ].filter(Boolean),
    fix: () => {
      if (!dep("@commitlint/cli")) install.add("@commitlint/cli");
      if (!dep("@commitlint/config-conventional"))
        install.add("@commitlint/config-conventional");
      if (!file(".husky", "commit-msg")) write(".husky/commit-msg", COMMIT_MSG);
    },
  },
  {
    id: "husky",
    title: "husky",
    ok: () =>
      dep("husky") &&
      script("prepare") &&
      file(".husky", "pre-commit") &&
      file(".husky", "pre-push"),
    detail: () =>
      [
        dep("husky") ? null : "husky not installed",
        script("prepare")
          ? null
          : "no prepare script — hooks are not installed on npm install",
        file(".husky", "pre-commit") ? null : "no .husky/pre-commit",
        file(".husky", "pre-push")
          ? null
          : "no .husky/pre-push — nothing stops a force-push to main from a plain git client",
      ].filter(Boolean),
    fix: () => {
      if (!dep("husky")) install.add("husky");
      addScript("prepare", "husky");
      if (!file(".husky", "pre-commit")) write(".husky/pre-commit", PRE_COMMIT);
      if (!file(".husky", "pre-push")) write(".husky/pre-push", PRE_PUSH);
    },
  },
  {
    id: "lint-staged",
    title: "lint-staged",
    // Not on the original list, but pre-commit needs it: a hook that lints the whole repo is
    // slow enough that people pass --no-verify, and a hook people bypass enforces nothing.
    ok: () => dep("lint-staged") && Boolean(pkg["lint-staged"]),
    detail: () =>
      [
        dep("lint-staged")
          ? null
          : "lint-staged not installed — pre-commit would lint the whole repo",
        pkg["lint-staged"] ? null : "no lint-staged config in package.json",
      ].filter(Boolean),
    fix: () => {
      if (!dep("lint-staged")) install.add("lint-staged");
      if (!pkg["lint-staged"]) {
        pkg["lint-staged"] = LINT_STAGED;
        pkgDirty = true;
        written.push("package.json → lint-staged");
      }
    },
  },
];

// ---------------------------------------------------------------- run

const results = CHECKS.map((c) => ({ ...c, passing: c.ok() }));
const missing = results.filter((r) => !r.passing);

console.log("Toolchain standards\n");
for (const r of results) {
  console.log(`  ${r.passing ? "OK  " : "MISS"}  ${r.title}`);
  if (!r.passing) for (const d of r.detail()) console.log(`          · ${d}`);
}

if (!missing.length) {
  console.log(
    "\n  Every tool is installed, configured, and wired to something that runs it.\n",
  );
  process.exit(0);
}

if (!FIX) {
  console.log("\n  Run with --fix to write the missing configuration:");
  console.log("    node .claude/scripts/toolchain-check.mjs --fix\n");
  process.exit(1);
}

for (const r of missing) r.fix();

if (pkgDirty) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log("\n  Written:");
for (const w of written) console.log(`    + ${w}`);

if (install.size) {
  // Deliberately printed rather than run. Installing reaches the network and rewrites the
  // lockfile — that is a decision with a diff attached, not a side effect of an audit.
  console.log(
    "\n  Still to do — install the runners, which is what makes any of this execute:",
  );
  // None of these are Expo-governed, so plain npm is right here — `npx expo install` is for
  // packages whose version the SDK decides.
  console.log(`    npm install -D ${[...install].join(" ")}`);
  console.log("\n  npm install then runs `prepare`, which installs the git hooks.");
  console.log("  Then normalize the repo once, so format:check has something true to say:");
  console.log("    npm run format");
}

console.log("");
process.exit(1); // still incomplete until the install runs
