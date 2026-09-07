import { useState } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/primary-button";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Brand, MaxContentWidth, Spacing } from "@/constants/theme";
import { useAuth } from "@/context/auth-context";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    setIsSigningIn(true);
    const result = await signIn();
    setIsSigningIn(false);
    if (!result.success && result.error) {
      setError(result.error);
    }
  }

  return (
    <ThemedView style={styles.container} testID="login-screen">
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.brandSection}>
          <ThemedText
            style={styles.wordmark}
            accessibilityRole="header"
            maxFontSizeMultiplier={1.8}
          >
            10x{" "}
            <ThemedText style={[styles.wordmark, styles.wordmarkAccent]}>Health</ThemedText>
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.formSection}>
          <ThemedText type="title" style={styles.heading} maxFontSizeMultiplier={1.8}>
            Welcome
          </ThemedText>
          <ThemedText
            themeColor="textSecondary"
            style={styles.subheading}
            maxFontSizeMultiplier={2}
          >
            Sign in to continue
          </ThemedText>

          {error && (
            <ThemedText
              testID="login-error"
              style={styles.errorText}
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={2}
            >
              {error}
            </ThemedText>
          )}

          <PrimaryButton
            testID="login-submit"
            title="Login"
            onPress={handleLogin}
            loading={isSigningIn}
            accessibilityHint="Opens the secure sign-in page"
          />
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignSelf: "center",
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    justifyContent: "space-between",
  },
  brandSection: {
    alignItems: "center",
    paddingTop: Spacing.six,
  },
  wordmark: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
  },
  wordmarkAccent: {
    color: Brand.blue,
  },
  formSection: {
    gap: Spacing.four,
    paddingBottom: Spacing.five,
  },
  heading: {
    fontSize: 32,
    lineHeight: 38,
  },
  subheading: {
    marginTop: -Spacing.two,
  },
  errorText: {
    color: Brand.danger,
    fontSize: 14,
  },
});
