#!/usr/bin/env node
// SessionStart hook. Refuses to start a session until every plugin this project declares in
// .claude/settings.json -> enabledPlugins is actually installed *for this project*.
//
// Why this blocks rather than warns: the declared plugins carry the Expo skills, the
// security-guidance edit hooks, and the Expo MCP server that `verify-app` needs for simulator
// screenshots. A session missing them does not fail — it quietly does worse work, and nobody
// notices until review. A missing dependency should look like a missing dependency.
//
// The check that matters is SCOPE, not mere presence. A plugin installed with
// `--scope project` is bound to the directory it was installed from; the same plugin is
// invisible in a second checkout on the same machine. That is the failure this catches.
//
// Exit 0 = allow. Exit 2 = block, reason on stderr.
//
// Escape hatch: CLAUDE_SKIP_PLUGIN_CHECK=1. CI, cloud sessions, and an offline machine all
// have legitimate reasons to start without plugins, and a guard with no override is a guard
// that eventually gets deleted. Any *internal* error also exits 0 — a broken check must never
// brick the repo for the whole team.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ALLOW = 0;
const BLOCK = 2;

// CLAUDE_CONFIG_DIR relocates the whole ~/.claude tree, and some teams set it. Honour it,
// or this hook reads state from a directory Claude Code is not using.
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const PLUGIN_ROOT = join(CONFIG_DIR, "plugins");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Compare two paths as the same directory, tolerating separator and case differences. */
function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (p) => {
    const r = resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
    // Windows paths are case-insensitive; posix ones are not. Lowercasing everywhere would
    // make two genuinely different macOS directories compare equal.
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

/**
 * Plugins this project asks for. `settings.local.json` is read second so a developer can
 * disable one for themselves without editing the shared file — the same override the
 * `/plugin uninstall` flow writes.
 */
function declaredPlugins(projectDir) {
  const enabled = new Map();
  for (const name of ["settings.json", "settings.local.json"]) {
    const settings = readJson(join(projectDir, ".claude", name));
    const declared = settings?.enabledPlugins;
    if (!declared || typeof declared !== "object") continue;
    for (const [id, on] of Object.entries(declared)) enabled.set(id, on === true);
  }
  return [...enabled.entries()].filter(([, on]) => on).map(([id]) => id);
}

/**
 * How a marketplace entry supplies its plugin, which decides whether an install is needed:
 *
 *   "bundled"  — `source` is a path inside the marketplace repo, so cloning the marketplace
 *                already brought the plugin down. Enabling it is enough, and these never get
 *                an entry in installed_plugins.json.
 *   "external" — `source` points at another repo or archive. Since Claude Code v2.1.195
 *                enabling one of these does not fetch it; it stays unloaded until installed.
 *   "absent"   — declared in settings.json but not in the catalog at all, i.e. a typo.
 */
function sourceKind(marketplace, pluginName) {
  const manifest = readJson(
    join(PLUGIN_ROOT, "marketplaces", marketplace, ".claude-plugin", "marketplace.json"),
  );
  if (!manifest || !Array.isArray(manifest.plugins)) return "unknown";
  const entry = manifest.plugins.find((p) => p?.name === pluginName);
  if (!entry) return "absent";
  return typeof entry.source === "string" ? "bundled" : "external";
}

/** True when some install record makes this plugin available in `projectDir`. */
function isAvailable(records, projectDir) {
  if (!Array.isArray(records)) return false;
  return records.some((r) => r?.scope === "user" || samePath(r?.projectPath, projectDir));
}

function report(missing, projectDir) {
  const lines = [
    "",
    "This project declares plugins that are not installed here, so the session was stopped.",
    "",
  ];

  const wrongScope = missing.filter((m) => m.why === "scope");
  const notInstalled = missing.filter((m) => m.why === "absent-install");
  const noMarket = missing.filter((m) => m.why === "marketplace");
  const notInCatalog = missing.filter((m) => m.why === "absent-catalog");

  if (wrongScope.length) {
    lines.push("Installed on this machine, but bound to a different project directory:");
    for (const m of wrongScope) lines.push(`  ${m.id}   installed for: ${m.boundTo}`);
    lines.push(
      "",
      "  A --scope project install only applies to the directory it ran in. Reinstall at",
      "  user scope so it covers every checkout on this machine:",
    );
    for (const m of wrongScope)
      lines.push(`    claude plugin install ${m.id} --scope user`);
    lines.push("");
  }

  if (notInstalled.length) {
    lines.push(
      "Not installed. These come from an external source, so enabling them in settings.json",
      "does not fetch them — they need a real install:",
    );
    for (const m of notInstalled)
      lines.push(`    claude plugin install ${m.id} --scope user`);
    lines.push("");
  }

  if (noMarket.length) {
    lines.push("Their marketplace is not registered on this machine:");
    for (const m of [...new Set(noMarket.map((m) => m.marketplace))]) {
      lines.push(`    claude plugin marketplace add anthropics/${m}`);
    }
    lines.push("");
  }

  if (notInCatalog.length) {
    lines.push(
      "Declared in .claude/settings.json but absent from their marketplace catalog. This is a",
      "configuration error in the repo rather than something to install — check the spelling,",
      "or refresh the catalog with 'claude plugin marketplace update <name>':",
    );
    for (const m of notInCatalog) lines.push(`    ${m.id}`);
    lines.push("");
  }

  lines.push(
    "Then run 'claude plugin list' to confirm, and start the session again.",
    "Full setup for a new machine:  node .claude/scripts/setup.mjs",
    "",
    "To start without them anyway — CI, a cloud session, or no network — set",
    "CLAUDE_SKIP_PLUGIN_CHECK=1. Expect the Expo skills, the security edit hooks and the",
    "MCP-backed screenshots in verify-app to be unavailable in that session.",
    "",
  );

  return lines.join("\n");
}

function main(raw) {
  if (process.env.CLAUDE_SKIP_PLUGIN_CHECK === "1") return ALLOW;

  let cwd = "";
  try {
    cwd = JSON.parse(raw)?.cwd ?? "";
  } catch {
    // No usable payload. Fall back to the environment rather than giving up: a session
    // starting in this repo should still be checked.
  }
  const projectDir = cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  const declared = declaredPlugins(projectDir);
  if (declared.length === 0) return ALLOW;

  const installed = readJson(join(PLUGIN_ROOT, "installed_plugins.json"));
  const marketplaces = readJson(join(PLUGIN_ROOT, "known_marketplaces.json"));

  // installed_plugins.json is Claude Code's own state file, not a documented interface. If it
  // is missing or its schema has moved on, this hook cannot judge — and a guard that guesses
  // would block everyone on every machine after a Claude Code upgrade. Allow, silently.
  if (!installed || installed.version !== 2 || !marketplaces) return ALLOW;

  const missing = [];

  for (const id of declared) {
    const at = id.lastIndexOf("@");
    if (at <= 0) continue; // not a marketplace-qualified id; nothing to verify
    const name = id.slice(0, at);
    const marketplace = id.slice(at + 1);

    if (!marketplaces[marketplace]) {
      missing.push({ id, name, marketplace, why: "marketplace" });
      continue;
    }

    const kind = sourceKind(marketplace, name);

    // Bundled plugins arrive with the marketplace clone and carry no install record, so
    // demanding one would block forever on plugins that are in fact working. "unknown" means
    // the catalog was unreadable — treat it the same way and stay quiet rather than guess.
    if (kind === "bundled" || kind === "unknown") continue;

    if (kind === "absent") {
      missing.push({ id, name, marketplace, why: "absent-catalog" });
      continue;
    }

    const records = installed.plugins?.[id];
    if (isAvailable(records, projectDir)) continue;

    // Distinguish "you never installed this" from "you installed it for another checkout",
    // because the second one looks like the first and wastes an afternoon.
    const boundTo = Array.isArray(records)
      ? records
          .map((r) => r?.projectPath)
          .filter(Boolean)
          .join(", ")
      : "";
    missing.push({
      id,
      name,
      marketplace,
      why: boundTo ? "scope" : "absent-install",
      boundTo,
    });
  }

  if (missing.length === 0) return ALLOW;

  process.stderr.write(report(missing, projectDir));
  return BLOCK;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let code = ALLOW;
  try {
    code = main(input);
  } catch {
    code = ALLOW; // fail open on our own bugs
  }
  process.exit(code);
});
