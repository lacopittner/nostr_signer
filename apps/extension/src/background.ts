import browser from "webextension-polyfill";
import { vault } from "./lib/vault";

const DEFAULT_PROFILE_KEY = "nostr_signer_default_profile_id";
const ORIGIN_PROFILE_MAP_KEY = "nostr_signer_origin_profile_map";
const SIGN_POLICY_MAP_KEY = "nostr_signer_sign_policy_map";
const REMEMBER_UNLOCK_KEY = "nostr_signer_remember_unlock";
const SESSION_UNLOCK_KEY = "nostr_signer_session_unlock";
const DEFAULT_RELAYS: Record<string, { read: boolean; write: boolean }> = {
  "wss://relay.damus.io": { read: true, write: true },
  "wss://nos.lol": { read: true, write: true },
  "wss://relay.primal.net": { read: true, write: true },
};
const APPROVAL_WINDOW_WIDTH = 520;
const APPROVAL_WINDOW_HEIGHT = 760;
type SignPolicyMode = "always_allow" | "always_reject";

interface SignPolicy {
  mode: SignPolicyMode;
  identityId?: string;
}

type SignPolicyMap = Record<string, SignPolicy>;
type OriginProfileMap = Record<string, string>;
type TrustedSignPolicyMode = "ask" | SignPolicyMode;
type TrustedCapabilityState = "allow" | "ask" | "deny";

interface TrustedCapability {
  key: "get_public_key" | "sign_event";
  label: string;
  state: TrustedCapabilityState;
}

interface TrustedWebsiteEntry {
  origin: string;
  signPolicy: TrustedSignPolicyMode;
  policyIdentityId: string | null;
  boundProfileId: string | null;
  capabilities: TrustedCapability[];
}

// Pending sign requests
interface PendingRequest {
  id: string;
  type: string;
  origin: string;
  payload: any;
  selectedIdentityId: string | null;
  autoApprove: boolean;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest>();
let approvalWindowId: number | null = null;

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
browser.runtime.onMessage.addListener(async (message) => {
  const { type, payload, origin } = message;

  switch (type) {
    case "NOSTR_GET_PUBLIC_KEY": {
      try {
        await vault.reload();
        await enforceBackgroundLockPolicy();
        const identity = await resolveIdentityForOrigin(origin || "unknown");
        if (!identity) {
          return { error: "No identity available" };
        }
        if (origin) {
          await bindOriginProfile(origin, identity.id);
        }
        return identity.pubkey;
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Unknown error" };
      }
    }

    case "NOSTR_GET_RELAYS": {
      return DEFAULT_RELAYS;
    }

    case "NOSTR_SIGN_EVENT": {
      try {
        await vault.reload();
        await enforceBackgroundLockPolicy();
        const requestOrigin = origin || "unknown";
        const identity = await resolveIdentityForOrigin(requestOrigin);
        if (!identity) {
          return { error: "No identity available" };
        }

        const signPolicies = await loadSignPolicies();
        const policy = signPolicies[requestOrigin];

        if (policy?.mode === "always_reject") {
          return { error: "Rejected by policy" };
        }

        if (policy?.mode === "always_allow") {
          const policyIdentity = await resolveIdentityById(policy.identityId ?? null);
          const selectedIdentity = policyIdentity ?? identity;

          const unlocked = await vault.isUnlocked();
          if (!unlocked) {
            await showNotification("Nostr Signer", `${requestOrigin} requests signature. Unlock to continue.`);

            const requestId = crypto.randomUUID();
            return new Promise((resolve, reject) => {
              pendingRequests.set(requestId, {
                id: requestId,
                type: "SIGN_EVENT",
                origin: requestOrigin,
                payload,
                selectedIdentityId: selectedIdentity.id,
                autoApprove: true,
                resolve,
                reject,
                timestamp: Date.now(),
              });

              void showSignConfirmation(requestId, requestOrigin, payload, selectedIdentity.id, true).then(
                (opened) => {
                  if (opened) return;
                  const pending = pendingRequests.get(requestId);
                  if (!pending) return;
                  pending.reject(new Error("Unable to open approval window. Click extension icon and try again."));
                  pendingRequests.delete(requestId);
                }
              );
            });
          }

          const signed = await signEventWithIdentity(payload, selectedIdentity.id);
          await bindOriginProfile(requestOrigin, selectedIdentity.id);
          return signed;
        }

        // For manual approval flow we can proceed even when locked.
        // Popup will first show unlock and then signing confirmation.
        const unlocked = await vault.isUnlocked();
        if (!unlocked) {
          await showNotification("Nostr Signer", `${requestOrigin} requests signature. Unlock to continue.`);
        }

        // Create pending request
        const requestId = crypto.randomUUID();
        
        return new Promise((resolve, reject) => {
          pendingRequests.set(requestId, {
            id: requestId,
            type: "SIGN_EVENT",
            origin: requestOrigin,
            payload,
            selectedIdentityId: identity.id,
            autoApprove: false,
            resolve,
            reject,
            timestamp: Date.now(),
          });

          // Open popup for confirmation
          void showSignConfirmation(requestId, requestOrigin, payload, identity.id, false).then((opened) => {
            if (opened) return;
            const pending = pendingRequests.get(requestId);
            if (!pending) return;
            pending.reject(new Error("Unable to open approval window. Click extension icon and try again."));
            pendingRequests.delete(requestId);
          });
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

    case "UNLOCK_VAULT": {
      const pin = typeof message.pin === "string" ? message.pin : "";
      const ttlMs = typeof message.ttlMs === "number" && Number.isFinite(message.ttlMs) ? message.ttlMs : undefined;
      if (!pin) return { error: "PIN is required" };
      const unlocked = await vault.unlock(pin, ttlMs);
      if (!unlocked) return { error: "Invalid PIN" };
      return { success: true };
    }

    case "LOCK_VAULT": {
      await vault.lock();
      return { success: true };
    }

    case "GET_TRUSTED_WEBSITES": {
      const entries = await buildTrustedWebsiteEntries();
      return { entries };
    }

    case "UPDATE_TRUSTED_WEBSITE": {
      const requestOrigin = normalizeOrigin(message.payload?.origin);
      if (!requestOrigin) return { error: "Invalid origin" };

      const signPolicy = message.payload?.signPolicy as TrustedSignPolicyMode | undefined;
      const requestedPolicyIdentityId =
        typeof message.payload?.policyIdentityId === "string" ? message.payload.policyIdentityId : null;
      const requestedBoundProfileId =
        typeof message.payload?.boundProfileId === "string" ? message.payload.boundProfileId : null;

      const signPolicies = await loadSignPolicies();
      const originProfiles = await loadOriginProfiles();

      if (signPolicy === "always_allow") {
        const resolvedIdentityId = await resolveApprovedIdentityId(
          requestedPolicyIdentityId,
          requestedBoundProfileId ?? originProfiles[requestOrigin] ?? null
        );
        if (!resolvedIdentityId) {
          return { error: "No profile available for always allow" };
        }
        signPolicies[requestOrigin] = { mode: "always_allow", identityId: resolvedIdentityId };
      } else if (signPolicy === "always_reject") {
        signPolicies[requestOrigin] = { mode: "always_reject" };
      } else {
        delete signPolicies[requestOrigin];
      }

      if (requestedBoundProfileId) {
        const existingIdentity = await resolveIdentityById(requestedBoundProfileId);
        if (!existingIdentity) {
          return { error: "Bound profile not found" };
        }
        originProfiles[requestOrigin] = requestedBoundProfileId;
      } else if (message.payload?.boundProfileId === null || message.payload?.boundProfileId === "") {
        delete originProfiles[requestOrigin];
      }

      await saveSignPolicies(signPolicies);
      await saveOriginProfiles(originProfiles);

      const entries = await buildTrustedWebsiteEntries();
      return { success: true, entries };
    }

    case "REMOVE_TRUSTED_WEBSITE": {
      const requestOrigin = normalizeOrigin(message.payload?.origin);
      if (!requestOrigin) return { error: "Invalid origin" };

      const signPolicies = await loadSignPolicies();
      const originProfiles = await loadOriginProfiles();

      delete signPolicies[requestOrigin];
      delete originProfiles[requestOrigin];

      await saveSignPolicies(signPolicies);
      await saveOriginProfiles(originProfiles);

      const entries = await buildTrustedWebsiteEntries();
      return { success: true, entries };
    }

    case "APPROVE_REQUEST": {
      // Called by popup when user approves
      const req = pendingRequests.get(message.requestId);
      if (!req) return { error: "Request not found" };

      try {
        if (req.type === "SIGN_EVENT") {
          const identityId = await resolveApprovedIdentityId(
            typeof message.identityId === "string" ? message.identityId : null,
            req.selectedIdentityId
          );

          if (!identityId) {
            throw new Error("No profile selected");
          }

          const signed = await signEventWithIdentity(req.payload, identityId);

          if (req.origin) {
            await bindOriginProfile(req.origin, identityId);
          }
          if (message.alwaysAllow && req.origin) {
            await saveSignPolicy(req.origin, { mode: "always_allow", identityId });
          }

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
        if (message.alwaysReject && req.origin) {
          await saveSignPolicy(req.origin, { mode: "always_reject" });
        }
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

async function showSignConfirmation(
  requestId: string,
  origin: string,
  event: any,
  selectedIdentityId: string | null,
  autoApprove: boolean
): Promise<boolean> {
  try {
    // Store request ID so popup can access it
    await browser.storage.session.set({
      pendingRequestId: requestId,
      pendingOrigin: origin,
      pendingEvent: event,
      pendingSelectedIdentityId: selectedIdentityId,
      pendingAutoApprove: autoApprove,
    });

    // Prefer opening the extension popup (as if user clicked extension icon).
    // If browser blocks it due missing user gesture, fallback to dedicated popup window.
    try {
      await browser.action.openPopup();
      return true;
    } catch (err) {
      console.warn("[Nostr Signer] action.openPopup failed, using popup-window fallback:", err);
      return openApprovalWindow();
    }
  } catch (err) {
    console.error("[Nostr Signer] Failed to prepare sign confirmation:", err);
    // If session storage fails, still try to open approval surface.
    return openApprovalWindow();
  }
}

browser.runtime.onInstalled.addListener(() => {
  console.info("Nostr Signer installed");
});

async function resolveIdentityForOrigin(origin: string) {
  const identities = await vault.listIdentities();
  if (!identities.length) return null;

  const originProfiles = await loadOriginProfiles();
  const preferredIdentityId = originProfiles[origin] ?? (await loadDefaultProfileId());
  const preferred = identities.find((identity) => identity.id === preferredIdentityId);
  if (preferred) return preferred;

  const active = await vault.getActiveIdentity();
  if (active) return active;

  return identities[0] ?? null;
}

async function resolveIdentityById(identityId: string | null) {
  if (!identityId) return null;
  const identities = await vault.listIdentities();
  return identities.find((identity) => identity.id === identityId) ?? null;
}

async function resolveApprovedIdentityId(requestedIdentityId: string | null, fallbackIdentityId: string | null) {
  const requested = await resolveIdentityById(requestedIdentityId);
  if (requested) return requested.id;

  const fallback = await resolveIdentityById(fallbackIdentityId);
  if (fallback) return fallback.id;

  const active = await vault.getActiveIdentity();
  if (active) return active.id;

  const identities = await vault.listIdentities();
  return identities[0]?.id ?? null;
}

async function enforceBackgroundLockPolicy() {
  let remember = true;
  try {
    const result = await browser.storage.local.get(REMEMBER_UNLOCK_KEY);
    if (typeof result[REMEMBER_UNLOCK_KEY] === "boolean") {
      remember = result[REMEMBER_UNLOCK_KEY];
    }
  } catch {
    // ignore preference read errors
  }

  const unlocked = await vault.isUnlocked();
  if (!unlocked) return;

  if (!remember) {
    await vault.lock();
    return;
  }

  try {
    const session = await browser.storage.session.get(SESSION_UNLOCK_KEY);
    const sessionAllowed = Boolean(session[SESSION_UNLOCK_KEY]);
    if (!sessionAllowed) {
      await vault.lock();
    }
  } catch {
    await vault.lock();
  }
}

async function signEventWithIdentity(payload: any, identityId: string) {
  return vault.signEvent({
    kind: payload.kind,
    content: payload.content,
    tags: payload.tags,
    created_at: payload.created_at,
    identityId,
  });
}

async function loadDefaultProfileId(): Promise<string | null> {
  try {
    const result = await browser.storage.local.get(DEFAULT_PROFILE_KEY);
    const value = result[DEFAULT_PROFILE_KEY];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function loadOriginProfiles(): Promise<OriginProfileMap> {
  try {
    const result = await browser.storage.local.get(ORIGIN_PROFILE_MAP_KEY);
    const value = result[ORIGIN_PROFILE_MAP_KEY];
    if (!value || typeof value !== "object") return {};
    return value as OriginProfileMap;
  } catch {
    return {};
  }
}

async function saveOriginProfiles(map: OriginProfileMap) {
  try {
    await browser.storage.local.set({ [ORIGIN_PROFILE_MAP_KEY]: map });
  } catch {
    // ignore storage errors
  }
}

async function bindOriginProfile(origin: string, identityId: string) {
  const originProfiles = await loadOriginProfiles();
  if (originProfiles[origin] === identityId) return;
  originProfiles[origin] = identityId;
  await saveOriginProfiles(originProfiles);
}

async function loadSignPolicies(): Promise<SignPolicyMap> {
  try {
    const result = await browser.storage.local.get(SIGN_POLICY_MAP_KEY);
    const value = result[SIGN_POLICY_MAP_KEY];
    if (!value || typeof value !== "object") return {};
    return value as SignPolicyMap;
  } catch {
    return {};
  }
}

async function saveSignPolicy(origin: string, policy: SignPolicy) {
  const policies = await loadSignPolicies();
  policies[origin] = policy;
  await saveSignPolicies(policies);
}

async function saveSignPolicies(policies: SignPolicyMap) {
  try {
    await browser.storage.local.set({ [SIGN_POLICY_MAP_KEY]: policies });
  } catch {
    // ignore storage errors
  }
}

async function buildTrustedWebsiteEntries(): Promise<TrustedWebsiteEntry[]> {
  const signPolicies = await loadSignPolicies();
  const originProfiles = await loadOriginProfiles();

  const allOrigins = new Set<string>([
    ...Object.keys(signPolicies),
    ...Object.keys(originProfiles),
  ]);

  const entries: TrustedWebsiteEntry[] = [...allOrigins]
    .sort((a, b) => a.localeCompare(b))
    .map((origin) => {
      const signPolicy = signPolicies[origin];
      return {
        origin,
        signPolicy: signPolicy?.mode ?? "ask",
        policyIdentityId: signPolicy?.mode === "always_allow" ? signPolicy.identityId ?? null : null,
        boundProfileId: originProfiles[origin] ?? null,
        capabilities: [
          {
            key: "get_public_key",
            label: "Get public key",
            state: "allow",
          },
          {
            key: "sign_event",
            label: "Sign events",
            state:
              signPolicy?.mode === "always_allow"
                ? "allow"
                : signPolicy?.mode === "always_reject"
                  ? "deny"
                  : "ask",
          },
        ],
      };
    });

  return entries;
}

function normalizeOrigin(rawOrigin: unknown): string | null {
  if (typeof rawOrigin !== "string" || !rawOrigin.trim()) return null;
  try {
    const url = new URL(rawOrigin.trim());
    return url.origin;
  } catch {
    return null;
  }
}

async function openApprovalWindow(): Promise<boolean> {
  const approvalUrl = browser.runtime.getURL("index.html#sign-request");

  if (approvalWindowId !== null) {
    try {
      await browser.windows.update(approvalWindowId, { focused: true });
      return true;
    } catch {
      approvalWindowId = null;
    }
  }

  try {
    const created = await browser.windows.create({
      url: approvalUrl,
      type: "popup",
      focused: true,
      width: APPROVAL_WINDOW_WIDTH,
      height: APPROVAL_WINDOW_HEIGHT,
    });

    approvalWindowId = created.id ?? null;
    return true;
  } catch (popupErr) {
    console.warn("[Nostr Signer] Popup window creation failed, trying normal window fallback:", popupErr);
    try {
      const created = await browser.windows.create({
        url: approvalUrl,
        type: "normal",
        focused: true,
        width: APPROVAL_WINDOW_WIDTH,
        height: APPROVAL_WINDOW_HEIGHT,
      });
      approvalWindowId = created.id ?? null;
      return true;
    } catch (windowErr) {
      console.error("[Nostr Signer] Failed to open approval window:", windowErr);
      await showNotification(
        "Nostr Signer",
        "Signature request pending. Click the extension icon to approve."
      );
      return false;
    }
  }
}

browser.windows.onRemoved.addListener((windowId) => {
  if (windowId === approvalWindowId) {
    approvalWindowId = null;
  }
});
