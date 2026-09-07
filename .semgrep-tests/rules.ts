// Fixtures for the rules in .semgrep.yml.
//
//   npx --no-install --  (semgrep is a Python tool; see .claude/skills/security-scan/SKILL.md)
//   semgrep --test --config .semgrep.yml .semgrep-tests/
//
// A `// ruleid: <id>` comment asserts the next line MUST be flagged.
// A `// ok: <id>` comment asserts it must NOT be. Both matter — a rule that fires on safe
// code gets muted within a week, which is worse than not having written it.
//
// This file is deliberately full of insecure patterns. It is never imported by the app.

import AsyncStorage from "@react-native-async-storage/async-storage";

declare const patientName: string;
declare const opaqueId: string;
declare const res: unknown;
declare const router: { push: (s: string) => void; replace: (s: string) => void };
declare function useLocalSearchParams<T>(): T;

// ---------------------------------------------------------------- data leakage

export function logging() {
  // ruleid: no-personal-data-in-logs
  console.log("patientName", patientName);

  // ruleid: no-personal-data-in-logs
  console.warn(`dateOfBirth=${patientName}`);

  // ok: no-personal-data-in-logs
  console.log("record loaded", opaqueId);
}

export function urls() {
  // ruleid: no-personal-data-in-url
  fetch("https://api.example.com/lookup?ssn=123456789");

  // ok: no-personal-data-in-url
  fetch("https://api.example.com/records/abc123");
}

// ---------------------------------------------------------------- secrets

// ruleid: expo-public-env-holds-a-secret
const publishable = process.env.EXPO_PUBLIC_API_SECRET;

// ok: expo-public-env-holds-a-secret
const baseUrl = process.env.EXPO_PUBLIC_API_URL;

// ruleid: hardcoded-credential
const apiKey = "sk_live_9f2b41c7d8e35a06b1";

// ok: hardcoded-credential
const apiKeyFromEnv = process.env.API_KEY;

// ok: hardcoded-credential
const apiKeyPlaceholder = "YOUR_API_KEY_HERE";

export function storage() {
  // ruleid: token-in-async-storage
  AsyncStorage.setItem("authToken", "abc");

  // ok: token-in-async-storage
  AsyncStorage.setItem("lastViewedTab", "explore");
}

// ---------------------------------------------------------------- transport

// ruleid: insecure-http-request
const insecure = "http://api.example.com/records";

// ok: insecure-http-request
const devServer = "http://localhost:8081";

// ok: insecure-http-request
const emulatorHost = "http://10.0.2.2:8081";

// ok: insecure-http-request
const secure = "https://api.example.com/records";

// ---------------------------------------------------------------- injection

export function dangerous() {
  // ruleid: eval-or-function-constructor
  eval("1 + 1");

  // ruleid: eval-or-function-constructor
  new Function("return 1");
}

export function deepLink() {
  const { next } = useLocalSearchParams<{ next: string }>();
  // ruleid: deep-link-param-used-unchecked
  router.push(next);
}

export { publishable, baseUrl, apiKey, apiKeyFromEnv, apiKeyPlaceholder, insecure, devServer, emulatorHost, secure, res };
