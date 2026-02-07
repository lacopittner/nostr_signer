import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles.css";

console.log("[Nostr Signer] Popup mounting...");

const rootElement = document.getElementById("root");
if (!rootElement) {
  console.error("[Nostr Signer] Root element not found!");
} else {
  console.log("[Nostr Signer] Root element found, creating root...");
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  console.log("[Nostr Signer] React rendered");
}
