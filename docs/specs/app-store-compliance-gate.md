# App Store compliance gate

Intent: [`../intent/app-store-compliance-gate.md`](../intent/app-store-compliance-gate.md)

## Outcome

App Store and Google Play compliance is checked automatically instead of remembered: an agent or a
developer can run one command to get findings with the guideline each comes from, every pull request
reports them, and a production release cannot reach TestFlight or Play with a binary that fails
them. Nothing in the change claims that passing means Apple will approve the app.

## Surfaces touched

- [x] iOS
- [x] Android
- [ ] web

No app code changes and no UI changes. iOS and Android are ticked because the gate scans their
configuration and their built artifacts; web is untouched — the stores have no opinion about it.

## Acceptance criteria

- [ ] `npm run compliance` runs `greenlight preflight .` from the project root.
- [ ] The Greenlight version is pinned in exactly one file, and every consumer reads it from there.
- [ ] The scanner binary is checksum-verified before it is ever executed, and installation refuses
      to proceed on a mismatch.
- [ ] On Windows — where upstream publishes no binary — the tooling reports a named gap with the two
      working routes, and does not fail with a stack trace.
- [ ] `npm run verify` includes a compliance step that is skipped with a notice when the binary is
      absent, and never reports green as if it had run.
- [ ] `node .claude/scripts/setup.mjs` lists `greenlight` as a prerequisite with a per-platform
      install command.
- [ ] A `compliance` job runs on every pull request, on pushes to `main`, and weekly.
- [ ] That job uploads SARIF and the findings appear in the repository's Security tab under a
      `greenlight` category.
- [ ] That job never modifies source files — it reports, and it passes or fails, nothing else.
- [ ] Whether that job blocks is controlled by a single documented toggle, set to report-only, and
      the job states in its own output that the gate is off.
- [ ] Making the gate blocking is documented as a two-step change covering both the workflow toggle
      and the branch-protection required-checks list.
- [ ] The production release pipeline scans the `.ipa` produced by the existing production iOS build
      and fails before `submit_ios` when it finds a CRITICAL or HIGH.
- [ ] The production release pipeline does the same for the `.aab` before `submit_android`.
- [ ] Neither release gate triggers an additional build.
- [ ] A `greenlight` skill exists that instructs an agent to run the scanner rather than assume,
      triage by all four severities, fix CRITICAL first, re-run until GREENLIT or record why a
      finding cannot be fixed, never suppress silently, never disable a rule to pass CI, and ask
      before changing authentication, payment, tracking or account-deletion behaviour.
- [ ] Documentation states what GREENLIT means and, explicitly, that it does not mean Apple has
      approved the app.
- [ ] Documentation states the division of responsibility: Greenlight owns compliance, Maestro and
      Playwright own functional E2E, EAS owns build and submit.
- [ ] Documentation states how to upgrade the pinned version.
- [ ] The optional Revyl runtime tier is documented as optional and not adopted.
- [ ] `node .claude/check-skills.mjs`, `node .claude/hooks/hooks.test.mjs` and `npm run verify` pass.
- [ ] `.maestro/`, `e2e/`, `eas.json` and `.claude/settings.json` are unchanged.

## Out of scope

- **Fixing the §4.8 Sign in with Apple and §5.1.1 account-deletion findings.** Those change the
  authentication surface and the data-retention model. They come back with the scanner's evidence
  for a product decision.
- **Making the pull-request gate blocking.** Deliberately deferred until the pre-existing debt is
  cleared; the toggle and the procedure ship with this change.
- **Adopting Revyl runtime verification.** Recorded as
  [`greenlight-runtime-verify`](../intent/greenlight-runtime-verify.md).
- **Adding a `.greenlight.yml`.** Only if the first real scan shows fixture directories generating
  findings, and then with `ignore:` entries and reasons only — never a rule disable.
- Changing Maestro flows, Playwright specs, EAS build or submit profiles, `enabledPlugins`, or
  adding Fastlane, native iOS code, or a second CI platform.
- App Store Connect metadata checks via `greenlight scan --app-id`, which needs API credentials this
  repo does not hold.
