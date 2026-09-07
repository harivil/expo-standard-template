import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Brand, Spacing } from "@/constants/theme";

type PrimaryButtonProps = {
  title: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  /** Renders as data-testid on web, resource-id on Android, accessibilityIdentifier on iOS. */
  testID?: string;
};

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  accessibilityHint,
  testID,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityHint={accessibilityHint}
      hitSlop={Spacing.two}
      style={({ pressed }) => [
        styles.button,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={Brand.onBrand} />
      ) : (
        <ThemedText style={styles.label} maxFontSizeMultiplier={1.6}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: Spacing.three,
    backgroundColor: Brand.blue,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  label: {
    color: Brand.onBrand,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
  },
});
