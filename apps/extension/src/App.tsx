import { useCallback, useEffect, useState } from "react";
import { hexToNpub, hexToNsec, type IdentityRecord } from "@nostr-signer/signer-core";
import { vault } from "./lib/vault";
import browser from "webextension-polyfill";

type ThemeMode = "light" | "dark";
const THEME_STORAGE_KEY = "nostr_signer_theme";
const REMEMBER_UNLOCK_KEY = "nostr_signer_remember_unlock";
const SESSION_UNLOCK_KEY = "nostr_signer_session_unlock";
const LOCKED_STATE_KEY = "nostr_signer_locked";
const DEFAULT_PROFILE_KEY = "nostr_signer_default_profile_id";
const DEFAULT_UNLOCK_TTL_MS = 15 * 60 * 1000;
const SESSION_UNLOCK_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type TrustedSignPolicyMode = "ask" | "always_allow" | "always_reject";
type TrustedCapabilityState = "allow" | "ask" | "deny";

interface TrustedCapability {
  key: "get_public_key" | "sign_event";
  label: string;
  state: TrustedCapabilityState;
}

interface TrustedWebsiteEntry {
  origin: string;
  getPublicKeyPolicy: TrustedSignPolicyMode;
  signPolicy: TrustedSignPolicyMode;
  policyIdentityId: string | null;
  boundProfileId: string | null;
  capabilities: TrustedCapability[];
}

interface PendingRequestState {
  id: string;
  type: "sign_event" | "get_public_key";
  origin: string;
  event: any | null;
  selectedIdentityId: string | null;
  autoApprove: boolean;
}

const KNOWN_KIND_LABELS: Record<number, string> = {
  0: "Profile metadata update",
  1: "Text note post",
  3: "Follow list update",
  4: "Encrypted direct message",
  5: "Deletion request",
  6: "Repost",
  7: "Reaction",
  40: "Channel creation",
  41: "Channel metadata update",
  42: "Channel message",
  43: "Channel hide message",
  44: "Channel mute user",
  9734: "Zap request",
  9735: "Zap receipt",
  10002: "Relay list update",
  30023: "Long-form article",
};

function describeEventKind(kind: unknown): string {
  if (typeof kind !== "number" || !Number.isFinite(kind)) {
    return "Unknown event type";
  }
  const direct = KNOWN_KIND_LABELS[kind];
  if (direct) return direct;
  if (kind >= 30000 && kind < 40000) return "Parameterized replaceable event";
  if (kind >= 20000 && kind < 30000) return "Ephemeral event";
  if (kind >= 10000 && kind < 20000) return "Replaceable event";
  return "Custom event";
}

// Sign Request Confirmation Screen
function SignRequestScreen({
  requestId,
  requestType,
  origin,
  event,
  identities,
  defaultProfileId,
  initialProfileId,
  autoApprove,
  onComplete,
}: {
  requestId: string;
  requestType: "sign_event" | "get_public_key";
  origin: string;
  event: any | null;
  identities: IdentityRecord[];
  defaultProfileId: string | null;
  initialProfileId: string | null;
  autoApprove: boolean;
  onComplete: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoApproveAttempted, setAutoApproveAttempted] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState(
    initialProfileId ?? defaultProfileId ?? identities[0]?.id ?? ""
  );

  useEffect(() => {
    if (!identities.length) {
      setSelectedProfileId("");
      return;
    }
    const hasSelected = identities.some((identity) => identity.id === selectedProfileId);
    if (!hasSelected) {
      setSelectedProfileId(initialProfileId ?? defaultProfileId ?? identities[0]?.id ?? "");
    }
  }, [defaultProfileId, identities, initialProfileId, selectedProfileId]);

  const completeAndClose = () => {
    onComplete();
    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        // ignore close errors
      }
    }, 40);
  };

  const handleApprove = async (alwaysAllow: boolean) => {
    if (!selectedProfileId) {
      setError("Select profile for signing");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await browser.runtime.sendMessage({
        type: "APPROVE_REQUEST",
        requestId,
        identityId: selectedProfileId,
        alwaysAllow,
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      completeAndClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign");
      setLoading(false);
    }
  };

  const handleReject = async (alwaysReject: boolean) => {
    setLoading(true);
    setError("");
    try {
      const response = await browser.runtime.sendMessage({
        type: "REJECT_REQUEST",
        requestId,
        alwaysReject,
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      completeAndClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!autoApprove || autoApproveAttempted || !selectedProfileId) return;
    setAutoApproveAttempted(true);
    void handleApprove(false);
  }, [autoApprove, autoApproveAttempted, selectedProfileId]);

  return (
    <div style={{ padding: "20px", width: "500px", maxWidth: "100%" }}>
      <h2 style={{ marginBottom: "8px" }}>
        {requestType === "get_public_key"
          ? autoApprove
            ? "Access Request"
            : "Public Key Request"
          : autoApprove
            ? "Signing Request"
            : "Sign Request"}
      </h2>
      <p style={{ color: "var(--text-muted)", marginBottom: "20px", fontSize: "14px" }}>
        {autoApprove ? (
          <>
            <strong>{origin}</strong> is allowed by policy. Continuing after unlock.
          </>
        ) : (
          <>
            <strong>{origin}</strong>{" "}
            {requestType === "get_public_key"
              ? "wants to access your public key"
              : "wants to sign a Nostr event"}
          </>
        )}
      </p>

      <div style={{ marginBottom: "16px" }}>
        <label style={{ display: "block", fontSize: "13px", marginBottom: "6px", color: "var(--text-muted)" }}>
          Signing profile
        </label>
        <select
          value={selectedProfileId}
          onChange={(e) => setSelectedProfileId(e.target.value)}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid var(--border-muted)",
            background: "var(--surface-elevated)",
            color: "var(--text-primary)",
          }}
        >
          {identities.map((identity) => (
            <option key={identity.id} value={identity.id}>
              {identity.label}
              {identity.id === defaultProfileId ? " (Default)" : ""}
            </option>
          ))}
        </select>
      </div>

      {requestType === "sign_event" && event && (
        <div
          style={{
            background: "var(--surface-muted)",
            padding: "12px",
            borderRadius: "8px",
            marginBottom: "20px",
            fontSize: "13px",
          }}
        >
          <div style={{ marginBottom: "8px" }}>
            <strong>Kind:</strong> {event.kind} - {describeEventKind(event.kind)}
          </div>
          <div style={{ marginBottom: "8px" }}>
            <strong>Content:</strong>
            <div
              style={{
                marginTop: "4px",
                padding: "8px",
                background: "var(--surface-elevated)",
                borderRadius: "4px",
                wordBreak: "break-word",
                maxHeight: "100px",
                overflow: "auto",
              }}
            >
              {event.content}
            </div>
          </div>
          {event.tags?.length > 0 && (
            <div>
              <strong>Tags:</strong> {event.tags.length}
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: "var(--danger)", marginBottom: "12px", fontSize: "13px" }}>{error}</p>}

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={() => {
            void handleReject(false);
          }}
          disabled={loading}
          style={{
            flex: 1,
            padding: "12px",
            background: "var(--surface-soft)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-muted)",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Reject
        </button>
        <button
          onClick={() => {
            void handleApprove(false);
          }}
          disabled={loading}
          style={{
            flex: 1,
            padding: "12px",
            background: "var(--primary-action-bg)",
            color: "var(--primary-action-text)",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          {loading ? "Signing..." : "Allow"}
        </button>
      </div>

      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        <button
          onClick={() => {
            void handleReject(true);
          }}
          disabled={loading}
          style={{
            flex: 1,
            padding: "12px",
            background: "transparent",
            color: "var(--danger)",
            border: "1px solid color-mix(in srgb, var(--danger) 65%, var(--border-muted))",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          Always Reject
        </button>
        <button
          onClick={() => {
            void handleApprove(true);
          }}
          disabled={loading}
          style={{
            flex: 1,
            padding: "12px",
            background: "transparent",
            color: "var(--active-text)",
            border: "1px solid color-mix(in srgb, var(--active-text) 70%, var(--border-muted))",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          Always Allow
        </button>
      </div>
    </div>
  );
}

// PIN Lock Screen
function PinLockScreen({
  onUnlock,
  defaultRemember,
}: {
  onUnlock: (pin: string, remember: boolean) => Promise<boolean>;
  defaultRemember: boolean;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [remember, setRemember] = useState(defaultRemember);

  useEffect(() => {
    setRemember(defaultRemember);
  }, [defaultRemember]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await onUnlock(pin, remember);
    if (success) {
      setError("");
    } else {
      setError("Invalid PIN");
      setPin("");
    }
  };

  return (
    <div style={{ padding: "40px 20px", textAlign: "center", width: "500px", maxWidth: "100%" }}>
      <div style={{ fontSize: "48px", marginBottom: "20px" }}>🔒</div>
      <h2>Enter PIN</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: "20px" }}>Unlock Nostr Signer</p>
      
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          autoFocus
          style={{
            width: "100%",
            padding: "12px",
            fontSize: "18px",
            textAlign: "center",
            borderRadius: "8px",
            border: "1px solid var(--border-muted)",
            marginBottom: "12px",
            background: "var(--surface-elevated)",
            color: "var(--text-primary)",
          }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: "13px",
            marginBottom: "12px",
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember until browser closes
        </label>
        {error && (
          <p style={{ color: "var(--danger)", marginBottom: "12px" }}>{error}</p>
        )}
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "12px",
            background: "var(--primary-action-bg)",
            color: "var(--primary-action-text)",
            border: "none",
            borderRadius: "8px",
            fontSize: "16px",
            cursor: "pointer",
          }}
        >
          Unlock
        </button>
      </form>
    </div>
  );
}

// PIN Setup Screen
function PinSetupScreen({
  onComplete,
  defaultRemember,
}: {
  onComplete: (pin: string, remember: boolean) => Promise<void>;
  defaultRemember: boolean;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [remember, setRemember] = useState(defaultRemember);

  useEffect(() => {
    setRemember(defaultRemember);
  }, [defaultRemember]);

  const handleFirstStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) {
      setError("PIN must be at least 4 characters");
      return;
    }
    setError("");
    setStep(2);
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin !== confirmPin) {
      setError("PINs do not match");
      return;
    }
    await onComplete(pin, remember);
  };

  return (
    <div style={{ padding: "40px 20px", textAlign: "center", width: "500px", maxWidth: "100%" }}>
      <div style={{ fontSize: "48px", marginBottom: "20px" }}>🔐</div>
      <h2>{step === 1 ? "Create PIN" : "Confirm PIN"}</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: "20px" }}>
        {step === 1 ? "Set a PIN to protect your keys" : "Enter the same PIN again"}
      </p>

      {step === 1 ? (
        <form onSubmit={handleFirstStep}>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter PIN"
            autoFocus
            style={{
              width: "100%",
              padding: "12px",
              fontSize: "18px",
              textAlign: "center",
              borderRadius: "8px",
              border: "1px solid var(--border-muted)",
              marginBottom: "12px",
              background: "var(--surface-elevated)",
              color: "var(--text-primary)",
            }}
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: "13px",
              marginBottom: "12px",
            }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember until browser closes
          </label>
          {error && <p style={{ color: "var(--danger)", marginBottom: "12px" }}>{error}</p>}
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "12px",
              background: "var(--primary-action-bg)",
              color: "var(--primary-action-text)",
              border: "none",
              borderRadius: "8px",
              fontSize: "16px",
              cursor: "pointer",
            }}
          >
            Continue
          </button>
        </form>
      ) : (
        <form onSubmit={handleConfirm}>
          <input
            type="password"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            placeholder="Confirm PIN"
            autoFocus
            style={{
              width: "100%",
              padding: "12px",
              fontSize: "18px",
              textAlign: "center",
              borderRadius: "8px",
              border: "1px solid var(--border-muted)",
              marginBottom: "12px",
              background: "var(--surface-elevated)",
              color: "var(--text-primary)",
            }}
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: "13px",
              marginBottom: "12px",
            }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember until browser closes
          </label>
          {error && <p style={{ color: "var(--danger)", marginBottom: "12px" }}>{error}</p>}
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "12px",
              background: "var(--primary-action-bg)",
              color: "var(--primary-action-text)",
              border: "none",
              borderRadius: "8px",
              fontSize: "16px",
              cursor: "pointer",
            }}
          >
            Complete Setup
          </button>
          <button
            type="button"
            onClick={() => setStep(1)}
            style={{
              width: "100%",
              padding: "12px",
              marginTop: "8px",
              background: "transparent",
              color: "var(--text-muted)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Back
          </button>
        </form>
      )}
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [rememberUnlock, setRememberUnlock] = useState(true);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [identities, setIdentities] = useState<IdentityRecord[]>([]);
  const [isLocked, setIsLocked] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // Pending sign request
  const [pendingRequest, setPendingRequest] = useState<PendingRequestState | null>(null);
  
  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copyDialog, setCopyDialog] = useState<{
    title: string;
    value: string;
    copyLabel: string;
    warning?: string;
    requiresReveal?: boolean;
    revealed?: boolean;
  } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [trustedSites, setTrustedSites] = useState<TrustedWebsiteEntry[]>([]);
  const [trustedSiteDrafts, setTrustedSiteDrafts] = useState<
    Record<string, { getPublicKeyPolicy: TrustedSignPolicyMode; signPolicy: TrustedSignPolicyMode; boundProfileId: string }>
  >({});
  const [trustedSitesLoading, setTrustedSitesLoading] = useState(false);
  
  // Form states
  const [newLabel, setNewLabel] = useState("");
  const [importKey, setImportKey] = useState("");
  const [editLabel, setEditLabel] = useState("");

  const refresh = useCallback(async () => {
    const list = await vault.listIdentities();
    setIdentities(list);
  }, []);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
  }, []);

  const normalizePendingRequest = useCallback((raw: unknown): PendingRequestState | null => {
    if (!raw || typeof raw !== "object") return null;
    const request = raw as Record<string, unknown>;
    if (typeof request.id !== "string" || !request.id) return null;
    if (typeof request.origin !== "string" || !request.origin) return null;
    const type =
      request.type === "get_public_key" || request.type === "sign_event" ? request.type : "sign_event";
    const event = "event" in request ? request.event : null;

    return {
      id: request.id,
      type,
      origin: request.origin,
      event,
      selectedIdentityId: typeof request.selectedIdentityId === "string" ? request.selectedIdentityId : null,
      autoApprove: Boolean(request.autoApprove),
    };
  }, []);

  const refreshPendingRequest = useCallback(async () => {
    try {
      const response = await browser.runtime.sendMessage({ type: "GET_LATEST_PENDING_REQUEST" });
      setPendingRequest(normalizePendingRequest(response?.pendingRequest));
    } catch {
      setPendingRequest(null);
    }
  }, [normalizePendingRequest]);

  const refreshTrustedSites = useCallback(async () => {
    setTrustedSitesLoading(true);
    try {
      const response = await browser.runtime.sendMessage({ type: "GET_TRUSTED_WEBSITES" });
      if (response?.error) {
        throw new Error(response.error);
      }

      const entries: TrustedWebsiteEntry[] = Array.isArray(response?.entries)
        ? (response.entries as any[]).map((entry) => {
            const signPolicy: TrustedSignPolicyMode =
              entry?.signPolicy === "always_allow" || entry?.signPolicy === "always_reject"
                ? entry.signPolicy
                : "ask";
            const getPublicKeyPolicy: TrustedSignPolicyMode =
              entry?.getPublicKeyPolicy === "always_allow" || entry?.getPublicKeyPolicy === "always_reject"
                ? entry.getPublicKeyPolicy
                : "ask";
            const capabilityFallback: TrustedCapability[] = [
              {
                key: "get_public_key",
                label: "Get public key",
                state:
                  getPublicKeyPolicy === "always_allow"
                    ? "allow"
                    : getPublicKeyPolicy === "always_reject"
                      ? "deny"
                      : "ask",
              },
              {
                key: "sign_event",
                label: "Sign events",
                state:
                  signPolicy === "always_allow"
                    ? "allow"
                    : signPolicy === "always_reject"
                      ? "deny"
                      : "ask",
              },
            ];

            const capabilities = Array.isArray(entry?.capabilities)
              ? (entry.capabilities as any[])
                  .map((capability) => {
                    const key: TrustedCapability["key"] =
                      capability?.key === "sign_event" ? "sign_event" : "get_public_key";
                    const state: TrustedCapabilityState =
                      capability?.state === "allow" ||
                      capability?.state === "ask" ||
                      capability?.state === "deny"
                        ? capability.state
                        : "ask";
                    return {
                      key,
                      label:
                        typeof capability?.label === "string" && capability.label.trim()
                          ? capability.label
                          : key === "sign_event"
                            ? "Sign events"
                            : "Get public key",
                      state,
                    };
                  })
                  .filter(
                    (capability, index, all) =>
                      all.findIndex((item) => item.key === capability.key) === index
                  )
              : capabilityFallback;

            return {
              origin: String(entry?.origin ?? ""),
              getPublicKeyPolicy,
              signPolicy,
              policyIdentityId: typeof entry?.policyIdentityId === "string" ? entry.policyIdentityId : null,
              boundProfileId: typeof entry?.boundProfileId === "string" ? entry.boundProfileId : null,
              capabilities: capabilities.length ? capabilities : capabilityFallback,
            };
          })
        : [];
      setTrustedSites(entries);

      const nextDrafts: Record<
        string,
        { getPublicKeyPolicy: TrustedSignPolicyMode; signPolicy: TrustedSignPolicyMode; boundProfileId: string }
      > = {};
      entries.forEach((entry) => {
        nextDrafts[entry.origin] = {
          getPublicKeyPolicy: entry.getPublicKeyPolicy,
          signPolicy: entry.signPolicy,
          boundProfileId: entry.boundProfileId ?? "",
        };
      });
      setTrustedSiteDrafts(nextDrafts);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load trusted websites", "error");
    } finally {
      setTrustedSitesLoading(false);
    }
  }, [showToast]);

  const toNpub = useCallback((pubkeyHex: string) => {
    try {
      return hexToNpub(pubkeyHex);
    } catch {
      return pubkeyHex;
    }
  }, []);

  const toNsec = useCallback((privateKeyHex: string) => {
    try {
      return hexToNsec(privateKeyHex);
    } catch {
      return privateKeyHex;
    }
  }, []);

  const shortKey = useCallback((key: string, start = 16, end = 10) => {
    if (key.length <= start + end + 3) return key;
    return `${key.slice(0, start)}...${key.slice(-end)}`;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const init = async () => {
      let rememberPref = true;
      let forcedLocked = false;
      try {
        const result = await browser.storage.local.get([
          THEME_STORAGE_KEY,
          REMEMBER_UNLOCK_KEY,
          LOCKED_STATE_KEY,
          DEFAULT_PROFILE_KEY,
        ]);
        const storedTheme = result[THEME_STORAGE_KEY];
        if (storedTheme === "light" || storedTheme === "dark") {
          setTheme(storedTheme);
        }
        if (typeof result[REMEMBER_UNLOCK_KEY] === "boolean") {
          rememberPref = result[REMEMBER_UNLOCK_KEY];
        }
        if (result[LOCKED_STATE_KEY] === true) {
          forcedLocked = true;
        }
        if (typeof result[DEFAULT_PROFILE_KEY] === "string") {
          setDefaultProfileId(result[DEFAULT_PROFILE_KEY]);
        }
        setRememberUnlock(rememberPref);
      } catch {
        // Ignore preference loading errors
      }

      try {
        await refreshPendingRequest();

        const pinSet = await vault.isPinSet();
        setHasPin(pinSet);
        
        if (pinSet) {
          let unlocked = await vault.isUnlocked();
          if (forcedLocked && unlocked) {
            await vault.lock();
            try {
              await browser.runtime.sendMessage({ type: "LOCK_VAULT" });
            } catch {
              // ignore background sync errors
            }
            unlocked = false;
          } else if (unlocked) {
            if (!rememberPref) {
              await vault.lock();
              try {
                await browser.runtime.sendMessage({ type: "LOCK_VAULT" });
              } catch {
                // ignore background sync errors
              }
              unlocked = false;
            } else {
              try {
                const session = await browser.storage.session.get(SESSION_UNLOCK_KEY);
                const sessionAllowed = Boolean(session[SESSION_UNLOCK_KEY]);
                if (!sessionAllowed) {
                  await vault.lock();
                  try {
                    await browser.runtime.sendMessage({ type: "LOCK_VAULT" });
                  } catch {
                    // ignore background sync errors
                  }
                  unlocked = false;
                }
              } catch {
                await vault.lock();
                try {
                  await browser.runtime.sendMessage({ type: "LOCK_VAULT" });
                } catch {
                  // ignore background sync errors
                }
                unlocked = false;
              }
            }
          }

          try {
            await browser.storage.local.set({ [LOCKED_STATE_KEY]: !unlocked });
          } catch {
            // Ignore lock-state save errors
          }

          setIsLocked(!unlocked);
          await refresh();
          await refreshTrustedSites();
        }
      } catch (error) {
        console.error("[Nostr Signer] Vault init failed:", error);
        showToast("Vault storage read failed. Reload extension.", "error");
      }
      
      setIsLoading(false);
    };
    void init();
  }, [refresh, refreshPendingRequest, refreshTrustedSites, showToast]);

  useEffect(() => {
    const handleRuntimeMessage = (message: unknown) => {
      if (!message || typeof message !== "object") return undefined;
      const payload = message as Record<string, unknown>;
      if (payload.type !== "PENDING_REQUEST_UPDATED") return undefined;
      setPendingRequest(normalizePendingRequest(payload.pendingRequest));
      return undefined;
    };

    browser.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => {
      browser.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [normalizePendingRequest]);

  const handleToggleTheme = async () => {
    const nextTheme: ThemeMode = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    try {
      await browser.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme });
    } catch {
      showToast("Theme save failed", "error");
    }
  };

  const handleUnlock = async (pin: string, remember: boolean): Promise<boolean> => {
    const ttl = remember ? SESSION_UNLOCK_TTL_MS : DEFAULT_UNLOCK_TTL_MS;
    const success = await vault.unlock(pin, ttl);
    if (!success) return false;
    try {
      const response = await browser.runtime.sendMessage({ type: "UNLOCK_VAULT", pin, ttlMs: ttl });
      if (response?.error) {
        throw new Error(response.error);
      }
    } catch {
      await vault.lock();
      return false;
    }

    setRememberUnlock(remember);
    try {
      await browser.storage.local.set({
        [REMEMBER_UNLOCK_KEY]: remember,
        [LOCKED_STATE_KEY]: false,
      });
      if (remember) {
        await browser.storage.session.set({ [SESSION_UNLOCK_KEY]: true });
      } else {
        await browser.storage.session.remove(SESSION_UNLOCK_KEY);
      }
    } catch {
      // Ignore preference save errors
    }

    setIsLocked(false);
    await refresh();
    await refreshTrustedSites();
    return true;
  };

  const handleSetupComplete = async (pin: string, remember: boolean) => {
    await vault.setPin(pin);
    const ttl = remember ? SESSION_UNLOCK_TTL_MS : DEFAULT_UNLOCK_TTL_MS;
    const success = await vault.unlock(pin, ttl);
    if (!success) {
      setHasPin(true);
      setIsLocked(true);
      showToast("Failed to unlock after setup", "error");
      return;
    }
    try {
      const response = await browser.runtime.sendMessage({ type: "UNLOCK_VAULT", pin, ttlMs: ttl });
      if (response?.error) {
        throw new Error(response.error);
      }
    } catch {
      await vault.lock();
      setHasPin(true);
      setIsLocked(true);
      showToast("Failed to sync unlock state", "error");
      return;
    }

    setRememberUnlock(remember);
    try {
      await browser.storage.local.set({
        [REMEMBER_UNLOCK_KEY]: remember,
        [LOCKED_STATE_KEY]: false,
      });
      if (remember) {
        await browser.storage.session.set({ [SESSION_UNLOCK_KEY]: true });
      } else {
        await browser.storage.session.remove(SESSION_UNLOCK_KEY);
      }
    } catch {
      // Ignore preference save errors
    }

    setHasPin(true);
    setIsLocked(false);
    await refresh();
    await refreshTrustedSites();
  };

  const handleLock = async () => {
    await vault.lock();
    try {
      await browser.runtime.sendMessage({ type: "LOCK_VAULT" });
    } catch {
      // Ignore background sync errors
    }
    try {
      await browser.storage.local.set({ [LOCKED_STATE_KEY]: true });
      await browser.storage.session.remove(SESSION_UNLOCK_KEY);
    } catch {
      // Ignore session cleanup errors
    }
    setIsLocked(true);
  };

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    
    try {
      await vault.createIdentity(newLabel.trim());
      setNewLabel("");
      setShowCreate(false);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create");
    }
  };

  const handleImport = async () => {
    if (!newLabel.trim() || !importKey.trim()) return;
    
    try {
      await vault.importIdentity(newLabel.trim(), importKey.trim());
      setNewLabel("");
      setImportKey("");
      setShowImport(false);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to import");
    }
  };

  const handleEdit = async () => {
    if (!editingId || !editLabel.trim()) return;
    
    try {
      await vault.updateIdentity(editingId, { label: editLabel.trim() });
      setEditingId(null);
      setEditLabel("");
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    
    try {
      await vault.removeIdentity(deletingId);
      setDeletingId(null);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied`);
    } catch {
      showToast("Copy failed", "error");
    }
  };

  const openNpubDialog = (pubkeyHex: string) => {
    setCopyDialog({
      title: "Public Key (npub)",
      value: toNpub(pubkeyHex),
      copyLabel: "Public key (npub)",
      requiresReveal: false,
      revealed: true,
    });
  };

  const openNsecDialog = async (identityId: string) => {
    try {
      const privateKey = await vault.exportPrivateKey(identityId);
      setCopyDialog({
        title: "Private Key (nsec)",
        value: toNsec(privateKey),
        copyLabel: "Private key (nsec)",
        warning: "Sensitive key. Never share this with anyone.",
        requiresReveal: true,
        revealed: false,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to export private key", "error");
    }
  };

  const handleSetDefaultProfile = async (id: string) => {
    setDefaultProfileId(id);
    try {
      await browser.storage.local.set({ [DEFAULT_PROFILE_KEY]: id });
      showToast("Default profile updated");
    } catch {
      showToast("Failed to update default profile", "error");
    }
  };

  const updateTrustedSiteDraft = useCallback(
    (
      origin: string,
      updates: Partial<{ getPublicKeyPolicy: TrustedSignPolicyMode; signPolicy: TrustedSignPolicyMode; boundProfileId: string }>
    ) => {
      setTrustedSiteDrafts((prev) => {
        const current = prev[origin] ?? { getPublicKeyPolicy: "ask", signPolicy: "ask", boundProfileId: "" };
        return {
          ...prev,
          [origin]: {
            ...current,
            ...updates,
          },
        };
      });
    },
    []
  );

  const resolveDefaultProfileForPolicy = useCallback(() => {
    return defaultProfileId ?? identities[0]?.id ?? "";
  }, [defaultProfileId, identities]);

  const handleSaveTrustedWebsite = useCallback(
    async (origin: string) => {
      const draft = trustedSiteDrafts[origin];
      if (!draft) return;

      const payload: {
        origin: string;
        getPublicKeyPolicy: TrustedSignPolicyMode;
        signPolicy: TrustedSignPolicyMode;
        policyIdentityId: string | null;
        boundProfileId: string | null;
      } = {
        origin,
        getPublicKeyPolicy: draft.getPublicKeyPolicy,
        signPolicy: draft.signPolicy,
        boundProfileId: draft.boundProfileId || null,
        policyIdentityId: null,
      };

      if (payload.signPolicy === "always_allow" || payload.getPublicKeyPolicy === "always_allow") {
        payload.policyIdentityId = payload.boundProfileId || resolveDefaultProfileForPolicy() || null;
      }

      try {
        const response = await browser.runtime.sendMessage({
          type: "UPDATE_TRUSTED_WEBSITE",
          payload,
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        showToast("Trusted website updated");
        await refreshTrustedSites();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to update trusted website", "error");
      }
    },
    [refreshTrustedSites, resolveDefaultProfileForPolicy, showToast, trustedSiteDrafts]
  );

  const handleRemoveTrustedWebsite = useCallback(
    async (origin: string) => {
      try {
        const response = await browser.runtime.sendMessage({
          type: "REMOVE_TRUSTED_WEBSITE",
          payload: { origin },
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        showToast("Website removed");
        await refreshTrustedSites();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to remove trusted website", "error");
      }
    },
    [refreshTrustedSites, showToast]
  );

  useEffect(() => {
    const ensureDefaultProfile = async () => {
      if (identities.length === 0) {
        if (defaultProfileId !== null) {
          setDefaultProfileId(null);
          try {
            await browser.storage.local.remove(DEFAULT_PROFILE_KEY);
          } catch {
            // ignore storage errors
          }
        }
        return;
      }

      const validDefault = defaultProfileId && identities.some((identity) => identity.id === defaultProfileId);
      if (validDefault) return;

      const fallback = identities[0]?.id ?? null;
      if (!fallback) return;

      setDefaultProfileId(fallback);
      try {
        await browser.storage.local.set({ [DEFAULT_PROFILE_KEY]: fallback });
      } catch {
        // ignore storage errors
      }
    };

    void ensureDefaultProfile();
  }, [defaultProfileId, identities]);

  const handleSign = async () => {
    try {
      const signed = await vault.signEvent({
        kind: 1,
        content: "Test from Nostr Signer",
        tags: [["client", "nostr-signer"]],
      });
      alert(`Signed! ID: ${signed.id.slice(0, 16)}...`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to sign");
    }
  };

  if (isLoading) {
    return <div style={{ padding: 40, textAlign: "center" }}>Loading...</div>;
  }

  if (!hasPin) {
    return <PinSetupScreen onComplete={handleSetupComplete} defaultRemember={rememberUnlock} />;
  }

  if (isLocked) {
    return <PinLockScreen onUnlock={handleUnlock} defaultRemember={rememberUnlock} />;
  }

  // Show sign request confirmation first after unlock
  if (pendingRequest) {
    return (
      <SignRequestScreen
        requestId={pendingRequest.id}
        requestType={pendingRequest.type}
        origin={pendingRequest.origin}
        event={pendingRequest.event}
        identities={identities}
        defaultProfileId={defaultProfileId}
        initialProfileId={pendingRequest.selectedIdentityId}
        autoApprove={pendingRequest.autoApprove}
        onComplete={() => {
          setPendingRequest(null);
          void refresh();
          void refreshTrustedSites();
          void refreshPendingRequest();
        }}
      />
    );
  }

  return (
    <div style={{ padding: "20px", width: "500px", maxWidth: "100%" }}>
      {toast && (
        <div
          style={{
            position: "sticky",
            top: 0,
            marginBottom: "12px",
            padding: "10px 12px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            color: "white",
            background: toast.type === "success" ? "var(--success-surface)" : "var(--danger)",
            zIndex: 150,
            boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
          }}
        >
          {toast.message}
        </div>
      )}
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2>Nostr Signer</h2>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={handleToggleTheme}
            style={{
              padding: "8px 12px",
              background: "var(--surface-soft)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-muted)",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
            }}
            title="Toggle dark/light mode"
          >
            {theme === "light" ? "🌙 Dark" : "☀️ Light"}
          </button>
          <button
            onClick={handleLock}
            style={{
              padding: "8px 16px",
              background: "var(--surface-soft)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-muted)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            🔒 Lock
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            flex: 1,
            padding: "10px",
            background: "var(--primary-action-bg)",
            color: "var(--primary-action-text)",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          + Create
        </button>
        <button
          onClick={() => setShowImport(true)}
          style={{
            flex: 1,
            padding: "10px",
            background: "var(--surface-elevated)",
            color: "var(--primary-outline-text)",
            border: "1px solid var(--primary-outline-text)",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          ↓ Import
        </button>
      </div>

      {/* Identity List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {identities.map((id) => (
          <div
            key={id.id}
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: id.id === defaultProfileId ? "2px solid var(--accent)" : "1px solid var(--border-muted)",
              background: id.id === defaultProfileId ? "var(--card-active-bg)" : "var(--card-bg)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "54px" }}>
                <button
                  onClick={() => {
                    void handleSetDefaultProfile(id.id);
                  }}
                  title={id.id === defaultProfileId ? "Default profile" : "Set as default profile"}
                  aria-label={id.id === defaultProfileId ? "Default profile" : "Set default profile"}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "999px",
                    fontSize: "11px",
                    border: "1px solid var(--border-muted)",
                    background:
                      id.id === defaultProfileId ? "var(--surface-soft)" : "transparent",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  {id.id === defaultProfileId ? "Default" : "Set"}
                </button>
              </div>

              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: id.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontWeight: "bold",
                }}
              >
                {id.label[0]?.toUpperCase()}
              </div>
              
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: "600" }}>{id.label}</div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                  <span title={toNpub(id.pubkey)}>{shortKey(toNpub(id.pubkey), 18, 10)}</span>
                </div>
              </div>
              
              <div style={{ display: "flex", gap: "6px", flexShrink: 0, alignItems: "center" }}>
                <button
                  onClick={() => openNpubDialog(id.pubkey)}
                  title="Public"
                  aria-label="Public key"
                  style={{
                    padding: "6px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "11px",
                  }}
                >
                  📋
                </button>
                
                <button
                  onClick={() => {
                    void openNsecDialog(id.id);
                  }}
                  title="Private"
                  aria-label="Private key"
                  style={{
                    padding: "6px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "11px",
                  }}
                >
                  🔑
                </button>
                
                <button
                  onClick={() => {
                    setEditingId(id.id);
                    setEditLabel(id.label);
                  }}
                  title="Edit"
                  aria-label="Edit identity"
                  style={{
                    padding: "6px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "11px",
                  }}
                >
                  ✏️
                </button>
                
                <button
                  onClick={() => setDeletingId(id.id)}
                  title="Delete"
                  aria-label="Delete identity"
                  style={{
                    padding: "6px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "11px",
                  }}
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {identities.length === 0 && (
        <p style={{ textAlign: "center", color: "var(--text-subtle)", padding: "40px" }}>
          No identities yet.
          <br />
          Create or import one.
        </p>
      )}

      {/* Sign Button */}
      {identities.length > 0 && (
        <button
          onClick={handleSign}
          style={{
            marginTop: "20px",
            width: "100%",
            padding: "12px",
            background: "var(--success-surface)",
            color: "var(--primary-action-text)",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          ✍️ Sign Test Event
        </button>
      )}

      {/* Trusted Websites */}
      <div
        style={{
          marginTop: "20px",
          border: "1px solid var(--border-muted)",
          borderRadius: "10px",
          padding: "12px",
          background: "var(--surface-elevated)",
        }}
      >
        <h3 style={{ margin: "0 0 10px 0", fontSize: "15px" }}>Trusted Websites</h3>
        <p style={{ margin: "0 0 10px 0", color: "var(--text-muted)", fontSize: "12px" }}>
          Websites appear here after you choose Always Allow or Always Reject.
        </p>

        {trustedSitesLoading ? (
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "13px" }}>Loading trusted websites...</p>
        ) : trustedSites.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "13px" }}>
            No trusted websites yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {trustedSites.map((site) => {
              const draft = trustedSiteDrafts[site.origin] ?? {
                getPublicKeyPolicy: site.getPublicKeyPolicy,
                signPolicy: site.signPolicy,
                boundProfileId: site.boundProfileId ?? "",
              };
              const publicKeyStatusLabel =
                draft.getPublicKeyPolicy === "always_allow"
                  ? "Always allow"
                  : draft.getPublicKeyPolicy === "always_reject"
                    ? "Always reject"
                    : "Ask every time";
              const publicKeyStatusColor =
                draft.getPublicKeyPolicy === "always_allow"
                  ? "var(--active-text)"
                  : draft.getPublicKeyPolicy === "always_reject"
                    ? "var(--danger)"
                    : "var(--text-muted)";
              const signingStatusLabel =
                draft.signPolicy === "always_allow"
                  ? "Always allow"
                  : draft.signPolicy === "always_reject"
                    ? "Always reject"
                    : "Ask every time";
              const signingStatusColor =
                draft.signPolicy === "always_allow"
                  ? "var(--active-text)"
                  : draft.signPolicy === "always_reject"
                    ? "var(--danger)"
                    : "var(--text-muted)";
              const siteProfileLabel =
                identities.find((identity) => identity.id === draft.boundProfileId)?.label ?? "Global default";

              return (
                <div
                  key={site.origin}
                  style={{
                    border: "1px solid var(--border-muted)",
                    borderRadius: "8px",
                    padding: "10px",
                    background: "var(--surface-muted)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
                    <div
                      style={{
                        fontFamily: "monospace",
                        fontSize: "12px",
                        color: "var(--text-primary)",
                        wordBreak: "break-all",
                      }}
                    >
                      {site.origin}
                    </div>
                    <span
                      style={{
                        whiteSpace: "nowrap",
                        fontSize: "11px",
                        padding: "3px 8px",
                        borderRadius: "999px",
                        border: "1px solid var(--border-muted)",
                        background: "var(--surface-soft)",
                        color: signingStatusColor,
                        height: "fit-content",
                      }}
                    >
                      {signingStatusLabel}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr",
                      gap: "4px 8px",
                      fontSize: "12px",
                      marginBottom: "10px",
                    }}
                  >
                    <span style={{ color: "var(--text-muted)" }}>Public key:</span>
                    <span style={{ color: publicKeyStatusColor }}>{publicKeyStatusLabel}</span>
                    <span style={{ color: "var(--text-muted)" }}>Sign events:</span>
                    <span style={{ color: signingStatusColor }}>{signingStatusLabel}</span>
                    <span style={{ color: "var(--text-muted)" }}>Site profile:</span>
                    <span style={{ color: "var(--text-primary)" }}>{siteProfileLabel}</span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      Public key access
                      <select
                        value={draft.getPublicKeyPolicy}
                        onChange={(e) =>
                          updateTrustedSiteDraft(site.origin, {
                            getPublicKeyPolicy: e.target.value as TrustedSignPolicyMode,
                          })
                        }
                        style={{
                          width: "100%",
                          marginTop: "4px",
                          padding: "8px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-muted)",
                          background: "var(--surface-elevated)",
                          color: "var(--text-primary)",
                        }}
                      >
                        <option value="ask">Ask every time</option>
                        <option value="always_allow">Always allow</option>
                        <option value="always_reject">Always reject</option>
                      </select>
                    </label>

                    <label style={{ fontSize: "12px", color: "var(--text-muted)", gridColumn: "1 / span 2" }}>
                      Sign events
                      <select
                        value={draft.signPolicy}
                        onChange={(e) =>
                          updateTrustedSiteDraft(site.origin, {
                            signPolicy: e.target.value as TrustedSignPolicyMode,
                          })
                        }
                        style={{
                          width: "100%",
                          marginTop: "4px",
                          padding: "8px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-muted)",
                          background: "var(--surface-elevated)",
                          color: "var(--text-primary)",
                        }}
                      >
                        <option value="ask">Ask every time</option>
                        <option value="always_allow">Always allow</option>
                        <option value="always_reject">Always reject</option>
                      </select>
                    </label>

                    <label style={{ fontSize: "12px", color: "var(--text-muted)", gridColumn: "1 / span 2" }}>
                      Site profile
                      <select
                        value={draft.boundProfileId}
                        onChange={(e) =>
                          updateTrustedSiteDraft(site.origin, {
                            boundProfileId: e.target.value,
                          })
                        }
                        style={{
                          width: "100%",
                          marginTop: "4px",
                          padding: "8px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-muted)",
                          background: "var(--surface-elevated)",
                          color: "var(--text-primary)",
                        }}
                      >
                        <option value="">Use global default profile</option>
                        {identities.map((identity) => (
                          <option key={identity.id} value={identity.id}>
                            {identity.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <button
                      onClick={() => {
                        void handleSaveTrustedWebsite(site.origin);
                      }}
                      style={{
                        flex: 1,
                        padding: "9px 10px",
                        background: "var(--primary-action-bg)",
                        color: "var(--primary-action-text)",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        void handleRemoveTrustedWebsite(site.origin);
                      }}
                      style={{
                        flex: 1,
                        padding: "9px 10px",
                        background: "var(--surface-soft)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border-muted)",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                    >
                      Forget
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "var(--overlay)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{ background: "var(--modal-bg)", color: "var(--modal-text)", padding: "20px", borderRadius: "12px", width: "300px", border: "1px solid var(--border-muted)" }}>
            <h3>Create Identity</h3>
            <input
              type="text"
              placeholder="Name (e.g., Personal)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{ width: "100%", padding: "10px", marginBottom: "12px", borderRadius: "6px", border: "1px solid var(--border-muted)", background: "var(--surface-elevated)", color: "var(--text-primary)" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleCreate}
                style={{ flex: 1, padding: "10px", background: "var(--primary-action-bg)", color: "var(--primary-action-text)", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Create
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewLabel(""); }}
                style={{ flex: 1, padding: "10px", background: "var(--surface-soft)", color: "var(--text-primary)", border: "1px solid var(--border-muted)", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "var(--overlay)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{ background: "var(--modal-bg)", color: "var(--modal-text)", padding: "20px", borderRadius: "12px", width: "300px", border: "1px solid var(--border-muted)" }}>
            <h3>Import Identity</h3>
            <input
              type="text"
              placeholder="Name"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{ width: "100%", padding: "10px", marginBottom: "8px", borderRadius: "6px", border: "1px solid var(--border-muted)", background: "var(--surface-elevated)", color: "var(--text-primary)" }}
            />
            <textarea
              placeholder="Private key (hex or nsec)"
              value={importKey}
              onChange={(e) => setImportKey(e.target.value)}
              style={{ width: "100%", padding: "10px", marginBottom: "12px", borderRadius: "6px", border: "1px solid var(--border-muted)", height: "80px", background: "var(--surface-elevated)", color: "var(--text-primary)" }}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleImport}
                style={{ flex: 1, padding: "10px", background: "var(--primary-action-bg)", color: "var(--primary-action-text)", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Import
              </button>
              <button
                onClick={() => { setShowImport(false); setNewLabel(""); setImportKey(""); }}
                style={{ flex: 1, padding: "10px", background: "var(--surface-soft)", color: "var(--text-primary)", border: "1px solid var(--border-muted)", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingId && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "var(--overlay)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{ background: "var(--modal-bg)", color: "var(--modal-text)", padding: "20px", borderRadius: "12px", width: "300px", border: "1px solid var(--border-muted)" }}>
            <h3>Edit Identity</h3>
            <input
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              style={{ width: "100%", padding: "10px", marginBottom: "12px", borderRadius: "6px", border: "1px solid var(--border-muted)", background: "var(--surface-elevated)", color: "var(--text-primary)" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleEdit}
                style={{ flex: 1, padding: "10px", background: "var(--primary-action-bg)", color: "var(--primary-action-text)", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Save
              </button>
              <button
                onClick={() => { setEditingId(null); setEditLabel(""); }}
                style={{ flex: 1, padding: "10px", background: "var(--surface-soft)", color: "var(--text-primary)", border: "1px solid var(--border-muted)", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deletingId && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "var(--overlay)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{ background: "var(--modal-bg)", color: "var(--modal-text)", padding: "20px", borderRadius: "12px", width: "300px", border: "1px solid var(--border-muted)" }}>
            <h3>Delete Identity?</h3>
            <p style={{ color: "var(--text-muted)", marginBottom: "16px" }}>
              This will permanently delete this identity and its private key.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleDelete}
                style={{ flex: 1, padding: "10px", background: "var(--danger)", color: "var(--primary-action-text)", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Delete
              </button>
              <button
                onClick={() => setDeletingId(null)}
                style={{ flex: 1, padding: "10px", background: "var(--surface-soft)", color: "var(--text-primary)", border: "1px solid var(--border-muted)", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Key Modal */}
      {copyDialog && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "var(--overlay-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{
            background: "var(--modal-bg)",
            color: "var(--modal-text)",
            padding: "24px",
            borderRadius: "12px",
            width: "480px",
            maxWidth: "90vw",
            border: "1px solid var(--border-muted)",
          }}>
            <h3 style={{ marginTop: 0, color: "var(--text-primary)" }}>🔑 {copyDialog.title}</h3>
            {copyDialog.requiresReveal && !copyDialog.revealed ? (
              <>
                {copyDialog.warning && (
                  <div
                    style={{
                      marginBottom: "12px",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid color-mix(in srgb, var(--danger) 50%, transparent)",
                      background: "color-mix(in srgb, var(--danger) 12%, transparent)",
                      color: "var(--danger)",
                      fontSize: "13px",
                      fontWeight: 600,
                    }}
                  >
                    ⚠️ {copyDialog.warning}
                  </div>
                )}
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => {
                      setCopyDialog((prev) => (prev ? { ...prev, revealed: true } : prev));
                    }}
                    style={{
                      flex: 1,
                      padding: "12px",
                      background: "var(--primary-action-bg)",
                      color: "var(--primary-action-text)",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                    }}
                  >
                    Show Private Key
                  </button>
                  <button
                    onClick={() => {
                      setCopyDialog(null);
                    }}
                    style={{
                      flex: 1,
                      padding: "12px",
                      background: "var(--surface-soft)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-muted)",
                      borderRadius: "8px",
                      cursor: "pointer",
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{
                  background: "var(--surface-muted)",
                  padding: "12px",
                  borderRadius: "8px",
                  fontFamily: "monospace",
                  fontSize: "13px",
                  wordBreak: "break-all",
                  maxHeight: "150px",
                  overflow: "auto",
                  marginBottom: "16px",
                  border: "1px solid var(--border-muted)",
                }}>
                  {copyDialog.value}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => {
                      void copyToClipboard(copyDialog.value, copyDialog.copyLabel);
                    }}
                    style={{
                      flex: 1,
                      padding: "12px",
                      background: "var(--success-surface)",
                      color: "var(--primary-action-text)",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                    }}
                  >
                    📋 Copy
                  </button>
                  <button
                    onClick={() => {
                      setCopyDialog(null);
                    }}
                    style={{
                      flex: 1,
                      padding: "12px",
                      background: "var(--surface-soft)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-muted)",
                      borderRadius: "8px",
                      cursor: "pointer",
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
