# Getting an image into a GitHub PR body

The one fact everything else follows from: **GitHub has no documented API for attaching a file to a
comment, an issue, or a PR body.** The REST and GraphQL APIs will happily create a PR and rewrite
its markdown; neither will host a PNG. Markdown can only reference a URL that already exists. The
request has been open for years —
[community#28219](https://github.com/orgs/community/discussions/28219),
[community#29993](https://github.com/orgs/community/discussions/29993),
[cli#4745](https://github.com/cli/cli/discussions/4745) — and for Claude Code specifically,
[claude-code#26831](https://github.com/anthropics/claude-code/issues/26831).

So there are four places a screenshot can live, and each costs something.

## 1 · `uploads.github.com/user-attachments/assets` — what this repo uses

The endpoint the web UI's own drag-and-drop posts to:

```
POST https://uploads.github.com/user-attachments/assets
     ?name=<filename>&content_type=<mime>&repository_id=<numeric id>
Authorization: Bearer <token>
Accept: application/json
Content-Type: <mime>
<binary body>
```

It answers `201` with `{"url": "https://github.com/user-attachments/assets/<uuid>"}`, and that URL
renders for anyone who can read the repository — **public or private**. The numeric id comes from
`gh api repos/{owner}/{repo} --jq .id`; it is **not** the GraphQL node id.

Three properties make it the right default here:

- **No browser and no saved session.** It takes a bearer token, so it works from a plain terminal,
  identically on Windows and macOS, and would work from CI.
- **The URL is stable** and needs no extra branch, release, or bucket.
- **It renders on a private repository**, which route 2 below does not.

The cost is that it is **undocumented**. It was long understood to accept only a browser session
cookie, which is why most prior art drives a real browser; token support was
[written up in August 2026](https://island94.org/2026/08/programmatically-upload-attachments-to-github-issues-pull-requests-comments)
and may be recent or may simply have gone unnoticed. Verified against this repository on
**2026-09-07**: `gh auth token` (scope `repo`) returned `201` and a working asset URL.

Being undocumented is paid for honestly rather than hidden: `upload-attachments.mjs` treats any
non-2xx answer as `manual` and hands the reason back, and `open-pr.mjs` then writes the local paths
into the body for a human to drag in. It never invents a URL, and it never leaves a body full of
images that silently do not load. **If this endpoint disappears, nothing breaks except the
convenience** — and `--probe` tells you in one command.

Uploads are also all-or-nothing per PR: a body with three images and one local path reads as a
mistake nobody made, and a reviewer cannot tell which half to trust.

## 2 · An evidence branch and `raw.githubusercontent.com`

`gh api` can create a branch and PUT file contents onto it without touching the working tree, and a
`raw.githubusercontent.com` URL pinned to the resulting commit SHA is immutable. No browser needed,
which is why CI-based implementations reach for it.

Two real costs, which is why it is not used here:

- **A raw URL does not render in a PR body on a private repository.** The reader's browser has no
  credential for it, so the image silently breaks.
- **The bytes are in the repository forever.** The branch is never merged and must never be
  deleted, or every URL in every PR that used it dies. Deleting it later does not reclaim the
  objects either.

## 3 · A browser with a saved session

Playwright against a saved Chromium profile, driving github.com's own upload — what
[`tonkotsuboy/github-upload-image-to-pr`](https://github.com/tonkotsuboy/github-upload-image-to-pr)
does, and what this skill did before route 1 was verified. It works, and it is the fallback of
record if route 1 ever stops accepting tokens.

Why it is not the default: it needs a browser and a one-time login **per machine**, it cannot run
unattended, and it depends on finding the comment textarea and its file input on the PR page — so
when GitHub reworks that page, it breaks. A selector list is a maintenance liability that a bearer
token is not.

## 4 · A human drags the files in

Always works, costs a human thirty seconds, and is the honest fallback. This is where route 1 lands
when the upload is unusable, and the script prints the exact paths to drag.

## Prior art, and what this skill took from it

| Project                                                                                             | What it solves                                                               | Verdict here                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`tonkotsuboy/github-upload-image-to-pr`](https://github.com/tonkotsuboy/github-upload-image-to-pr) | uploads a local image to a PR by browser automation, then `gh pr edit`       | **Mechanism adopted, then superseded.** It proved the upload works this way; the token route reaches the same endpoint without a browser.                                                              |
| `gh-image` (gh CLI extension)                                                                       | replicates the browser upload flow from the CLI                              | **Not adopted.** Pulls browser cookies, so it needs a real session; that is route 3's cost with an extra dependency.                                                                                   |
| [Screengrabs](https://mcpmarket.com/tools/skills/screengrabs-for-pull-requests)                     | a Claude skill: Playwright + Sharp, annotations, side-by-side comparisons    | **Not adopted.** The annotation half is nice; the capture half does not know this app's surfaces, routes or auth guard, and `capture.mjs` already covers those. Worth revisiting for annotations.      |
| [`conorluddy/ios-simulator-skill`](https://github.com/conorluddy/ios-simulator-skill)               | 27 Python scripts driving `xcodebuild`, `simctl`, `idb` — build, test, drive | **Not adopted.** Its build half assumes a committed Xcode project; this repo generates `ios/` on demand and blocks writes to it. macOS-only, and Python where this repo is Node.                       |
| [`lackeyjb/playwright-skill`](https://github.com/lackeyjb/playwright-skill)                         | a generic executor for agent-written Playwright scripts                      | **Not adopted.** Playwright is already a dev dependency here, with `e2e/web/` and the `write-e2e` skill owning how it is used. A third way to drive a browser is a maintenance cost, not a capability. |

The pattern worth naming: adopt a **mechanism** you have verified, not a dependency you have not.

## What to check when this breaks

| Symptom                                       | Look at                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Not uploaded: HTTP 401` / `403`              | `gh auth status` — the token needs `repo`; run `gh auth login` again                       |
| `could not resolve a repository id`           | `gh repo view --json nameWithOwner` — is there a remote, and can you read it?              |
| `HTTP 404` from the upload                    | the endpoint moved or was withdrawn. Fall back to route 3 or 4; the script already does    |
| an image is `10 MB`+                          | GitHub's per-file cap. Shrink the capture, or record a shorter clip                        |
| the body shows local paths                    | the route fell back to manual — the reason is printed, and the files just need dragging in |
| images broken for a teammate but fine for you | they cannot read the repository. Asset URLs are readable exactly by repository readers     |
