#!/usr/bin/env node
// One command for a new machine, on Windows or macOS:
//
//   node .claude/scripts/setup.mjs
//
// Reports everything this repo needs and is not finding, with the exact command to fix each.
// Run it after cloning, and again whenever a session refuses to start.
//
// It deliberately does NOT install anything. Plugins execute arbitrary code with your user
// privileges, and a script that installs them silently is exactly the thing the plugin docs
// warn about. This prints; you decide.
//
// The plugin section delegates to the require-plugins hook rather than re-implementing it, so
// there is one definition of "installed for this project" and the two can never disagree.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const CLAUDE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(CLAUDE_DIR, "..");

let blocking = 0;

const heading = (s) => console.log(`\n${s}\n${"-".repeat(s.length)}`);

// ---------------------------------------------------------------- node itself
heading("Runtime");
{
  const major = Number(process.versions.node.split(".")[0]);
  // CI pins 22. Anything older than that is a version CI has never exercised.
  if (major < 22) {
    console.log(
      `  node ${process.versions.node} — CI runs 22. Upgrade before trusting a local pass.`,
    );
    blocking++;
  } else {
    console.log(`  node ${process.versions.node}`);
  }
}

// ---------------------------------------------------------------- npm deps
heading("Dependencies");
if (!existsSync(join(ROOT, "package.json"))) {
  // The app is committed, so this is a broken checkout rather than a step still to come.
  console.log(
    "  package.json is MISSING. This repo ships one — the checkout is incomplete.",
  );
  console.log("    git status        # then restore it, or re-clone");
  blocking++;
} else if (!existsSync(join(ROOT, "node_modules"))) {
  console.log("  node_modules missing.");
  console.log("    npm install");
  blocking++;
} else {
  console.log("  node_modules present");
}

// ---------------------------------------------------------------- plugins
//
// Ask the hook. Exit 2 means it would block a session, and its stderr already carries the
// per-plugin diagnosis and the commands to fix it.
heading("Claude Code plugins");
{
  const hook = join(CLAUDE_DIR, "hooks", "require-plugins.mjs");
  if (!existsSync(hook)) {
    console.log("  require-plugins.mjs is missing — nothing is enforcing plugin setup.");
    blocking++;
  } else {
    const res = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ hook_event_name: "SessionStart", cwd: ROOT }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_SKIP_PLUGIN_CHECK: "" },
    });
    if (res.status === 2) {
      console.log((res.stderr || "").trimEnd());
      blocking++;
    } else {
      console.log("  every plugin this project declares is installed for this directory");
    }
  }
}

// ---------------------------------------------------------------- MCP
heading("Expo MCP server");
console.log(
  "  Gives live SDK-accurate docs, SDK-matched installs, EAS builds and logs, and",
);
console.log(
  "  simulator screenshots — which is what lets verify-app check a screen rather",
);
console.log("  than assert it renders.");
console.log(
  "  It ARRIVES WITH THE PLUGIN — do not `claude mcp add` it as well, or you get two",
);
console.log("  servers offering the same tools. It does need an Expo login, once per");
console.log("  machine, and that OAuth flow only runs in an interactive session:");
console.log("    /mcp                    (Claude Code — then authorize `expo`)");
console.log("    codex mcp login expo    (Codex)");

// ---------------------------------------------------------------- external tools
//
// None of these are npm packages, so none arrive with `npm install`. Each is optional
// locally — CI runs all of them regardless — so a miss is reported, never fatal.
heading("External tools (optional locally, all run in CI)");
{
  const TOOLS = [
    {
      cmd: "gitleaks",
      what: "scans staged changes for secrets before each commit",
      mac: "brew install gitleaks",
      win: "winget install gitleaks",
    },
    {
      cmd: "semgrep",
      what: "pattern SAST, including this repo's 11 custom rules",
      mac: "pipx install semgrep",
      win: "pipx install semgrep",
    },
    {
      cmd: "maestro",
      what: "native E2E flows in .maestro/ (EAS runs them too)",
      mac: "curl -fsSL https://get.maestro.mobile.dev | bash",
      win: "see https://docs.maestro.dev — or rely on the EAS workflow",
    },
    {
      // Upstream publishes darwin and linux archives only, so the Windows route is the Go
      // toolchain — install-greenlight.mjs prints it, pinned, rather than failing obscurely.
      cmd: "greenlight",
      what: "App Store / Play compliance (version pinned in .greenlight-version)",
      mac: "brew install revylai/tap/greenlight",
      win: "node .claude/scripts/install-greenlight.mjs",
    },
    {
      cmd: "eas",
      what: "builds, submissions, and the E2E workflow",
      mac: "npm i -g eas-cli",
      win: "npm i -g eas-cli",
    },
  ];

  for (const t of TOOLS) {
    // `--version` is the one flag all four agree on, and none of them prompt for it.
    const probe = spawnSync(t.cmd, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
    if (probe.error?.code === "ENOENT") {
      console.log(`  missing  ${t.cmd.padEnd(9)} ${t.what}`);
      console.log(`           ${process.platform === "darwin" ? t.mac : t.win}`);
    } else {
      console.log(`  ok       ${t.cmd}`);
    }
  }
}

// ---------------------------------------------------------------- release config
//
// Not needed to work on the app, but a machine that will cut a release needs it, and the
// failure mode is discovering it mid-release.
heading("Release config");
{
  const easJson = join(ROOT, "eas.json");
  if (!existsSync(easJson)) {
    console.log("  eas.json is MISSING — 'eas build:configure' writes it.");
    blocking++;
  } else {
    console.log("  ok       eas.json");
  }

  const appJson = join(ROOT, "app.json");
  let projectId = null;
  try {
    projectId =
      JSON.parse(readFileSync(appJson, "utf8"))?.expo?.extra?.eas?.projectId ?? null;
  } catch {
    /* version-check.mjs reports a malformed app.json */
  }
  if (!projectId) {
    console.log(
      "  pending  no EAS project linked yet. Once, by whoever cuts the first release:",
    );
    console.log("             eas login && eas init && eas update:configure");
    console.log(
      "           Builds, submissions and OTA updates all need it. Not blocking work.",
    );
  } else {
    console.log("  ok       EAS project linked");
  }
}

// ---------------------------------------------------------------- self-test
heading("Repo checks");
for (const [label, script] of [
  ["hook guards", join(CLAUDE_DIR, "hooks", "hooks.test.mjs")],
  ["skills and portability", join(CLAUDE_DIR, "check-skills.mjs")],
]) {
  const res = spawnSync(process.execPath, [script], { encoding: "utf8" });
  if (res.status === 0) {
    console.log(`  ok       ${label}`);
  } else {
    console.log(
      `  FAILED   ${label} — run: node ${script.replace(ROOT, ".").replace(/\\/g, "/")}`,
    );
    blocking++;
  }
}

// ---------------------------------------------------------------- verdict
console.log("");
if (blocking > 0) {
  const noun = blocking === 1 ? "thing needs" : "things need";
  console.log(`${blocking} ${noun} attention before this repo works as intended.`);
  process.exit(1);
}
console.log(
  "Nothing blocking. Read AGENTS.md, then start with the feature-loop skill.\n" +
    "Anything marked 'missing' or 'pending' above is still missing — this line means no\n" +
    "REQUIRED check failed, not that every tool is present.",
);
