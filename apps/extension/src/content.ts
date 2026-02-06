// Content script - injected into all pages
// This runs in the MAIN world to access page's window object

const script = document.createElement("script");
script.src = chrome.runtime.getURL("src/inpage.ts");
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Listen for messages from inpage script and forward to background
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (!event.data?.type?.startsWith("NOSTR_")) return;

  const { type, id, payload } = event.data;

  try {
    // Forward to background script
    const response = await chrome.runtime.sendMessage({
      type,
      id,
      payload,
      origin: window.location.origin,
    });

    window.postMessage(
      {
        type: "NOSTR_RESPONSE",
        id,
        payload: response,
      },
      "*"
    );
  } catch (error) {
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
