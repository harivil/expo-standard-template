import type { ReactNode } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

export function PlaceholderScreen({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: Spacing.three,
        }}
      >
        <ThemedText type="title" accessibilityRole="header">
          {title}
        </ThemedText>
        {children}
      </SafeAreaView>
    </ThemedView>
  );
}
