// Conventional Commits, enforced at commit time.
//
// The point is not tidiness. The commit log is what decides the next version bump and what
// writes the changelog — see .claude/skills/versioning/SKILL.md. A log of "fix stuff" cannot
// answer "is this a minor or a patch?", so the convention is enforced rather than requested.
//
// Wire it up (once, after create-expo-app):
//   npx expo install -- -D @commitlint/cli @commitlint/config-conventional husky
//   npx husky init
//   echo 'npx --no -- commitlint --edit "$1"' > .husky/commit-msg

module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Deliberately short. Every type here maps to a decision the release process makes; a
    // longer list means people pick by vibe and the mapping stops being reliable.
    "type-enum": [
      2,
      "always",
      [
        "feat", // a user can do something new        → minor
        "fix", // a user-visible defect is gone      → patch
        "perf", // measurably faster                  → patch
        "refactor", // behaviour identical             → no bump
        "test", // tests only
        "docs", // documentation only
        "build", // native config, dependencies, EAS — often forces a new build, not an OTA
        "ci", // workflows and automation
        "chore", // everything else, including chore(release)
      ],
    ],

    // Scope is the feature slug where there is one, so a commit links back to its spec and plan.
    "scope-case": [2, "always", "kebab-case"],

    // Subjects are read in a changelog by people who did not write them.
    "subject-case": [0], // proper nouns and file names shouldn't be mangled
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],

    // Long URLs and the Claude co-author trailer live in the body and footer.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
