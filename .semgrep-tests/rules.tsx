// JSX fixtures for .semgrep.yml — the rules that need markup to express.
// Deliberately insecure. Never imported by the app.

import { WebView } from "react-native-webview";
import { Text, Alert } from "react-native";

declare const untrustedScript: string;
declare const res: unknown;

export function Injection() {
  return (
    <>
      {/* ruleid: webview-injects-dynamic-javascript */}
      <WebView source={{ uri: "https://example.com" }} injectedJavaScript={untrustedScript} />

      {/* ok: webview-injects-dynamic-javascript */}
      <WebView source={{ uri: "https://example.com" }} injectedJavaScript={"console.log(1)"} />
    </>
  );
}

export function Leaky() {
  // ruleid: error-message-leaks-response-body
  Alert.alert("Request failed", JSON.stringify(res));

  // ruleid: error-message-leaks-response-body
  return <Text>{JSON.stringify(res)}</Text>;
}

export function Safe() {
  // ok: error-message-leaks-response-body
  Alert.alert("Request failed", "Something went wrong. Please try again.");
  return <Text>Something went wrong.</Text>;
}
