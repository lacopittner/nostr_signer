import type { IdentityRecord, SignedNostrEvent } from "@nostr-signer/signer-core";
import browser from "webextension-polyfill";
import { vault } from "./lib/vault";

const DEFAULT_PROFILE_KEY = "nostr_signer_default_profile_id";
const ORIGIN_PROFILE_MAP_KEY = "nostr_signer_origin_profile_map";
const SIGN_POLICY_MAP_KEY = "nostr_signer_sign_policy_map";
const REMEMBER_UNLOCK_KEY = "nostr_signer_remember_unlock";
const SESSION_UNLOCK_KEY = "nostr_signer_session_unlock";
const APPROVAL_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const APPROVAL_WINDOW_WIDTH = 520;
const APPROVAL_WINDOW_HEIGHT = 760;

const DEFAULT_RELAYS: Record<string, { read: boolean; write: boolean }> = {
  "wss://relay.damus.io": { read: true, write: true },
  "wss://nos.lol": { read: true, write: true },
  "wss://relay.primal.net": { read: true, write: true },
};

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

interface SignEventPayload {
  kind: number;
  content: string;
  tags: string[][];
  created_at?: number;
}

interface PendingSignRequest {
  id: string;
  origin: string;
  payload: SignEventPayload;
  selectedIdentityId: string | null;
  autoApprove: boolean;
  resolve: (value: SignedNostrEvent) => void;
  reject: (reason: Error) => void;
  timestamp: number;
}

interface PopupPendingRequest {
  id: string;
  origin: string;
  event: SignEventPayload;
  selectedIdentityId: string | null;
  autoApprove: boolean;
}

const pendingRequests = new Map<string, PendingSignRequest>();
let approvalWindowId: number | null = null;
let approvalSurfaceOpening: Promise<boolean> | null = null;

browser.runtime.onInstalled.addListener(() => {
  console.info("Nostr Signer installed");
});

browser.windows.onRemoved.addListener((windowId: number) => {
  if (windowId === approvalWindowId) {
    approvalWindowId = null;
  }
});

setInterval(() => {
  const now = Date.now();
  let removedAny = false;
  for (const [requestId, request] of pendingRequests) {
    if (now - request.timestamp > APPROVAL_REQUEST_TIMEOUT_MS) {
      request.reject(new Error("Request timeout"));
      pendingRequests.delete(requestId);
      removedAny = true;
    }
  }
  if (removedAny) {
    void onPendingRequestsChanged(pendingRequests.size > 0);
  }
}, 60_000);

browser.runtime.onMessage.addListener(async (message: unknown) => {
  const data = toRecord(message);
  const type = asString(data.type);

  switch (type) {
    case "NOSTR_GET_PUBLIC_KEY": {
      try {
        await vault.reload();
        await enforceBackgroundLockPolicy();

        const requestOrigin = parseRequestOrigin(data.origin);
        const identity = await resolveIdentityForOrigin(requestOrigin);
        if (!identity) {
          return { error: "No identity available" };
        }

        if (requestOrigin !== "unknown") {
          await bindOriginProfile(requestOrigin, identity.id);
        }

        return identity.pubkey;
      } catch (error) {
        return { error: toErrorMessage(error, "Failed to get public key") };
      }
    }

    case "NOSTR_GET_RELAYS": {
      return DEFAULT_RELAYS;
    }

    case "NOSTR_SIGN_EVENT": {
      try {
        await vault.reload();
        await enforceBackgroundLockPolicy();

        const requestOrigin = parseRequestOrigin(data.origin);
        const payload = normalizeSignEventPayload(data.payload);
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

          if (unlocked) {
            const signed = await signEventWithIdentity(payload, selectedIdentity.id);
            if (requestOrigin !== "unknown") {
              await bindOriginProfile(requestOrigin, selectedIdentity.id);
            }
            return signed;
          }

          await showNotification("Nostr Signer", `${requestOrigin} requests signature. Unlock to continue.`);
          return await queuePendingSignRequest({
            origin: requestOrigin,
            payload,
            selectedIdentityId: selectedIdentity.id,
            autoApprove: true,
          });
        }

        const unlocked = await vault.isUnlocked();
        if (!unlocked) {
          await showNotification("Nostr Signer", `${requestOrigin} requests signature. Unlock to continue.`);
        }

        return await queuePendingSignRequest({
          origin: requestOrigin,
          payload,
          selectedIdentityId: identity.id,
          autoApprove: false,
        });
      } catch (error) {
        return { error: toErrorMessage(error, "Failed to sign") };
      }
    }

    case "NOSTR_NIP04_ENCRYPT":
    case "NOSTR_NIP04_DECRYPT":
    case "NOSTR_NIP44_ENCRYPT":
    case "NOSTR_NIP44_DECRYPT": {
      return { error: "NIP-04/NIP-44 not yet implemented" };
    }

    case "GET_PENDING_REQUEST": {
      const requestId = asString(data.requestId);
      const request = requestId ? pendingRequests.get(requestId) ?? null : null;
      return { pendingRequest: toPopupPendingRequest(request) };
    }

    case "GET_LATEST_PENDING_REQUEST": {
      return { pendingRequest: getLatestPopupPendingRequest() };
    }

    case "UNLOCK_VAULT": {
      const pin = asString(data.pin);
      const ttlMs = asFiniteNumber(data.ttlMs);
      if (!pin) {
        return { error: "PIN is required" };
      }
      const unlocked = await vault.unlock(pin, ttlMs ?? undefined);
      if (!unlocked) {
        return { error: "Invalid PIN" };
      }
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
      const payload = toRecord(data.payload);
      const requestOrigin = normalizeOrigin(payload.origin);
      if (!requestOrigin) {
        return { error: "Invalid origin" };
      }

      const signPolicyRaw = asString(payload.signPolicy);
      const signPolicy: TrustedSignPolicyMode =
        signPolicyRaw === "always_allow" || signPolicyRaw === "always_reject" ? signPolicyRaw : "ask";

      const requestedPolicyIdentityId = asString(payload.policyIdentityId) || null;
      const requestedBoundProfileId = asString(payload.boundProfileId) || null;

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
      } else if (payload.boundProfileId === null || payload.boundProfileId === "") {
        delete originProfiles[requestOrigin];
      }

      await saveSignPolicies(signPolicies);
      await saveOriginProfiles(originProfiles);

      const entries = await buildTrustedWebsiteEntries();
      return { success: true, entries };
    }

    case "REMOVE_TRUSTED_WEBSITE": {
      const payload = toRecord(data.payload);
      const requestOrigin = normalizeOrigin(payload.origin);
      if (!requestOrigin) {
        return { error: "Invalid origin" };
      }

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
      const requestId = asString(data.requestId);
      if (!requestId) {
        return { error: "Request not found" };
      }
      const identityId = asString(data.identityId) || null;
      const alwaysAllow = Boolean(data.alwaysAllow);
      return approvePendingRequest(requestId, identityId, alwaysAllow);
    }

    case "REJECT_REQUEST": {
      const requestId = asString(data.requestId);
      if (!requestId) {
        return { error: "Request not found" };
      }
      const alwaysReject = Boolean(data.alwaysReject);
      return rejectPendingRequest(requestId, alwaysReject);
    }

    case "PING": {
      return { ok: true, source: "nostr-signer-background" };
    }

    default:
      return undefined;
  }
});

function getLatestPendingRequest(): PendingSignRequest | null {
  for (const request of pendingRequests.values()) {
    return request;
  }
  return null;
}

function toPopupPendingRequest(request: PendingSignRequest | null): PopupPendingRequest | null {
  if (!request) return null;
  return {
    id: request.id,
    origin: request.origin,
    event: request.payload,
    selectedIdentityId: request.selectedIdentityId,
    autoApprove: request.autoApprove,
  };
}

function getLatestPopupPendingRequest(): PopupPendingRequest | null {
  return toPopupPendingRequest(getLatestPendingRequest());
}

async function queuePendingSignRequest(params: {
  origin: string;
  payload: SignEventPayload;
  selectedIdentityId: string | null;
  autoApprove: boolean;
}): Promise<SignedNostrEvent> {
  const requestId = crypto.randomUUID();

  return new Promise<SignedNostrEvent>((resolve, reject) => {
    pendingRequests.set(requestId, {
      id: requestId,
      origin: params.origin,
      payload: params.payload,
      selectedIdentityId: params.selectedIdentityId,
      autoApprove: params.autoApprove,
      resolve,
      reject,
      timestamp: Date.now(),
    });

    const shouldOpenSurface = pendingRequests.size === 1;
    void onPendingRequestsChanged(shouldOpenSurface);
  });
}

async function approvePendingRequest(requestId: string, requestedIdentityId: string | null, alwaysAllow: boolean) {
  const request = pendingRequests.get(requestId);
  if (!request) {
    return { error: "Request not found" };
  }

  try {
    const identityId = await resolveApprovedIdentityId(requestedIdentityId, request.selectedIdentityId);
    if (!identityId) {
      throw new Error("No profile selected");
    }

    const signed = await signEventWithIdentity(request.payload, identityId);

    if (request.origin !== "unknown") {
      await bindOriginProfile(request.origin, identityId);
      if (alwaysAllow) {
        await saveSignPolicy(request.origin, { mode: "always_allow", identityId });
      }
    }

    request.resolve(signed);
    return { success: true };
  } catch (error) {
    const normalized = toError(error, "Signing failed");
    request.reject(normalized);
    return { error: normalized.message };
  } finally {
    pendingRequests.delete(requestId);
    void onPendingRequestsChanged(pendingRequests.size > 0);
  }
}

async function rejectPendingRequest(requestId: string, alwaysReject: boolean) {
  const request = pendingRequests.get(requestId);
  if (!request) {
    return { success: true };
  }

  if (alwaysReject && request.origin !== "unknown") {
    await saveSignPolicy(request.origin, { mode: "always_reject" });
  }

  request.reject(new Error("User rejected"));
  pendingRequests.delete(requestId);
  void onPendingRequestsChanged(pendingRequests.size > 0);

  return { success: true };
}

async function onPendingRequestsChanged(shouldOpenSurface: boolean) {
  await broadcastPendingRequestUpdate();
  if (!shouldOpenSurface) return;

  const opened = await ensureApprovalSurface();
  if (!opened) {
    await showNotification(
      "Nostr Signer",
      "Signature request pending. Open the extension popup to approve or reject."
    );
  }
}

async function broadcastPendingRequestUpdate() {
  try {
    await browser.runtime.sendMessage({
      type: "PENDING_REQUEST_UPDATED",
      pendingRequest: getLatestPopupPendingRequest(),
    });
  } catch {
    // No live listeners is normal.
  }
}

async function ensureApprovalSurface(): Promise<boolean> {
  if (approvalWindowId !== null) {
    try {
      await browser.windows.update(approvalWindowId, { focused: true });
      return true;
    } catch {
      approvalWindowId = null;
    }
  }

  if (approvalSurfaceOpening) {
    return approvalSurfaceOpening;
  }

  const opening = (async () => {
    try {
      await browser.action.openPopup();
      return true;
    } catch {
      try {
        const created = await browser.windows.create({
          url: browser.runtime.getURL("index.html#sign-request"),
          type: "popup",
          focused: true,
          width: APPROVAL_WINDOW_WIDTH,
          height: APPROVAL_WINDOW_HEIGHT,
        });

        approvalWindowId = created.id ?? null;
        return true;
      } catch (error) {
        console.error("[Nostr Signer] Failed to open approval UI:", error);
        return false;
      }
    }
  })();

  approvalSurfaceOpening = opening;

  try {
    return await opening;
  } finally {
    if (approvalSurfaceOpening === opening) {
      approvalSurfaceOpening = null;
    }
  }
}

async function showNotification(title: string, message: string) {
  try {
    await browser.notifications.create({
      type: "basic",
      iconUrl: "/vite.svg",
      title,
      message,
    });
  } catch {
    // Notifications may not be supported.
  }
}

async function resolveIdentityForOrigin(origin: string): Promise<IdentityRecord | null> {
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

async function resolveIdentityById(identityId: string | null): Promise<IdentityRecord | null> {
  if (!identityId) return null;
  const identities = await vault.listIdentities();
  return identities.find((identity) => identity.id === identityId) ?? null;
}

async function resolveApprovedIdentityId(
  requestedIdentityId: string | null,
  fallbackIdentityId: string | null
): Promise<string | null> {
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
      remember = result[REMEMBER_UNLOCK_KEY] as boolean;
    }
  } catch {
    // Ignore preference read errors.
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

async function signEventWithIdentity(payload: SignEventPayload, identityId: string): Promise<SignedNostrEvent> {
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
    // Ignore storage errors.
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
    // Ignore storage errors.
  }
}

async function buildTrustedWebsiteEntries(): Promise<TrustedWebsiteEntry[]> {
  const signPolicies = await loadSignPolicies();
  const originProfiles = await loadOriginProfiles();

  const allOrigins = new Set<string>([...Object.keys(signPolicies), ...Object.keys(originProfiles)]);

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

function parseRequestOrigin(rawOrigin: unknown): string {
  const normalized = normalizeOrigin(rawOrigin);
  return normalized ?? "unknown";
}

function normalizeSignEventPayload(payload: unknown): SignEventPayload {
  const source = toRecord(payload);

  const kind = asFiniteNumber(source.kind) ?? 1;
  const content = asString(source.content) || "";
  const createdAtRaw = asFiniteNumber(source.created_at);
  const createdAt = typeof createdAtRaw === "number" ? Math.trunc(createdAtRaw) : undefined;

  const tagsSource = Array.isArray(source.tags) ? source.tags : [];
  const tags = tagsSource
    .filter((entry): entry is unknown[] => Array.isArray(entry))
    .map((entry) => entry.map((item) => String(item)));

  return {
    kind,
    content,
    tags,
    created_at: createdAt,
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value) return new Error(value);
  return new Error(fallback);
}

function toErrorMessage(value: unknown, fallback: string): string {
  return toError(value, fallback).message;
}
