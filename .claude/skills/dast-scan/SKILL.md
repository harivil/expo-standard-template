---
name: dast-scan
description: Test the running app rather than its source — OWASP ZAP against the web build and API, mitmproxy against native traffic. Use when checking what the app actually sends over the network, before a release, or when verifying no personal data leaves the device unencrypted.
---

# Dynamic analysis

SAST reads the code. DAST watches the app run. They find different things: Semgrep can tell you a
`fetch` call looks wrong; only DAST tells you what the app _actually put on the wire_ — including
requests from libraries whose source nobody reads.

## What covers what

| Target                       | Tool          | Automated?                                 |
| ---------------------------- | ------------- | ------------------------------------------ |
| Web build, and any HTTP API  | **OWASP ZAP** | yes — `.github/workflows/dast.yml`, weekly |
| Native iOS / Android traffic | **mitmproxy** | no — a hands-on procedure, below           |

**Neither tool sees the native app in CI.** ZAP scans HTTP endpoints; the iOS and Android binaries
are opaque to it. That gap is what mitmproxy fills, and it is worth an hour before a release rather
than a job on every push.

Be careful reading a green DAST check: on a static `react-native-web` bundle with no backend, ZAP is
mostly checking response headers. That is genuinely useful and it is not a security audit.

---

## ZAP, locally

Docker is the portable route — identical on Windows and macOS, no Java install:

```bash
npx expo export --platform web
npx serve dist --listen 8080

docker run --rm --network host -v "${PWD}:/zap/wrk" \
  zaproxy/zap-stable zap-baseline.py \
  -t http://localhost:8080 -c rules.tsv -r zap-report.html
```

On Windows, `--network host` behaves differently — use `-t http://host.docker.internal:8080`
instead.

**Baseline versus full scan.** The baseline is passive: it crawls and inspects responses, sends no
attacks, and is safe to point anywhere you are allowed to browse. A full scan (`zap-full-scan.py`)
sends real attack payloads. Run it **only** against a staging environment you own, never against
production and never against a third party's API — that is an attack, whatever your intent.

## Tuning findings

`.zap/rules.tsv` maps rule ids to `WARN`, `IGNORE` or `FAIL`. Every `IGNORE` carries a reason,
because an unexplained one cannot be told apart from someone silencing a real finding.

Four are deliberately left as findings, since they matter for an app handling personal data: missing
CSP, HSTS, `X-Content-Type-Options`, and anti-clickjacking headers. All four are **hosting**
configuration — fix them where the web build is served (EAS Hosting, or your CDN), not in the app.

---

## mitmproxy — what the native app actually sends

This is the check that finds what nothing else does: a third-party SDK phoning home with device
identifiers, an analytics call carrying a record id in a query string, a token in a header going to
the wrong host.

```bash
docker run --rm -it -p 8080:8080 -v "${PWD}/.mitm:/home/mitmproxy/.mitmproxy" \
  mitmproxy/mitmproxy mitmweb --web-host 0.0.0.0
```

Point the emulator at it, then drive the app while watching the flows.

- **Android emulator:** `adb shell settings put global http_proxy 10.0.2.2:8080`
- **iOS simulator:** set the proxy in the host machine's network settings — the simulator uses them.

### The certificate footgun

To read HTTPS, mitmproxy substitutes its own certificate, so the device has to trust it. Two things
follow, and the second one has shipped in real apps:

1. Install the CA from `http://mitm.it` on the emulator.
2. **Android 7 and later ignore user-installed CAs by default.** Making the app trust one needs a
   `network_security_config.xml` allowing user certificates — which in Expo means a config plugin.

**That plugin must never reach a production build.** An app trusting user-installed CAs can be
intercepted by anyone who can get a certificate onto the device. Gate it on a debug build, and check
before release that it is absent:

```bash
grep -r "network_security_config\|user-certs" app.json app.config.* 2>/dev/null
```

If you find it outside a development-only branch of the config, that is a release blocker.

Use a **simulator or a dedicated test device**, and a test account. Do not proxy a device holding
real personal or health data — the whole point of the tool is that it records everything in plain
text, and those recordings then need protecting themselves.

### What to look for

Walk the app's main journeys and check every flow:

- **HTTPS everywhere.** Any plaintext request is a finding, including from third-party SDKs.
- **Nothing identifying in a URL.** Query strings are logged by proxies and servers and retained far
  longer than the request.
- **Only expected hosts.** An SDK you added for one purpose calling an endpoint you did not expect is
  worth understanding before release.
- **Auth headers going only where they belong.** A token attached to a third-party request is a
  credential leak.
- **Request bodies no wider than the screen needs.** An endpoint returning a whole record so the UI
  can show one field means the rest reached the device anyway.

Record findings as `docs/intent/<slug>.md` and run them through `feature-loop` like any other work.

---

## When to run this

| Trigger                                           | Scan                               |
| ------------------------------------------------- | ---------------------------------- |
| Weekly, automatically                             | ZAP baseline on the web build      |
| Before a release                                  | mitmproxy over the main journeys   |
| Added or updated an SDK                           | mitmproxy — check what it talks to |
| A new API endpoint                                | ZAP against staging                |
| Anything touching auth, storage, or personal data | both                               |
