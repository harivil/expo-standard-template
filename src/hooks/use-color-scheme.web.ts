import { useSyncExternalStore } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

const subscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 *
 * The hydration flag comes from `useSyncExternalStore` rather than a `setState` in an effect:
 * `getServerSnapshot` returns false during the static render and `getSnapshot` returns true on
 * the client, so it flips exactly once at hydration without triggering a cascading render.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return "light";
}
