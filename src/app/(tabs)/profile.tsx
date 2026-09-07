import { Pressable, StyleSheet } from "react-native";

import { PlaceholderScreen } from "@/components/placeholder-screen";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/context/auth-context";

export default function ProfileScreen() {
  const { user, signOut } = useAuth();

  return (
    <PlaceholderScreen title="Profile">
      {user && (
        <Pressable
          onPress={signOut}
          accessibilityRole="button"
          accessibilityHint="Signs you out and returns to the login screen"
          style={({ pressed }) => pressed && styles.pressed}
        >
          <ThemedText type="linkPrimary" themeColor="textSecondary">
            Log out ({user.email})
          </ThemedText>
        </Pressable>
      )}
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
});
