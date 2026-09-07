import { WorkOS } from "@workos-inc/node";
import * as SecureStore from "expo-secure-store";

const PKCE_TTL_MS = 10 * 60 * 1000;

export const REDIRECT_URI = "tenx-health://auth/callback";

// Public client mode: no API key/secret bundled with the app.
//
// Built on first use rather than at module load. The WorkOS constructor throws when the
// client ID is missing, and this module is imported by the root layout — so constructing
// it eagerly turned an unset env var into a crash before any UI could render, took down
// server rendering for every web route (`web.output: "static"` renders them in Node), and
// broke `tsc`-clean CI. Failing at the point of use keeps the app bootable and puts the
// error where someone can act on it.
let client: WorkOS | null = null;

function workos(): WorkOS {
  if (!client) {
    // Read at call time, not at module scope: nothing is captured before the environment
    // is known, which is what makes this testable and safe under server rendering.
    const clientId = process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        "EXPO_PUBLIC_WORKOS_CLIENT_ID is not set. Copy .env.example to .env.local and fill it in.",
      );
    }
    client = new WorkOS({ clientId });
  }
  return client;
}

const KEYS = {
  SESSION: "workos_session",
  PKCE: "workos_pkce",
} as const;

export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
}

function toAuthUser(user: {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    profilePictureUrl: user.profilePictureUrl ?? null,
  };
}

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface PkceState {
  codeVerifier: string;
  expiresAt: number;
}

/** Build the AuthKit hosted sign-in URL and stash the PKCE verifier for the callback. */
export async function getSignInUrl(): Promise<string> {
  const { url, codeVerifier } = await workos().userManagement.getAuthorizationUrlWithPKCE({
    redirectUri: REDIRECT_URI,
    provider: "authkit",
  });

  const pkceState: PkceState = { codeVerifier, expiresAt: Date.now() + PKCE_TTL_MS };
  await SecureStore.setItemAsync(KEYS.PKCE, JSON.stringify(pkceState));

  return url;
}

/** Exchange the authorization code for tokens using the stored PKCE verifier. */
export async function handleCallback(code: string): Promise<AuthUser> {
  const pkceData = await SecureStore.getItemAsync(KEYS.PKCE);
  if (!pkceData) {
    throw new Error("No sign-in in progress — please try logging in again");
  }

  const pkceState: PkceState = JSON.parse(pkceData);
  if (pkceState.expiresAt < Date.now()) {
    await SecureStore.deleteItemAsync(KEYS.PKCE);
    throw new Error("Sign-in session expired — please try again");
  }

  const auth = await workos().userManagement.authenticateWithCode({
    code,
    codeVerifier: pkceState.codeVerifier,
  });

  await SecureStore.deleteItemAsync(KEYS.PKCE);

  const session: StoredSession = {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    user: toAuthUser(auth.user),
  };
  await SecureStore.setItemAsync(KEYS.SESSION, JSON.stringify(session));

  return session.user;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decode a base64(url) string to UTF-8 text without relying on `atob`,
 * which isn't guaranteed to exist as a Hermes global.
 */
function base64Decode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  // Decode the UTF-8 byte sequence into a JS string. A truncated multi-byte
  // sequence reads as 0 rather than undefined, so malformed input can't throw here.
  const byteAt = (index: number): number => bytes[index] ?? 0;

  let result = "";
  let i = 0;
  while (i < bytes.length) {
    const byte1 = byteAt(i++);
    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
    } else if (byte1 >> 5 === 0b110) {
      const byte2 = byteAt(i++);
      result += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
    } else if (byte1 >> 4 === 0b1110) {
      const byte2 = byteAt(i++);
      const byte3 = byteAt(i++);
      result += String.fromCharCode(
        ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f),
      );
    } else if (byte1 >> 3 === 0b11110) {
      const byte2 = byteAt(i++);
      const byte3 = byteAt(i++);
      const byte4 = byteAt(i++);
      const codepoint =
        ((byte1 & 0x07) << 18) |
        ((byte2 & 0x3f) << 12) |
        ((byte3 & 0x3f) << 6) |
        (byte4 & 0x3f);
      result += String.fromCodePoint(codepoint);
    }
  }
  return result;
}

/** Decode a JWT payload without verifying it (reading claims only, e.g. exp/sid). */
function parseJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split(".")[1];
  if (!base64) {
    throw new Error("Malformed access token");
  }
  return JSON.parse(base64Decode(base64));
}

/** Return the current user, refreshing the access token if it's expired. Null if signed out. */
export async function getUser(): Promise<AuthUser | null> {
  const sessionData = await SecureStore.getItemAsync(KEYS.SESSION);
  if (!sessionData) return null;

  const session: StoredSession = JSON.parse(sessionData);
  const payload = parseJwtPayload(session.accessToken);
  const exp = payload.exp as number;
  const isExpired = Date.now() > exp * 1000 - 10_000;

  if (!isExpired) {
    return session.user;
  }

  try {
    const refreshed = await workos().userManagement.authenticateWithRefreshToken({
      refreshToken: session.refreshToken,
    });

    const newSession: StoredSession = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      user: toAuthUser(refreshed.user),
    };
    await SecureStore.setItemAsync(KEYS.SESSION, JSON.stringify(newSession));
    return newSession.user;
  } catch {
    await clearSession();
    return null;
  }
}

/** The current access token, for calling backend APIs as `Authorization: Bearer <token>`. */
export async function getAccessToken(): Promise<string | null> {
  const sessionData = await SecureStore.getItemAsync(KEYS.SESSION);
  if (!sessionData) return null;
  const session: StoredSession = JSON.parse(sessionData);
  return session.accessToken;
}

async function getSessionId(): Promise<string | null> {
  const sessionData = await SecureStore.getItemAsync(KEYS.SESSION);
  if (!sessionData) return null;
  try {
    const session: StoredSession = JSON.parse(sessionData);
    const payload = parseJwtPayload(session.accessToken);
    return (payload.sid as string) ?? null;
  } catch {
    return null;
  }
}

export async function getLogoutUrl(): Promise<string | null> {
  const sessionId = await getSessionId();
  if (!sessionId) return null;
  return `https://api.workos.com/user_management/sessions/logout?session_id=${sessionId}`;
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.SESSION);
  await SecureStore.deleteItemAsync(KEYS.PKCE);
}
