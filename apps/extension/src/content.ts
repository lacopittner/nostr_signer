// Content script - injected into all pages.
// It injects the inpage script (MAIN world) and bridges page messages to background.

console.log("[Nostr Signer] Content script loaded on", window.location.href);

const NOSTR_REQUEST_TYPES = new Set([
  "NOSTR_GET_PUBLIC_KEY",
  "NOSTR_SIGN_EVENT",
  "NOSTR_GET_RELAYS",
  "NOSTR_NIP04_ENCRYPT",
  "NOSTR_NIP04_DECRYPT",
  "NOSTR_NIP44_ENCRYPT",
  "NOSTR_NIP44_DECRYPT",
]);

function injectInpageScript() {
  console.log("[Nostr Signer] Starting injection...");

  if (document.getElementById("nostr-signer-inpage")) {
    return;
  }

  const script = document.createElement("script");
  script.id = "nostr-signer-inpage";
  script.src = chrome.runtime.getURL("src/inpage.ts");
  script.async = false;
  script.onload = () => {
    script.remove();
    console.log("[Nostr Signer] NIP-07 API injected and ready");
  };
  script.onerror = () => {
    console.error("[Nostr Signer] Failed to inject inpage script");
    script.remove();
  };

  const target = document.head || document.documentElement;
  if (!target) {
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        (document.head || document.documentElement)?.appendChild(script);
      },
      { once: true }
    );
    return;
  }

  target.appendChild(script);
}

injectInpageScript();

// Listen for messages from inpage script and forward to background
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  const type = event.data?.type;
  if (typeof type !== "string" || !NOSTR_REQUEST_TYPES.has(type)) return;

  console.log("[Nostr Signer] Received message:", type);

  const { id, payload } = event.data;

  // Wrap chrome.runtime.sendMessage in a way that handles context invalidation
  const sendToBackground = (): Promise<any> => {
    return new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
          throw new Error("Extension context invalidated");
        }

        chrome.runtime.sendMessage(
          {
            type,
            id,
            payload,
            origin: window.location.origin,
          },
          (response: any) => {
            // Check for runtime error (context invalidated)
            if (chrome.runtime.lastError) {
              console.error("[Nostr Signer] Runtime error:", chrome.runtime.lastError);
              resolve({ error: chrome.runtime.lastError.message || "Extension context invalidated" });
            } else {
              resolve(response);
            }
          }
        );
      } catch (error) {
        console.error("[Nostr Signer] Send error:", error);
        resolve({ error: error instanceof Error ? error.message : "Failed to send message" });
      }
    });
  };

  try {
    const response = await sendToBackground();
    console.log("[Nostr Signer] Background response:", response);

    window.postMessage(
      {
        type: "NOSTR_RESPONSE",
        id,
        payload: response,
      },
      "*"
    );
  } catch (error) {
    console.error("[Nostr Signer] Message error:", error);
    window.postMessage(
      {
        type: "NOSTR_RESPONSE",
        id,
        payload: {
          error: error instanceof Error ? error.message : "Request failed",
        },
      },
      "*"
    );
  }
});
