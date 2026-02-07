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
const INVALIDATION_RELOAD_KEY = "nostr_signer_reload_after_invalidation";

function isContextInvalidatedMessage(message: string | undefined) {
  if (!message) return false;
  return message.toLowerCase().includes("context invalidated");
}

function handleInvalidatedContext(message: string) {
  try {
    const alreadyReloaded = window.sessionStorage.getItem(INVALIDATION_RELOAD_KEY) === "1";
    if (!alreadyReloaded) {
      window.sessionStorage.setItem(INVALIDATION_RELOAD_KEY, "1");
      console.warn("[Nostr Signer] Extension context invalidated, reloading page once...");
      window.setTimeout(() => {
        window.location.reload();
      }, 80);
      return { error: "Extension was updated. Reloading page..." };
    }
  } catch {
    // ignore storage errors
  }
  return { error: message || "Extension context invalidated. Please refresh this page." };
}

function injectInpageScript() {
  console.log("[Nostr Signer] Starting injection...");

  if (document.getElementById("nostr-signer-inpage")) {
    return;
  }

  const script = document.createElement("script");
  script.id = "nostr-signer-inpage";
  script.src = chrome.runtime.getURL("src/inpage.js");
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
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
          resolve(handleInvalidatedContext("Extension context invalidated"));
          return;
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
              const runtimeMessage = chrome.runtime.lastError.message || "Extension context invalidated";
              console.error("[Nostr Signer] Runtime error:", runtimeMessage);
              if (isContextInvalidatedMessage(runtimeMessage)) {
                resolve(handleInvalidatedContext(runtimeMessage));
                return;
              }
              resolve({ error: runtimeMessage });
            } else {
              try {
                window.sessionStorage.removeItem(INVALIDATION_RELOAD_KEY);
              } catch {
                // ignore storage errors
              }
              resolve(response);
            }
          }
        );
      } catch (error) {
        console.error("[Nostr Signer] Send error:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to send message";
        if (isContextInvalidatedMessage(errorMessage)) {
          resolve(handleInvalidatedContext(errorMessage));
          return;
        }
        resolve({ error: errorMessage });
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
