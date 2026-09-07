#!/usr/bin/env node
// Regression tests for the hooks in this folder.
//
//   node .claude/hooks/hooks.test.mjs
//
// The hooks steer every session in this repo, so they get tested like the code they guard.
// Run this after changing any guard, and in CI on any change under .claude/.
//
// Exit 0 = all cases pass. Exit 1 = at least one case failed.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BLOCK = 2;
const ALLOW = 0;

/** Run a hook with a payload object on stdin and return its exit code. */
function run(hook, payload, env, cwd) {
  const res = spawnSync(process.execPath, [join(HERE, hook)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    // stage-check.mjs resolves the current branch from the working directory, so its cases
    // run against a throwaway repo rather than whichever branch the developer is on.
    cwd,
    // Neutralise anything the developer's own shell exports, so a machine that happens to set
    // the escape hatch does not silently turn these cases green.
    env: {
      ...process.env,
      CLAUDE_SKIP_PLUGIN_CHECK: "",
      CLAUDE_PROJECT_DIR: "",
      ALLOW_PUSH_TO_MAIN: "",
      ...env,
    },
  });
  return res.status;
}

const bash = (command) => ({ tool_input: { command } });
const write = (file_path) => ({ tool_input: { file_path } });

const CASES = [
  // --- guard-bash: blocked -------------------------------------------------
  [
    "guard-bash.mjs",
    bash("npm install expo-camera"),
    BLOCK,
    "npm install of an expo package",
  ],
  ["guard-bash.mjs", bash("npm i expo-router@latest"), BLOCK, "npm i, pinned version"],
  [
    "guard-bash.mjs",
    bash("npm run lint && npm add react-native-svg"),
    BLOCK,
    "second segment of a chain",
  ],
  // Every package manager desynchronises the SDK the same way, so all of them are blocked.
  ["guard-bash.mjs", bash("yarn add expo-camera"), BLOCK, "yarn add of an expo package"],
  ["guard-bash.mjs", bash("pnpm add react-native-svg"), BLOCK, "pnpm add of an RN package"],
  ["guard-bash.mjs", bash("bun add expo-router"), BLOCK, "bun add of an expo package"],
  ["guard-bash.mjs", bash("git push --force origin feat"), BLOCK, "force push"],
  ["guard-bash.mjs", bash("git push -f"), BLOCK, "force push, short flag"],

  // --- guard-bash: allowed -------------------------------------------------
  [
    "guard-bash.mjs",
    bash("npx expo install expo-camera"),
    ALLOW,
    "the correct install form",
  ],
  // A lease-guarded push to your own branch is ordinary work, but whether the guard allows it
  // now depends on the branch the command runs from — it refuses one that force-pushes main
  // while you are standing on main. So that case lives in the branch-aware section below,
  // against a fixture repo, rather than reading whichever branch this checkout is on.
  ["guard-bash.mjs", bash("yarn add zod"), ALLOW, "yarn add of a non-Expo package"],
  ["guard-bash.mjs", bash("npm install"), ALLOW, "bare install, restores the tree"],
  ["guard-bash.mjs", bash("npm run lint"), ALLOW, "ordinary script"],
  [
    "guard-bash.mjs",
    bash('echo "do not run npm install expo here"'),
    ALLOW,
    "mention inside a quoted string",
  ],
  ["guard-bash.mjs", bash("npm test"), ALLOW, "tests"],

  // --- guard-bash: pushing to a protected branch ---------------------------
  // The refspec decides where a push lands, not the branch you are standing on — which is
  // exactly what the commit guard cannot see.
  ["guard-bash.mjs", bash("git push origin main"), BLOCK, "push straight to main"],
  ["guard-bash.mjs", bash("git push origin master"), BLOCK, "push straight to master"],
  [
    "guard-bash.mjs",
    bash("git push origin HEAD:main"),
    BLOCK,
    "push HEAD onto main from a feature branch",
  ],
  [
    "guard-bash.mjs",
    bash("git push origin my-feature:main"),
    BLOCK,
    "push a named branch onto main",
  ],
  ["guard-bash.mjs", bash("git push origin refs/heads/main"), BLOCK, "fully qualified ref"],
  [
    "guard-bash.mjs",
    bash("git push origin :main"),
    BLOCK,
    "deleting main is an update too",
  ],
  [
    "guard-bash.mjs",
    bash("git push --force-with-lease origin main"),
    BLOCK,
    "a lease does not make it reviewable",
  ],
  [
    "guard-bash.mjs",
    bash("npm run verify && git push -u origin HEAD:main"),
    BLOCK,
    "second segment of a chain",
  ],

  // Precision matters more here than anywhere: a guard that fires on a branch merely
  // containing the word teaches people to reach for --no-verify.
  ["guard-bash.mjs", bash("git push -u origin feat/settings"), ALLOW, "ordinary branch"],
  [
    "guard-bash.mjs",
    bash("git push origin feature/main-menu"),
    ALLOW,
    "branch name containing 'main'",
  ],
  [
    "guard-bash.mjs",
    bash("git push origin HEAD:release/maintenance"),
    ALLOW,
    "destination merely starting with 'main'",
  ],
  [
    "guard-bash.mjs",
    bash("git push origin main:my-backup"),
    ALLOW,
    "main as the SOURCE is fine — the destination is what gets written",
  ],
  [
    "guard-bash.mjs",
    bash("ALLOW_PUSH_TO_MAIN=1 git push origin main"),
    ALLOW,
    "documented override, inline",
    { ALLOW_PUSH_TO_MAIN: "1" },
  ],

  // --- guard-bash: writing to a protected path through the shell -----------
  // guard-write only ever sees the file_path of an Edit or Write call, so every one of
  // these used to walk straight past it. Same path list, parsed out of the command.
  [
    "guard-bash.mjs",
    bash("sed -i 's/a/b/' android/build.gradle"),
    BLOCK,
    "sed -i into a prebuild directory",
  ],
  [
    "guard-bash.mjs",
    bash("sed -i.bak 's|x|y|' ios/Podfile"),
    BLOCK,
    "sed -i with a backup suffix",
  ],
  [
    "guard-bash.mjs",
    bash("sed -i -e 's/a/b/' node_modules/react/index.js"),
    BLOCK,
    "sed -i with -e, so every operand is a file",
  ],
  [
    "guard-bash.mjs",
    bash("echo '{}' > package-lock.json"),
    BLOCK,
    "redirect over the lockfile",
  ],
  ["guard-bash.mjs", bash("cat x >> dist/bundle.js"), BLOCK, "appending to build output"],
  ["guard-bash.mjs", bash("tee node_modules/.hack < x"), BLOCK, "tee into node_modules"],
  ["guard-bash.mjs", bash("cp evil.gradle android/build.gradle"), BLOCK, "cp destination"],
  ["guard-bash.mjs", bash("mv x .expo/settings.json"), BLOCK, "mv destination"],
  ["guard-bash.mjs", bash("dd if=/dev/zero of=coverage/lcov.info"), BLOCK, "dd of="],
  [
    "guard-bash.mjs",
    bash("npm run lint && sed -i 's/a/b/' ios/Podfile"),
    BLOCK,
    "second segment of a chain",
  ],
  [
    "guard-bash.mjs",
    bash("cat src/a.ts | tee dist/a.ts"),
    BLOCK,
    "write target on the far side of a pipe",
  ],

  // Precision matters as much here as for the push rule: this guard sits on the tool the
  // agent uses for everything, so a false positive is expensive.
  [
    "guard-bash.mjs",
    bash("sed -i 's/a/b/' src/theme.ts"),
    ALLOW,
    "same command shape, ordinary source",
  ],
  [
    "guard-bash.mjs",
    bash("sed 's/a/b/' android/build.gradle"),
    ALLOW,
    "no -i, so it writes to stdout and changes nothing",
  ],
  ["guard-bash.mjs", bash("cat node_modules/react/package.json"), ALLOW, "reading is fine"],
  ["guard-bash.mjs", bash("grep -rn foo dist/"), ALLOW, "searching build output"],
  [
    "guard-bash.mjs",
    bash("cp android/build.gradle /tmp/backup.gradle"),
    ALLOW,
    "protected path as the SOURCE — the destination is what gets written",
  ],
  [
    "guard-bash.mjs",
    bash("npx expo-doctor > /dev/null 2>&1"),
    ALLOW,
    "/dev/null and a descriptor duplication are not files",
  ],
  [
    "guard-bash.mjs",
    bash("node .claude/scripts/version-check.mjs > report.txt"),
    ALLOW,
    "ordinary redirect",
  ],
  [
    "guard-bash.mjs",
    bash('echo "do not sed -i package-lock.json"'),
    ALLOW,
    "mention inside a quoted string",
  ],

  // A separator inside quotes is data. The command splitter used to cut on it anyway, which
  // fragmented the command and lost the filename — the write guard then had nothing to check.
  // These are the regression cases for that bypass.
  [
    "guard-bash.mjs",
    bash("sed -i 's|a|b|' android/build.gradle"),
    BLOCK,
    "pipes inside the sed script do not split the command",
  ],
  [
    "guard-bash.mjs",
    bash("sed -i 's/a;b/c/' ios/Podfile"),
    BLOCK,
    "semicolon inside the sed script",
  ],
  [
    "guard-bash.mjs",
    bash("sed -i 's|a|b|' src/theme.ts"),
    ALLOW,
    "the same quoting, ordinary source",
  ],

  // --- guard-write: blocked ------------------------------------------------
  ["guard-write.mjs", write("node_modules/react/index.js"), BLOCK, "posix node_modules"],
  [
    "guard-write.mjs",
    write("node_modules\\react\\index.js"),
    BLOCK,
    "windows node_modules",
  ],
  ["guard-write.mjs", write("ios/Podfile"), BLOCK, "posix ios/"],
  [
    "guard-write.mjs",
    write("D:\\10x mobile\\android\\build.gradle"),
    BLOCK,
    "windows absolute android/",
  ],
  ["guard-write.mjs", write("/Users/x/app/.expo/settings.json"), BLOCK, "expo cache"],
  ["guard-write.mjs", write("package-lock.json"), BLOCK, "lockfile"],
  ["guard-write.mjs", write("coverage/lcov.info"), BLOCK, "build output"],

  // --- guard-write: allowed ------------------------------------------------
  ["guard-write.mjs", write("src/screens/settings/index.tsx"), ALLOW, "ordinary source"],
  [
    "guard-write.mjs",
    write("src\\screens\\settings\\index.tsx"),
    ALLOW,
    "ordinary source, windows",
  ],
  [
    "guard-write.mjs",
    write("src/components/node-modules-helper.ts"),
    ALLOW,
    "name merely resembling a protected path",
  ],
  ["guard-write.mjs", write("docs/specs/claim-status.md"), ALLOW, "an artifact"],
  ["guard-write.mjs", write("app.json"), ALLOW, "config the team owns"],

  // --- guard-secrets -------------------------------------------------------
  // Only reacts to a real commit. With gitleaks absent it must still allow, so a missing
  // scanner never stops people committing — CI scans every push regardless.
  ["guard-secrets.mjs", bash("npm run lint"), ALLOW, "not a commit, no scan"],
  [
    "guard-secrets.mjs",
    bash('echo "git commit is blocked on main"'),
    ALLOW,
    "commit named inside a string",
  ],
  ["guard-secrets.mjs", bash("git status"), ALLOW, "other git command"],
  [
    "guard-secrets.mjs",
    bash('git commit -m "feat: add settings"'),
    ALLOW,
    "commit scans, allows when clean or gitleaks absent",
  ],

  // --- malformed input must never wedge a session --------------------------
  ["guard-bash.mjs", {}, ALLOW, "no command field"],
  ["guard-write.mjs", {}, ALLOW, "no path field"],
  ["guard-secrets.mjs", {}, ALLOW, "no command field"],
  [
    "format-after-edit.mjs",
    write("AGENTS.md"),
    ALLOW,
    "formatter with no node_modules present",
  ],
  ["format-after-edit.mjs", {}, ALLOW, "formatter, no path"],
];

let failed = 0;
for (const [hook, payload, expected, label, env] of CASES) {
  const got = run(hook, payload, env);
  const ok = got === expected;
  if (!ok) failed++;
  const verdict = ok ? "pass" : "FAIL";
  const want = expected === BLOCK ? "block" : "allow";
  console.log(
    `${verdict}  ${hook.padEnd(22)} ${want}  ${label}${ok ? "" : `  (got exit ${got})`}`,
  );
}

// A malformed-JSON case, which cannot be expressed as an object.
{
  const res = spawnSync(process.execPath, [join(HERE, "guard-bash.mjs")], {
    input: "this is not json",
    encoding: "utf8",
  });
  const ok = res.status === ALLOW;
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  guard-bash.mjs         allow  unparseable stdin`);
}

// --- require-plugins ------------------------------------------------------
//
// This guard reads Claude Code's own plugin state, which differs on every machine and is
// absent in CI. So each case builds a throwaway CLAUDE_CONFIG_DIR and points the hook at it,
// making the outcome depend only on the fixture. The distinction that matters most is
// bundled vs external: a bundled plugin arrives with the marketplace clone and never gets an
// install record, so demanding one would block forever on plugins that already work.

let pluginCases = 0;

{
  const TMP = mkdtempSync(join(tmpdir(), "plugin-guard-"));
  let seq = 0;

  /** Build a project + config-dir pair and return what `run` needs to exercise it. */
  function fixture({ declared, local, records, catalog, marketplaces, version = 2 }) {
    const base = join(TMP, `case-${seq++}`);
    const proj = join(base, "proj");
    const cfg = join(base, "cfg");
    const plugins = join(cfg, "plugins");

    mkdirSync(join(proj, ".claude"), { recursive: true });
    if (declared !== undefined) {
      writeFileSync(
        join(proj, ".claude", "settings.json"),
        JSON.stringify({ enabledPlugins: declared }),
      );
    }
    if (local !== undefined) {
      writeFileSync(
        join(proj, ".claude", "settings.local.json"),
        JSON.stringify({ enabledPlugins: local }),
      );
    }

    mkdirSync(plugins, { recursive: true });
    writeFileSync(
      join(plugins, "installed_plugins.json"),
      JSON.stringify({ version, plugins: records ?? {} }),
    );
    writeFileSync(
      join(plugins, "known_marketplaces.json"),
      JSON.stringify(marketplaces ?? { mp: { source: {} } }),
    );

    for (const [name, entries] of Object.entries(catalog ?? { mp: [] })) {
      const dir = join(plugins, "marketplaces", name, ".claude-plugin");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "marketplace.json"), JSON.stringify({ plugins: entries }));
    }

    return { proj, cfg };
  }

  // A plugin whose source is a path inside the marketplace repo, versus one that points away.
  const BUNDLED = { name: "sec", source: "./plugins/sec" };
  const EXTERNAL = {
    name: "ext",
    source: { source: "git-subdir", url: "https://example.com/x.git" },
  };
  const CATALOG = { mp: [BUNDLED, EXTERNAL] };

  const PLUGIN_CASES = [
    [
      "bundled plugin needs no install record",
      fixture({ declared: { "sec@mp": true }, catalog: CATALOG }),
      ALLOW,
    ],
    [
      "external plugin, never installed",
      fixture({ declared: { "ext@mp": true }, catalog: CATALOG }),
      BLOCK,
    ],
    [
      "external plugin installed at user scope",
      fixture({
        declared: { "ext@mp": true },
        catalog: CATALOG,
        records: { "ext@mp": [{ scope: "user" }] },
      }),
      ALLOW,
    ],
    [
      "external plugin bound to a different project directory",
      fixture({
        declared: { "ext@mp": true },
        catalog: CATALOG,
        records: {
          "ext@mp": [{ scope: "project", projectPath: join(tmpdir(), "some-other-repo") }],
        },
      }),
      BLOCK,
    ],
    [
      "unknown marketplace",
      fixture({ declared: { "ext@nope": true }, catalog: CATALOG }),
      BLOCK,
    ],
    [
      "declared but absent from the catalog",
      fixture({ declared: { "ghost@mp": true }, catalog: CATALOG }),
      BLOCK,
    ],
    [
      "schema drift fails open rather than blocking everyone",
      fixture({ declared: { "ext@mp": true }, catalog: CATALOG, version: 3 }),
      ALLOW,
    ],
    ["nothing declared", fixture({ catalog: CATALOG }), ALLOW],
    [
      "declared false is not required",
      fixture({ declared: { "ext@mp": false }, catalog: CATALOG }),
      ALLOW,
    ],
    [
      "settings.local.json turns one off for this developer",
      fixture({
        declared: { "ext@mp": true },
        local: { "ext@mp": false },
        catalog: CATALOG,
      }),
      ALLOW,
    ],
  ];

  for (const [label, fx, expected] of PLUGIN_CASES) {
    const got = run(
      "require-plugins.mjs",
      { hook_event_name: "SessionStart", cwd: fx.proj },
      {
        CLAUDE_CONFIG_DIR: fx.cfg,
      },
    );
    const ok = got === expected;
    if (!ok) failed++;
    pluginCases++;
    const want = expected === BLOCK ? "block" : "allow";
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"require-plugins.mjs".padEnd(22)} ${want}  ${label}${ok ? "" : `  (got exit ${got})`}`,
    );
  }

  // A project whose own path matches the install record is the case the others invert.
  {
    const fx = fixture({ declared: { "ext@mp": true }, catalog: CATALOG });
    writeFileSync(
      join(fx.cfg, "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: { "ext@mp": [{ scope: "project", projectPath: fx.proj }] },
      }),
    );
    const got = run(
      "require-plugins.mjs",
      { hook_event_name: "SessionStart", cwd: fx.proj },
      {
        CLAUDE_CONFIG_DIR: fx.cfg,
      },
    );
    const ok = got === ALLOW;
    if (!ok) failed++;
    pluginCases++;
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"require-plugins.mjs".padEnd(22)} allow  project-scoped install matching this directory${ok ? "" : `  (got exit ${got})`}`,
    );
  }

  // The escape hatch has to work, or CI and cloud sessions cannot run at all.
  {
    const fx = fixture({ declared: { "ext@mp": true }, catalog: CATALOG });
    const got = run(
      "require-plugins.mjs",
      { hook_event_name: "SessionStart", cwd: fx.proj },
      {
        CLAUDE_CONFIG_DIR: fx.cfg,
        CLAUDE_SKIP_PLUGIN_CHECK: "1",
      },
    );
    const ok = got === ALLOW;
    if (!ok) failed++;
    pluginCases++;
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"require-plugins.mjs".padEnd(22)} allow  CLAUDE_SKIP_PLUGIN_CHECK overrides a block${ok ? "" : `  (got exit ${got})`}`,
    );
  }

  rmSync(TMP, { recursive: true, force: true });
}

// --- stage-check ----------------------------------------------------------
//
// The only hook here that warns rather than blocks, so its expected exit code is 1, not 2.
// Its answer depends on the branch and on which artifacts exist, so each case gets a
// throwaway git repo — running it against this checkout would pass or fail depending on
// whichever branch the developer happened to be on.
//
// Each case also gets its own temp directory for the once-per-branch marker. Without that,
// the first case to warn would silence every later one, and the suite would quietly stop
// testing anything.

let stageCases = 0;

{
  const TMP = mkdtempSync(join(tmpdir(), "stage-check-"));
  let seq = 0;
  const WARN = 1;

  const git = (repo, args) =>
    spawnSync("git", args, { cwd: repo, encoding: "utf8", stdio: "ignore" });

  /** A repo on `branch`, holding whichever artifact files are listed. */
  function repoOn(branch, artifacts = []) {
    const repo = join(TMP, `case-${seq++}`);
    mkdirSync(repo, { recursive: true });
    git(repo, ["init"]);
    // A branch has to have a commit before rev-parse can name it.
    writeFileSync(join(repo, "README.md"), "fixture\n");
    git(repo, ["add", "-A"]);
    git(repo, [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-m",
      "chore: fixture",
    ]);
    if (branch !== "main" && branch !== "master") git(repo, ["checkout", "-b", branch]);
    else git(repo, ["branch", "-M", branch]);

    for (const rel of artifacts) {
      const full = join(repo, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, "# fixture\n");
    }
    return repo;
  }

  function stageCase(label, expected, { branch, artifacts, path }) {
    const repo = repoOn(branch, artifacts);
    const markers = join(TMP, `tmp-${seq}`);
    mkdirSync(markers, { recursive: true });
    const got = run(
      "stage-check.mjs",
      write(path),
      { TMPDIR: markers, TEMP: markers, TMP: markers },
      repo,
    );
    const ok = got === expected;
    if (!ok) failed++;
    stageCases++;
    const verb = expected === WARN ? "warn " : "quiet";
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"stage-check.mjs".padEnd(22)} ${verb}  ${label}${ok ? "" : `  (got exit ${got})`}`,
    );
  }

  stageCase("app code on a feature branch with no spec", WARN, {
    branch: "feat/claim-status",
    artifacts: [],
    path: "src/app/claim.tsx",
  });
  stageCase("the branch prefix is stripped to find the slug", ALLOW, {
    branch: "feat/claim-status",
    artifacts: ["docs/specs/claim-status.md"],
    path: "src/app/claim.tsx",
  });
  stageCase("a bare slug with no prefix", ALLOW, {
    branch: "claim-status",
    artifacts: ["docs/specs/claim-status.md"],
    path: "src/app/claim.tsx",
  });
  // Everything below is a legitimate write with no spec. A guard that fired on these would
  // be turned off within a week, which is worse than no guard.
  stageCase("config is not app code", ALLOW, {
    branch: "feat/claim-status",
    artifacts: [],
    path: "app.json",
  });
  stageCase("the artifact itself is not app code", ALLOW, {
    branch: "feat/claim-status",
    artifacts: [],
    path: "docs/specs/claim-status.md",
  });
  stageCase("the harness is not app code", ALLOW, {
    branch: "feat/claim-status",
    artifacts: [],
    path: ".claude/hooks/guard-bash.mjs",
  });
  // On main there is no slug to look up, and guard-bash already refuses to commit here.
  stageCase("main has no feature slug to check", ALLOW, {
    branch: "main",
    artifacts: [],
    path: "src/app/claim.tsx",
  });

  // Warning once per branch is what keeps it readable. A hook that repeats itself on every
  // write is noise, and noise is what gets a hook disabled.
  {
    const repo = repoOn("feat/quiet-twice", []);
    const markers = join(TMP, "tmp-once");
    mkdirSync(markers, { recursive: true });
    const env = { TMPDIR: markers, TEMP: markers, TMP: markers };
    const first = run("stage-check.mjs", write("src/app/a.tsx"), env, repo);
    const second = run("stage-check.mjs", write("src/app/b.tsx"), env, repo);
    const ok = first === WARN && second === ALLOW;
    if (!ok) failed++;
    stageCases++;
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"stage-check.mjs".padEnd(22)} warn   once per branch, not on every write${ok ? "" : `  (got ${first} then ${second})`}`,
    );
  }

  rmSync(TMP, { recursive: true, force: true });
}

// --- guard-bash, rewriting main -------------------------------------------
//
// Landing on main is one rule; rewriting it is another, and the spellings that matter are the
// ones people reach for once the obvious one is blocked. ALLOW_PUSH_TO_MAIN is deliberately
// set for these: seeding main is a reason to append to it and never a reason to rewrite it, so
// the override must not open this door.

let rewriteCases = 0;

{
  const REWRITE_CASES = [
    ["git push --force-with-lease origin main", BLOCK, "force-with-lease onto main"],
    ["git push origin +main", BLOCK, "a + refspec is a force push in disguise"],
    ["git push origin +feat:feat", BLOCK, "a + refspec on any branch"],
    ["git push origin --delete main", BLOCK, "deleting main on the remote"],
    ["git push origin :main", BLOCK, "the colon spelling of a delete"],
    ["git branch -f main origin/main", BLOCK, "moving the local main ref"],
    ["git branch -D main", BLOCK, "deleting the local main ref"],
    ["git update-ref refs/heads/main HEAD", BLOCK, "moving main by plumbing"],

    // Ordinary work on a branch of your own. `--force-with-lease origin feat` belongs in the
    // branch-aware section below instead: whether it is allowed depends on the branch the
    // command runs from, and a case that reads the developer's own branch passes or fails by
    // where they happen to be standing.
    ["git push origin feat", ALLOW, "a plain push"],
    ["git branch -D feat", ALLOW, "deleting your own branch"],
    ['echo "never git push --force main"', ALLOW, "the rule named inside a string"],
  ];

  for (const [command, expected, label] of REWRITE_CASES) {
    const got = run("guard-bash.mjs", bash(command), {
      ALLOW_PUSH_TO_MAIN: "1",
    });
    const ok = got === expected;
    if (!ok) failed++;
    rewriteCases++;
    const want = expected === BLOCK ? "block" : "allow";
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"guard-bash.mjs".padEnd(22)} ${want}  ${label}${ok ? "" : `  (got exit ${got})`}`,
    );
  }
}

// --- guard-bash, branch-aware ---------------------------------------------
//
// The subtle half of protecting main: these commands name no branch at all. A force push with
// no refspec pushes whatever you are standing on, and a hard reset destroys it in place.
// Identical text, opposite consequences, so the fixture is a real repo on a real branch.

let branchCases = 0;

{
  const TMP = mkdtempSync(join(tmpdir(), "branch-guard-"));
  const git = (...args) => spawnSync("git", args, { cwd: TMP, encoding: "utf8" });

  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(join(TMP, "seed.txt"), "seed\n");
  git("add", "-A");
  git("commit", "-m", "chore: seed");

  const runIn = (command) =>
    spawnSync(process.execPath, [join(HERE, "guard-bash.mjs")], {
      input: JSON.stringify(bash(command)),
      encoding: "utf8",
      cwd: TMP,
      env: {
        ...process.env,
        CLAUDE_SKIP_PLUGIN_CHECK: "",
        CLAUDE_PROJECT_DIR: "",
        ALLOW_PUSH_TO_MAIN: "",
      },
    }).status;

  const DANGEROUS = [
    "git reset --hard HEAD~1",
    "git push --force-with-lease",
    "git push --force-with-lease origin feat",
  ];

  for (const command of DANGEROUS) {
    const got = runIn(command);
    const ok = got === BLOCK;
    if (!ok) failed++;
    branchCases++;
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"guard-bash.mjs".padEnd(22)} block  on main: ${command}${ok ? "" : `  (got exit ${got})`}`,
    );
  }

  // The same commands on a branch of your own are ordinary work.
  git("switch", "-c", "feat");
  for (const command of DANGEROUS) {
    const got = runIn(command);
    const ok = got === ALLOW;
    if (!ok) failed++;
    branchCases++;
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"guard-bash.mjs".padEnd(22)} allow  on a branch: ${command}${ok ? "" : `  (got exit ${got})`}`,
    );
  }

  rmSync(TMP, { recursive: true, force: true });
}

// --- guard-pr -------------------------------------------------------------
//
// This guard reads the receipt ci-local.mjs writes, so each case writes its own receipt to a
// temp path and points the hook at it. That keeps the outcome dependent on the fixture rather
// than on whether whoever is running the tests happens to have a green run sitting in the
// repo — the mistake that would make these cases pass on one laptop and fail on another.
//
// The last case is the one that made the shared splitter necessary: a document that merely
// quotes the gated command is not the gated command, and a guard that cannot tell the
// difference blocks the session that is writing its own tests.

let prCases = 0;

{
  const TMP = mkdtempSync(join(tmpdir(), "pr-guard-"));
  const ROOT = join(HERE, "..", "..");
  let seq = 0;

  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : "";
  };

  // The digest ci-local.mjs records: this commit plus the state of the working tree.
  const sha = git("rev-parse", "HEAD");
  const thisTree = createHash("sha1")
    .update(`${sha}\n${git("status", "--porcelain")}`)
    .digest("hex");

  /** Write a receipt and return its path. */
  function receipt(body) {
    const path = join(TMP, `receipt-${seq++}.json`);
    writeFileSync(path, JSON.stringify(body));
    return path;
  }

  const step = (name, outcome, required = true) => ({
    name,
    outcome,
    required,
  });

  const MISSING = join(TMP, "never-written.json");
  const GREEN = receipt({
    version: 2,
    verdict: "green",
    full: true,
    sha,
    tree: thisTree,
    steps: [step("types", "passed"), step("web-e2e", "passed", false)],
  });
  const RED = receipt({
    version: 2,
    verdict: "failed",
    full: true,
    sha,
    tree: thisTree,
    steps: [step("types", "failed"), step("test", "failed")],
  });
  const INCOMPLETE = receipt({
    version: 2,
    verdict: "incomplete",
    full: true,
    sha,
    tree: thisTree,
    steps: [
      {
        name: "doctor",
        outcome: "skipped",
        required: true,
        why: "not installed",
      },
    ],
  });
  const STALE = receipt({
    version: 2,
    verdict: "green",
    full: true,
    sha,
    tree: "0".repeat(40),
    dirty: true,
    steps: [step("types", "passed")],
  });
  // Green about less than CI checks: ci.yml runs the web E2E suite on every pull request, and
  // a run without --full skipped it.
  const PARTIAL = receipt({
    version: 2,
    verdict: "green",
    full: false,
    sha,
    tree: thisTree,
    steps: [
      {
        name: "web-e2e",
        outcome: "skipped",
        required: false,
        why: "needs --full",
      },
    ],
  });
  // A receipt written before the verdict field existed. Absent is not false — refusing every
  // one of them would block on a field nobody knew to write.
  const LEGACY = receipt({
    version: 1,
    green: true,
    full: true,
    sha,
    tree: thisTree,
  });

  const PR_CASES = [
    // Gated: these are the actions that put a change in front of a reviewer.
    ["gh pr create --fill", MISSING, BLOCK, "open a PR with the gate never run"],
    ["gh pr create --fill", RED, BLOCK, "open a PR after a failed run"],
    ["gh pr create --fill", INCOMPLETE, BLOCK, "a required check could not run"],
    [
      "gh pr create --fill",
      STALE,
      BLOCK,
      "open a PR when the green run was against other code",
    ],
    ["gh pr create --fill", PARTIAL, BLOCK, "a run without --full skipped what CI runs"],
    ["gh pr ready 1", MISSING, BLOCK, "mark ready for review"],
    ["gh pr merge 1 --squash", MISSING, BLOCK, "merge"],
    ["npm run lint && gh pr create --fill", MISSING, BLOCK, "second segment of a chain"],

    // Allowed.
    ["gh pr create --fill", GREEN, ALLOW, "green run against exactly this code"],
    ["gh pr create --fill", LEGACY, ALLOW, "a receipt written before `verdict` existed"],
    [
      "gh pr create --draft --fill",
      MISSING,
      ALLOW,
      "a draft shares work without asking for review",
    ],
    ["gh pr view 1", MISSING, ALLOW, "reading a PR"],
    ["gh pr checks 1 --watch", MISSING, ALLOW, "watching checks"],
    ["gh pr list", MISSING, ALLOW, "listing PRs"],
    ["git push -u origin feat", MISSING, ALLOW, "pushing a branch is not opening a PR"],
    ['echo "lint, then gh pr create"', MISSING, ALLOW, "mention inside a quoted string"],
    [
      "cat <<EOF\nnpm run lint && gh pr create --fill\nEOF",
      MISSING,
      ALLOW,
      "a quoted chain in a document, not a command",
    ],
  ];

  for (const [command, path, expected, label] of PR_CASES) {
    const got = run("guard-pr.mjs", bash(command), { CLAUDE_CI_RECEIPT: path });
    const ok = got === expected;
    if (!ok) failed++;
    prCases++;
    const want = expected === BLOCK ? "block" : "allow";
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"guard-pr.mjs".padEnd(22)} ${want}  ${label}${ok ? "" : `  (got exit ${got})`}`,
    );
  }

  // The escape hatch has to work, or a broken gate becomes a broken team.
  {
    const got = run("guard-pr.mjs", bash("gh pr create --fill"), {
      CLAUDE_CI_RECEIPT: MISSING,
      CLAUDE_SKIP_CI_PREFLIGHT: "1",
    });
    const ok = got === ALLOW;
    if (!ok) failed++;
    prCases++;
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"guard-pr.mjs".padEnd(22)} allow  CLAUDE_SKIP_CI_PREFLIGHT overrides a block${ok ? "" : `  (got exit ${got})`}`,
    );
  }

  // Malformed input must never wedge a session.
  {
    const got = run("guard-pr.mjs", {}, { CLAUDE_CI_RECEIPT: MISSING });
    const ok = got === ALLOW;
    if (!ok) failed++;
    prCases++;
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"guard-pr.mjs".padEnd(22)} allow  no command field${ok ? "" : `  (got exit ${got})`}`,
    );
  }

  rmSync(TMP, { recursive: true, force: true });
}

// --- guard-push -----------------------------------------------------------
//
// A git hook rather than a Claude Code hook, so it refuses by git's convention (exit 1) and is
// exercised the way git calls it: one line per ref on stdin, and a real repo to resolve the
// shas against. Two real commits are cheaper here than any amount of mocking, and they make
// the fast-forward case — the one that must keep working — genuinely true rather than asserted.

let pushCases = 0;

{
  const TMP = mkdtempSync(join(tmpdir(), "push-guard-"));
  const git = (...args) => spawnSync("git", args, { cwd: TMP, encoding: "utf8" });
  const ZERO = "0".repeat(40);
  const REFUSE = 1;

  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(join(TMP, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-m", "chore: first");
  const first = git("rev-parse", "HEAD").stdout.trim();
  writeFileSync(join(TMP, "b.txt"), "b\n");
  git("add", "-A");
  git("commit", "-m", "chore: second");
  const second = git("rev-parse", "HEAD").stdout.trim();

  /** One pre-push line: local ref, local sha, remote ref, remote sha. */
  const push = (localSha, remoteRef, remoteSha) =>
    spawnSync(process.execPath, [join(HERE, "guard-push.mjs")], {
      input: `refs/heads/x ${localSha} ${remoteRef} ${remoteSha}\n`,
      encoding: "utf8",
      cwd: TMP,
    }).status;

  const PUSH_CASES = [
    // Adding commits on top of what the remote has is the whole point.
    [push(second, "refs/heads/main", first), ALLOW, "fast-forward onto main"],
    // The remote is ahead: this push drops a commit someone else can already see.
    [push(first, "refs/heads/main", second), REFUSE, "force-push onto main"],
    [push(ZERO, "refs/heads/main", second), REFUSE, "deleting main"],
    [push(second, "refs/heads/master", first), ALLOW, "fast-forward onto master"],
    [push(first, "refs/heads/master", second), REFUSE, "force-push onto master"],
    // Your own branch is yours to rewrite.
    [push(first, "refs/heads/feat", second), ALLOW, "force-push onto a feature branch"],
    // Nothing on the remote to overwrite yet.
    [push(second, "refs/heads/main", ZERO), ALLOW, "creating main on a fresh remote"],
  ];

  for (const [got, expected, label] of PUSH_CASES) {
    const ok = got === expected;
    if (!ok) failed++;
    pushCases++;
    const want = expected === ALLOW ? "allow" : "refuse";
    console.log(
      `${ok ? "pass" : "FAIL"}  ${"guard-push.mjs".padEnd(22)} ${want}  ${label}${ok ? "" : `  (got exit ${got})`}`,
    );
  }

  rmSync(TMP, { recursive: true, force: true });
}

console.log(
  `\n${CASES.length + 1 + pluginCases + stageCases + rewriteCases + branchCases + prCases + pushCases} cases, ${failed} failed`,
);
process.exit(failed === 0 ? 0 : 1);
