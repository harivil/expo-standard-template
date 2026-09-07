import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  clearSession,
  getLogoutUrl,
  getSignInUrl,
  getUser,
  handleCallback,
  REDIRECT_URI,
  type AuthUser,
} from "@/services/workos-auth";

WebBrowser.maybeCompleteAuthSession();

type SignInResult = { success: boolean; error?: string };

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  signIn: () => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /** Re-reads the stored session — used by the /auth/callback safety-net route. */
  refreshUser: () => Promise<AuthUser | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    const current = await getUser();
    setUser(current);
    return current;
  }, []);

  useEffect(() => {
    // Restoring the session from SecureStore on mount, not deriving state from props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshUser()
      .catch((error: unknown) => {
        console.error("Failed to restore session:", error);
      })
      .finally(() => setLoading(false));
  }, [refreshUser]);

  const signIn = useCallback(async (): Promise<SignInResult> => {
    setLoading(true);
    try {
      const url = await getSignInUrl();
      // On iOS this opens an ASWebAuthenticationSession, which captures the
      // tenx-health://auth/callback redirect and resolves it here directly —
      // it does not reliably reach the app via a normal deep-link/Router event.
      const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_URI);

      if (result.type !== "success" || !result.url) {
        return { success: false, error: "Sign-in was cancelled" };
      }

      const parsed = Linking.parse(result.url);
      const error = parsed.queryParams?.error as string | undefined;
      if (error) {
        return {
          success: false,
          error: (parsed.queryParams?.error_description as string) ?? error,
        };
      }

      const code = parsed.queryParams?.code as string | undefined;
      if (!code) {
        return { success: false, error: "No authorization code received" };
      }

      const newUser = await handleCallback(code);
      setUser(newUser);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    const logoutUrl = await getLogoutUrl();
    await clearSession();
    // Clear local state immediately so the app returns to the login screen
    // without waiting on (or showing a browser for) the server-side revocation.
    setUser(null);
    if (logoutUrl) {
      fetch(logoutUrl).catch((error: unknown) => {
        console.error("Failed to revoke WorkOS session:", error);
      });
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
