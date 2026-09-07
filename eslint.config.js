// ESLint flat config. Three jobs: Expo's own rules, the security plugins the security-scan
// skill promises run on `npm run lint`, and the repo conventions worth failing a build over.

const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const security = require("eslint-plugin-security");
const noUnsanitized = require("eslint-plugin-no-unsanitized");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      "dist/**",
      "build/**",
      "coverage/**",
      ".expo/**",
      ".evidence/**",
      "playwright-report/**",
      "test-results/**",
      "expo-env.d.ts",
      "**/*.json", // app.json and friends are config, not source
      ".semgrep-tests/**", // deliberately insecure fixtures; Semgrep owns them
    ],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    plugins: { security, "no-unsanitized": noUnsanitized },
    rules: {
      ...security.configs.recommended.rules,
      ...noUnsanitized.configs.recommended.rules,

      // Noisy in an app that indexes arrays and objects by known keys; the real dynamic-key
      // risks in this codebase are covered by the Semgrep rules in .semgrep.yml.
      "security/detect-object-injection": "off",

      // A hex colour in a component is invisible in whichever mode it was built in and
      // unreadable in the other. Colours come from src/constants/theme.ts.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6,8})$/]",
          message:
            "Hard-coded colour. Read it from src/constants/theme.ts via useTheme() so dark mode works.",
        },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // The theme IS the colour definitions, and tests assert against them.
    files: ["src/constants/theme.ts", "**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // Agent tooling: Node scripts that legitimately read the filesystem, spawn processes, and
    // print. Their regexes are reviewed and covered by hooks.test.mjs, so detect-unsafe-regex
    // is off here — it fires on every anchored alternation and teaches people to skip output.
    files: [".claude/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "security/detect-child-process": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-unsafe-regex": "off",
      "no-console": "off",
    },
  },
  {
    // Jest config and setup run in Node with the Jest globals injected.
    files: ["jest.config.js", "jest.setup.js", "jest.style-mock.js", "*.config.js"],
    languageOptions: {
      globals: {
        jest: "readonly",
        module: "writable",
        require: "readonly",
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
      },
    },
    rules: { "no-console": "off", "security/detect-non-literal-require": "off" },
  },
]);
