#!/usr/bin/env node
// Host screenshots where a pull request body can render them.
//
//   node upload-attachments.mjs --probe          check the route works from this machine
//   node upload-attachments.mjs <file> [<file>]  upload and print the URLs
//
// Also imported by open-pr.mjs, which is the normal way it runs.
//
// The one fact everything here follows from: **GitHub has no documented API for attaching a
// file to a pull request body.** The REST and GraphQL APIs will create a PR and rewrite its
// markdown; neither will host a PNG. Markdown can only reference a URL that already exists.
//
// What this uses is `POST https://uploads.github.com/user-attachments/assets`, the endpoint
// the web UI's own drag-and-drop posts to. It is **undocumented**, and until recently was
// understood to accept only a browser session cookie — which is why the prior art for this
// drives a real browser. It accepts a bearer token, verified against this repository on
// 2026-09-07: `gh auth token` (scope `repo`) returned 201 with a
// `https://github.com/user-attachments/assets/<uuid>` URL.
//
// Why that route and not the two alternatives:
//
//   a browser with a saved session   works, but only where a browser and a saved login exist,
//                                    so never in CI, and it breaks when GitHub reworks the
//                                    comment box — a selector list is a maintenance liability
//   an evidence branch + raw URLs    works unattended, but a raw.githubusercontent URL does
//                                    NOT render in a private repo's body, and the bytes stay
//                                    in the repository forever
//
// Being undocumented is the real cost, and it is paid honestly: when the endpoint answers
// anything but 2xx, this reports `manual` with the reason, and the caller writes the local
// paths into the body for a human to drag in. It never invents a URL, and it never leaves a
// body full of images that silently do not load.

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

// GitHub caps an image at 10 MB and a video at 10 MB per file.
const MAX_BYTES = 10 * 1024 * 1024;

const TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

function run(cmd, args, timeout = 60000) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout, windowsHide: true });
  return {
    ok: r.status === 0 && !r.error,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim() || String(r.error ?? ""),
  };
}

/** What this machine can actually do, so a caller can explain itself before it fails. */
export function routes() {
  const gh = run("gh", ["--version"]).ok;
  const auth = gh ? run("gh", ["auth", "status"]) : { ok: false };
  const token = auth.ok ? run("gh", ["auth", "token"]).stdout : "";
  const nameWithOwner = gh
    ? run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])
        .stdout
    : "";
  const repo = { defaultBranch: "", nameWithOwner };
  if (gh && nameWithOwner) {
    const d = run("gh", [
      "repo",
      "view",
      "--json",
      "defaultBranchRef",
      "--jq",
      ".defaultBranchRef.name",
    ]);
    if (d.ok) repo.defaultBranch = d.stdout;
  }
  return { gh, ghAuth: auth.ok, token: Boolean(token), nameWithOwner, repo };
}

/** The numeric repository id the upload endpoint wants — not the GraphQL node id. */
function repositoryId(nameWithOwner) {
  const r = run("gh", ["api", `repos/${nameWithOwner}`, "--jq", ".id"]);
  return r.ok ? r.stdout : "";
}

async function upload({ file, token, id }) {
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) return { ok: false, why: `unsupported file type: ${extname(file)}` };

  const size = statSync(file).size;
  if (size > MAX_BYTES)
    return {
      ok: false,
      why: `${basename(file)} is ${(size / 1024 / 1024).toFixed(1)} MB; GitHub's cap is 10 MB`,
    };

  const body = readFileSync(file);
  const url =
    "https://uploads.github.com/user-attachments/assets" +
    `?name=${encodeURIComponent(basename(file))}` +
    `&content_type=${encodeURIComponent(type)}` +
    `&repository_id=${encodeURIComponent(id)}`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": type,
        "Content-Length": String(body.length),
      },
      body,
    });
  } catch (e) {
    return { ok: false, why: `the upload could not be reached: ${e.message}` };
  }

  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      why: `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
    };
  }

  let asset;
  try {
    asset = JSON.parse(text);
  } catch {
    return { ok: false, why: `the response was not JSON: ${text.slice(0, 200)}` };
  }
  if (!asset?.url) return { ok: false, why: "the response carried no URL" };
  return { ok: true, url: asset.url };
}

/**
 * Host every file, or none.
 *
 * All-or-nothing on purpose: a body with three images and one local path reads as a mistake
 * nobody made, and it is not obvious to a reviewer which half to trust.
 *
 * @param {{files: string[]}} o
 * @returns {Promise<{hosted: Record<string,string>, route: string, reason?: string}>}
 */
export async function host({ files = [] }) {
  if (!files.length) return { hosted: {}, route: "none" };

  const info = routes();
  if (!info.gh)
    return { hosted: {}, route: "manual", reason: "the GitHub CLI is not installed" };
  if (!info.ghAuth)
    return {
      hosted: {},
      route: "manual",
      reason: "gh is not signed in — run 'gh auth login'",
    };

  const token = run("gh", ["auth", "token"]).stdout;
  if (!token)
    return { hosted: {}, route: "manual", reason: "gh returned no token to upload with" };

  const id = repositoryId(info.nameWithOwner);
  if (!id)
    return {
      hosted: {},
      route: "manual",
      reason: `could not resolve a repository id for ${info.nameWithOwner || "this repo"}`,
    };

  const hosted = {};
  for (const file of files) {
    const r = await upload({ file, token, id });
    if (!r.ok) return { hosted: {}, route: "manual", reason: r.why };
    hosted[file] = r.url;
  }
  return { hosted, route: "user-attachments" };
}

// ---------------------------------------------------------------- CLI

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);

  if (args.includes("--probe")) {
    // A 1x1 transparent PNG, so the probe proves the route without needing a capture.
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = mkdtempSync(join(tmpdir(), "upload-probe-"));
    const png = join(dir, "probe.png");
    writeFileSync(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );

    const r = await host({ files: [png] });
    rmSync(dir, { recursive: true, force: true });

    if (r.route === "user-attachments") {
      console.log(`OK — the upload route works from this machine.\n  ${r.hosted[png]}`);
    } else {
      console.error(
        `The upload route is not usable here: ${r.reason}\n` +
          `open-pr will still open the PR and list the local paths for you to drag in.`,
      );
      // Never process.exit() after a fetch on Windows: node asserts inside libuv when the
      // loop is torn down with undici's handles still open. Setting the code lets it drain.
      process.exitCode = 1;
    }
  } else {
    const files = args.filter((a) => !a.startsWith("--"));
    if (!files.length) {
      console.error(
        "usage: node upload-attachments.mjs --probe\n" +
          "       node upload-attachments.mjs <file> [<file> ...]\n",
      );
      process.exitCode = 1;
    } else {
      const r = await host({ files });
      if (r.route !== "user-attachments") {
        console.error(`Not uploaded: ${r.reason}`);
        process.exitCode = 1;
      } else {
        for (const [file, url] of Object.entries(r.hosted))
          console.log(`${file}\n  ${url}`);
      }
    }
  }
}
