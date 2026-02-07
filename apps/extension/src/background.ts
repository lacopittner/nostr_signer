import browser from "webextension-polyfill";
import { vault } from "./lib/vault";

// Pending sign requests
interface PendingRequest {
  id: string;
  type: string;
  origin: string;
  payload: any;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest>();

// Clean old requests every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, req] of pendingRequests) {
    if (now - req.timestamp > 5 * 60 * 1000) {
      // 5 min timeout
      req.reject(new Error("Request timeout"));
      pendingRequests.delete(id);
    }
  }
}, 60000);

// Handle messages from content script
browser.runtime.onMessage.addListener(async (message, sender) => {
  const { type, id, payload, origin } = message;

  switch (type) {
    case "NOSTR_GET_PUBLIC_KEY": {
      try {
        const identity = await vault.getActiveIdentity();
        if (!identity) {
          return { error: "No active identity" };
        }
        return identity.pubkey;
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Unknown error" };
      }
    }

    case "NOSTR_GET_RELAYS": {
      // Return empty relays for now
      return {};
    }

    case "NOSTR_SIGN_EVENT": {
      try {
        // Check if unlocked
        const unlocked = await vault.isUnlocked();
        if (!unlocked) {
          // Need to unlock first - show notification
          await showNotification("Nostr Signer", `${origin} wants to sign an event. Please unlock the extension.`);
          return { error: "Extension locked. Please unlock and try again." };
        }

        // Create pending request
        const requestId = crypto.randomUUID();
        
        return new Promise((resolve, reject) => {
          pendingRequests.set(requestId, {
            id: requestId,
            type: "SIGN_EVENT",
            origin: origin || "unknown",
            payload,
            resolve,
            reject,
            timestamp: Date.now(),
          });

          // Open popup for confirmation
          showSignConfirmation(requestId, origin || "unknown", payload);
        });
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Failed to sign" };
      }
    }

    case "NOSTR_NIP04_ENCRYPT":
    case "NOSTR_NIP04_DECRYPT":
    case "NOSTR_NIP44_ENCRYPT":
    case "NOSTR_NIP44_DECRYPT": {
      return { error: "NIP-04/NIP-44 not yet implemented" };
    }

    case "GET_PENDING_REQUEST": {
      // Called by popup to get pending request
      const req = pendingRequests.get(message.requestId);
      return req || null;
    }

    case "APPROVE_REQUEST": {
      // Called by popup when user approves
      const req = pendingRequests.get(message.requestId);
      if (!req) return { error: "Request not found" };

      try {
        if (req.type === "SIGN_EVENT") {
          const signed = await vault.signEvent({
            kind: req.payload.kind,
            content: req.payload.content,
            tags: req.payload.tags,
            created_at: req.payload.created_at,
          });
          req.resolve(signed);
        }
        pendingRequests.delete(message.requestId);
        return { success: true };
      } catch (err) {
        req.reject(err instanceof Error ? err : new Error("Signing failed"));
        pendingRequests.delete(message.requestId);
        return { error: err instanceof Error ? err.message : "Signing failed" };
      }
    }

    case "REJECT_REQUEST": {
      // Called by popup when user rejects
      const req = pendingRequests.get(message.requestId);
      if (req) {
        req.reject(new Error("User rejected"));
        pendingRequests.delete(message.requestId);
      }
      return { success: true };
    }

    case "PING": {
      return { ok: true, source: "nostr-signer-background" };
    }

    default:
      return undefined;
  }
});

async function showNotification(title: string, message: string) {
  try {
    await browser.notifications.create({
      type: "basic",
      iconUrl: "/vite.svg",
      title,
      message,
    });
  } catch {
    // Notifications may not be supported
  }
}

async function showSignConfirmation(requestId: string, origin: string, event: any) {
  try {
    // Store request ID so popup can access it
    await browser.storage.session.set({
      pendingRequestId: requestId,
      pendingOrigin: origin,
      pendingEvent: event,
    });

    // Open popup
    await browser.action.openPopup();
  } catch {
    // Fallback: just open popup
    browser.action.openPopup();
  }
}

browser.runtime.onInstalled.addListener(() => {
  console.info("Nostr Signer installed");
});
