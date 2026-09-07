# Changelog

What changed for a **user**, not a list of commit subjects. `versioning` step 4 is what keeps
this current, and the Conventional Commit log is what decides the version above each block.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
semver as [`versioning`](.claude/skills/versioning/SKILL.md) section 3 defines it.

## [Unreleased]

### Added

- The delivery harness: agent skills, guard hooks, three review agents, and the intent → spec
  → plan → build → verify → review → ship loop.
- Expo SDK 57 app on iOS, Android and web — tabbed home and explore screens, a clamped counter,
  design tokens with light and dark palettes.
- Release path: `eas.json` with remote build numbers and the `fingerprint` runtime policy,
  plus EAS workflows for the production release and OTA updates.
- Test layers: Jest unit tests, a Maestro native smoke flow, and Playwright web coverage of
  browser back and cold deep links.

<!-- Nothing has shipped to a store yet, so there is no released version below this line. -->
