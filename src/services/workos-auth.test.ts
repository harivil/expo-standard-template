/**
 * Covers the session logic in workos-auth: the hand-rolled base64/JWT decode (which exists
 * because Hermes has no `atob`), token-expiry handling, and the refresh path. The WorkOS SDK
 * and SecureStore are mocked at the module edge — this asserts our logic, not theirs.
 */

const mockAuthenticateWithCode = jest.fn();
const mockAuthenticateWithRefreshToken = jest.fn();
const mockGetAuthorizationUrlWithPKCE = jest.fn();

// The service constructs its WorkOS client at module load, which happens before the
// `jest.fn()`s above are initialised — so the methods delegate lazily rather than
// capturing the spies by value.
jest.mock("@workos-inc/node", () => ({
  WorkOS: class {
    userManagement = {
      authenticateWithCode: (...args: unknown[]) => mockAuthenticateWithCode(...args),
      authenticateWithRefreshToken: (...args: unknown[]) =>
        mockAuthenticateWithRefreshToken(...args),
      getAuthorizationUrlWithPKCE: (...args: unknown[]) =>
        mockGetAuthorizationUrlWithPKCE(...args),
    };
  },
}));

const mockStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

import {
  clearSession,
  getAccessToken,
  getLogoutUrl,
  getSignInUrl,
  getUser,
  handleCallback,
} from "@/services/workos-auth";

// Jest runs on Node, so `Buffer` exists at runtime — but this project's tsconfig has no
// "node" in `types`, and adding it would widen the globals for the whole app. A local
// declaration keeps that surface to this file.
declare const Buffer: {
  from(input: string, encoding: string): { toString(encoding: string): string };
};

/** Build an unsigned JWT whose payload base64url-encodes `payload`. */
function makeToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${body}.signature`;
}

const user = {
  id: "user_1",
  email: "person@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  profilePictureUrl: null,
};

const futureExp = () => Math.floor(Date.now() / 1000) + 3600;
const pastExp = () => Math.floor(Date.now() / 1000) - 3600;

function seedSession(exp: number, sid = "session_1") {
  mockStore.set(
    "workos_session",
    JSON.stringify({
      accessToken: makeToken({ exp, sid }),
      refreshToken: "refresh_1",
      user,
    }),
  );
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  // The service reads this at call time, so setting it here is enough.
  process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID = "client_test";
});

// Must come first: the service memoises its WorkOS client on first use, so this is the
// only point at which the unset-env path is still observable.
describe("configuration", () => {
  it("reports a missing client ID at the point of use, not at import", async () => {
    // Importing this module must never throw — the root layout imports it, and web
    // server-rendering evaluates it in Node (`web.output: "static"`). Every other test
    // in this file importing it successfully is that guarantee; this asserts the error
    // still arrives, at the call.
    delete process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID;

    await expect(getSignInUrl()).rejects.toThrow("EXPO_PUBLIC_WORKOS_CLIENT_ID is not set");
  });
});

describe("getUser", () => {
  it("returns null when nothing is stored", async () => {
    await expect(getUser()).resolves.toBeNull();
  });

  it("returns the stored user while the access token is still valid", async () => {
    seedSession(futureExp());
    await expect(getUser()).resolves.toEqual(user);
    expect(mockAuthenticateWithRefreshToken).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the new session", async () => {
    seedSession(pastExp());
    const rotated = makeToken({ exp: futureExp(), sid: "session_2" });
    mockAuthenticateWithRefreshToken.mockResolvedValue({
      accessToken: rotated,
      refreshToken: "refresh_2",
      user,
    });

    await expect(getUser()).resolves.toEqual(user);
    expect(mockAuthenticateWithRefreshToken).toHaveBeenCalledWith({
      refreshToken: "refresh_1",
    });

    const stored = JSON.parse(mockStore.get("workos_session")!);
    expect(stored.accessToken).toBe(rotated);
    expect(stored.refreshToken).toBe("refresh_2");
  });

  it("clears the session and returns null when the refresh is rejected", async () => {
    seedSession(pastExp());
    mockAuthenticateWithRefreshToken.mockRejectedValue(new Error("invalid_grant"));

    await expect(getUser()).resolves.toBeNull();
    expect(mockStore.has("workos_session")).toBe(false);
  });

  it("decodes a multi-byte UTF-8 payload without atob", async () => {
    // The decoder is hand-rolled, so a non-ASCII claim is the case that catches a bad
    // continuation-byte mask.
    mockStore.set(
      "workos_session",
      JSON.stringify({
        accessToken: makeToken({
          exp: futureExp(),
          sid: "s",
          name: "Ada Lovelace — 日本語 🎉",
        }),
        refreshToken: "r",
        user: { ...user, firstName: "Adá" },
      }),
    );

    await expect(getUser()).resolves.toMatchObject({ firstName: "Adá" });
  });

  it("propagates a malformed access token rather than returning a bogus user", async () => {
    mockStore.set(
      "workos_session",
      JSON.stringify({ accessToken: "not-a-jwt", refreshToken: "r", user }),
    );

    await expect(getUser()).rejects.toThrow("Malformed access token");
  });
});

describe("handleCallback", () => {
  it("rejects when no sign-in is in progress", async () => {
    await expect(handleCallback("code_1")).rejects.toThrow("No sign-in in progress");
  });

  it("rejects and clears state when the PKCE verifier has expired", async () => {
    mockStore.set(
      "workos_pkce",
      JSON.stringify({ codeVerifier: "v", expiresAt: Date.now() - 1000 }),
    );

    await expect(handleCallback("code_1")).rejects.toThrow("expired");
    expect(mockStore.has("workos_pkce")).toBe(false);
    expect(mockAuthenticateWithCode).not.toHaveBeenCalled();
  });

  it("exchanges the code with the stored verifier and stores the session", async () => {
    mockGetAuthorizationUrlWithPKCE.mockResolvedValue({
      url: "https://auth.workos.com/start",
      codeVerifier: "verifier_1",
    });
    await expect(getSignInUrl()).resolves.toBe("https://auth.workos.com/start");

    mockAuthenticateWithCode.mockResolvedValue({
      accessToken: makeToken({ exp: futureExp(), sid: "session_1" }),
      refreshToken: "refresh_1",
      user,
    });

    await expect(handleCallback("code_1")).resolves.toEqual(user);
    expect(mockAuthenticateWithCode).toHaveBeenCalledWith({
      code: "code_1",
      codeVerifier: "verifier_1",
    });
    // The one-shot verifier must not outlive the exchange.
    expect(mockStore.has("workos_pkce")).toBe(false);
    expect(mockStore.has("workos_session")).toBe(true);
  });
});

describe("session accessors", () => {
  it("getAccessToken returns null when signed out", async () => {
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it("getLogoutUrl is null when signed out and carries the sid when signed in", async () => {
    await expect(getLogoutUrl()).resolves.toBeNull();

    seedSession(futureExp(), "session_abc");
    await expect(getLogoutUrl()).resolves.toContain("session_id=session_abc");
  });

  it("clearSession removes both the session and any pending PKCE state", async () => {
    seedSession(futureExp());
    mockStore.set(
      "workos_pkce",
      JSON.stringify({ codeVerifier: "v", expiresAt: Date.now() + 1000 }),
    );

    await clearSession();

    expect(mockStore.size).toBe(0);
  });
});
