import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/context/auth-context";
import { handleCallback } from "@/services/workos-auth";

/**
 * Safety-net route for tenx-health://auth/callback.
 *
 * The normal sign-in flow (src/context/auth-context.tsx `signIn`) already
 * exchanges the code directly from the ASWebAuthenticationSession result, so
 * this route mainly matters for cold starts / platforms where the redirect
 * reaches the app as a plain deep link instead.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const { code, error, error_description } = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();
  const { refreshUser } = useAuth();
  const [failure, setFailure] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    if (error) {
      // Surfacing an OAuth error param from the deep link, not deriving state from props.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailure(error_description ?? error);
      return;
    }

    (async () => {
      // The interactive signIn() flow may have already consumed this code —
      // check for an existing session before treating a failed exchange as fatal.
      const existing = await refreshUser();
      if (existing) {
        router.replace("/(tabs)");
        return;
      }

      if (!code) {
        setFailure("No authorization code received");
        return;
      }

      try {
        await handleCallback(code);
        await refreshUser();
        router.replace("/(tabs)");
      } catch (err) {
        console.error("[auth/callback] handleCallback failed:", err);
        setFailure(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [code, error, error_description, refreshUser, router]);

  if (failure) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" style={styles.text} maxFontSizeMultiplier={2}>
          Sign-in failed
        </ThemedText>
        <ThemedText
          themeColor="textSecondary"
          style={styles.text}
          maxFontSizeMultiplier={2}
        >
          {failure}
        </ThemedText>
        <ThemedText
          type="linkPrimary"
          onPress={() => router.replace("/login")}
          accessibilityRole="button"
          maxFontSizeMultiplier={2}
        >
          Back to login
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ActivityIndicator />
      <ThemedText themeColor="textSecondary" style={styles.text} maxFontSizeMultiplier={2}>
        Finishing sign-in…
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  text: {
    textAlign: "center",
  },
});
