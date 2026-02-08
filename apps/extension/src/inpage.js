// Inpage script - injected into page context
// Exposes window.nostr API for NIP-07 compatibility

console.log("[Nostr Signer] Inpage script executing");

(() => {
  // Prevent double injection
  if (window.nostr) {
    console.log("[Nostr Signer] Already injected, skipping");
    return;
  }

  console.log("[Nostr Signer] Injecting NIP-07 API...");

  let requestId = 0;
  const pendingRequests = new Map();
  const supportedNips = [4, 44];

  // Listen for responses from content script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "NOSTR_RESPONSE") return;

    const { id, payload } = event.data;
    const request = pendingRequests.get(id);
    if (!request) return;

    pendingRequests.delete(id);
    if (payload?.error) {
      request.reject(new Error(payload.error));
    } else {
      request.resolve(payload);
    }
  });

  // Send message to content script
  function sendMessage(type, payload) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pendingRequests.set(id, { resolve, reject });

      window.postMessage(
        {
          type: `NOSTR_${type}`,
          id,
          payload,
          application: "nostr-signer",
        },
        window.location.origin
      );

      // Timeout after 30 seconds
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, 30000);
    });
  }

  // NIP-07 API
  const nostr = {
    _nips: supportedNips,
    // Compatibility with older NIP-07 integrations (nos2x style)
    enable: async () => nostr,
    isEnabled: async () => true,

    /**
     * Get public key of the active identity
     */
    getPublicKey: async () => sendMessage("GET_PUBLIC_KEY"),

    /**
     * Sign a Nostr event
     */
    signEvent: async (event) => sendMessage("SIGN_EVENT", event),

    /**
     * Get recommended relays
     */
    getRelays: async () => sendMessage("GET_RELAYS"),

    /**
     * NIP-04 encryption
     */
    nip04: {
      encrypt: async (pubkey, plaintext) => sendMessage("NIP04_ENCRYPT", { pubkey, plaintext }),
      decrypt: async (pubkey, ciphertext) => sendMessage("NIP04_DECRYPT", { pubkey, ciphertext }),
    },

    /**
     * NIP-44 encryption
     */
    nip44: {
      encrypt: async (pubkey, plaintext) => sendMessage("NIP44_ENCRYPT", { pubkey, plaintext }),
      decrypt: async (pubkey, ciphertext) => sendMessage("NIP44_DECRYPT", { pubkey, ciphertext }),
    },
  };

  // Expose to window
  window.nostr = nostr;

  // Dispatch event for apps listening
  window.dispatchEvent(new Event("nostr:ready"));

  console.log("[Nostr Signer] NIP-07 API injected");
})();
