import { polyfillWebCrypto } from "expo-standard-web-crypto";
import { digest, randomUUID } from "expo-crypto";

polyfillWebCrypto();

if (!globalThis.crypto.subtle) {
  // @ts-expect-error -- expo-crypto's digest is a partial SubtleCrypto polyfill
  globalThis.crypto.subtle = { digest };
}

// The WorkOS SDK generates a request idempotency key via crypto.randomUUID(),
// which expo-standard-web-crypto's Crypto shim doesn't provide.
if (typeof globalThis.crypto.randomUUID !== "function") {
  globalThis.crypto.randomUUID = randomUUID as typeof globalThis.crypto.randomUUID;
}
