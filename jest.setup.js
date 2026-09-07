// Loaded before every suite. Only the mocks EVERY suite needs belong here; a mock one test
// needs stays in that test.

// RNTL 12.4+ ships its jest matchers (toHaveStyle, toBeDisabled, toHaveTextContent) in the
// main entry — the old "extend-expect" import no longer exists and is not needed.

// Safe-area insets come from a native provider that does not exist under Jest. The library
// ships this mock for exactly that; without it every screen using <Screen> throws.
// The mock is a default export, so .default is the module shape jest.mock must return.
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

// react-native-reanimated cannot render under Jest without its own mock.
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));

// expo-router reads a real navigation container, which does not exist in a unit test.
jest.mock("expo-router", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    __esModule: true,
    Link: ({ children, testID }) => React.createElement(Text, { testID }, children),
    Stack: () => null,
    Tabs: () => null,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => ({}),
    useGlobalSearchParams: () => ({}),
    usePathname: () => "/",
    useSegments: () => [],
    useFocusEffect: jest.fn(),
    DefaultTheme: { dark: false, colors: {} },
    DarkTheme: { dark: true, colors: {} },
    ThemeProvider: ({ children }) => children,
  };
});

// Silence the animation frame warnings RN emits in a test environment; a real failure still
// throws, so nothing meaningful is being hidden.
jest.spyOn(console, "warn").mockImplementation((message, ...rest) => {
  if (typeof message === "string" && message.includes("useNativeDriver")) return;
  console.log(message, ...rest);
});
