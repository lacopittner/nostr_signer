import { useCallback, useEffect, useState } from "react";
import { hexToNpub, hexToNsec, type IdentityRecord } from "@nostr-signer/signer-core";
import { vault } from "./lib/vault";
import browser from "webextension-polyfill";

type ThemeMode = "light" | "dark";
const THEME_STORAGE_KEY = "nostr_signer_theme";
const REMEMBER_UNLOCK_KEY = "nostr_signer_remember_unlock";
const SESSION_UNLOCK_KEY = "nostr_signer_session_unlock";
const DEFAULT_UNLOCK_TTL_MS = 15 * 60 * 1000;
const SESSION_UNLOCK_TTL_MS = 365 * 24 * 60 * 60 * 1000;

// Sign Request Confirmation Screen
function SignRequestScreen({
  requestId,
  origin,
  event,
  onComplete,
}: {
  requestId: string;
  origin: string;
  event: any;
  onComplete: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      await browser.runtime.sendMessage({
        type: "APPROVE_REQUEST",
        requestId,
      });
      onComplete();
    } catch (err) {
      alert("Failed to sign: " + (err instanceof Error ? err.message : "Unknown error"));
      setLoading(false);
    }
  };

  const handleReject = async () => {
    await browser.runtime.sendMessage({
      type: "REJECT_REQUEST",
      requestId,
    });
    onComplete();
  };

  return (
    <div style={{ padding: "20px", width: "500px", maxWidth: "100%" }}>
      <h2 style={{ marginBottom: "8px" }}>Sign Request</h2>
      <p style={{ color: "var(--text-muted)", marginBottom: "20px", fontSize: "14px" }}>
        <strong>{origin}</strong> wants to sign a Nostr event
      </p>

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
          <strong>Kind:</strong> {event.kind}
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

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={handleReject}
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
          onClick={handleApprove}
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
          {loading ? "Signing..." : "Approve"}
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
function PinSetupScreen({ onComplete }: { onComplete: () => void }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");

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
    await vault.setPin(pin);
    await vault.unlock(pin);
    onComplete();
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
  const [identities, setIdentities] = useState<IdentityRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // Pending sign request
  const [pendingRequest, setPendingRequest] = useState<{
    id: string;
    origin: string;
    event: any;
  } | null>(null);
  
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
  
  // Form states
  const [newLabel, setNewLabel] = useState("");
  const [importKey, setImportKey] = useState("");
  const [editLabel, setEditLabel] = useState("");

  const refresh = useCallback(async () => {
    const list = await vault.listIdentities();
    const active = await vault.getActiveIdentity();
    setIdentities(list);
    setActiveId(active?.id ?? null);
  }, []);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
  }, []);

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
      try {
        const result = await browser.storage.local.get([THEME_STORAGE_KEY, REMEMBER_UNLOCK_KEY]);
        const storedTheme = result[THEME_STORAGE_KEY];
        if (storedTheme === "light" || storedTheme === "dark") {
          setTheme(storedTheme);
        }
        if (typeof result[REMEMBER_UNLOCK_KEY] === "boolean") {
          rememberPref = result[REMEMBER_UNLOCK_KEY];
        }
        setRememberUnlock(rememberPref);
      } catch {
        // Ignore preference loading errors
      }

      // Check for pending sign request first
      try {
        const session = await browser.storage.session.get([
          "pendingRequestId",
          "pendingOrigin",
          "pendingEvent",
        ]);
        if (session.pendingRequestId) {
          setPendingRequest({
            id: session.pendingRequestId,
            origin: session.pendingOrigin,
            event: session.pendingEvent,
          });
          // Clear from storage
          await browser.storage.session.remove([
            "pendingRequestId",
            "pendingOrigin",
            "pendingEvent",
          ]);
          setIsLoading(false);
          return;
        }
      } catch {
        // Session storage not available
      }

      const pinSet = await vault.isPinSet();
      setHasPin(pinSet);
      
      if (pinSet) {
        let unlocked = await vault.isUnlocked();
        if (unlocked && rememberPref) {
          try {
            const session = await browser.storage.session.get(SESSION_UNLOCK_KEY);
            const sessionAllowed = Boolean(session[SESSION_UNLOCK_KEY]);
            if (!sessionAllowed) {
              await vault.lock();
              unlocked = false;
            }
          } catch {
            await vault.lock();
            unlocked = false;
          }
        }

        setIsLocked(!unlocked);
        if (unlocked) {
          await refresh();
        }
      }
      
      setIsLoading(false);
    };
    void init();
  }, [refresh]);

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

    setRememberUnlock(remember);
    try {
      await browser.storage.local.set({ [REMEMBER_UNLOCK_KEY]: remember });
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
    return true;
  };

  const handleSetupComplete = async () => {
    setHasPin(true);
    setIsLocked(false);
    await refresh();
  };

  const handleLock = async () => {
    await vault.lock();
    try {
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

  const handleActivate = async (id: string) => {
    try {
      await vault.setActiveIdentity(id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to activate");
    }
  };

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

  // Show sign request confirmation first
  if (pendingRequest) {
    return (
      <SignRequestScreen
        requestId={pendingRequest.id}
        origin={pendingRequest.origin}
        event={pendingRequest.event}
        onComplete={() => {
          setPendingRequest(null);
          refresh();
        }}
      />
    );
  }

  if (!hasPin) {
    return <PinSetupScreen onComplete={handleSetupComplete} />;
  }

  if (isLocked) {
    return <PinLockScreen onUnlock={handleUnlock} defaultRemember={rememberUnlock} />;
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
              border: id.id === activeId ? "2px solid var(--accent)" : "1px solid var(--border-muted)",
              background: id.id === activeId ? "var(--card-active-bg)" : "var(--card-bg)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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
                {id.id === activeId ? (
                  <span style={{ color: "var(--active-text)", fontSize: "12px" }}>Active</span>
                ) : (
                  <button
                    onClick={() => handleActivate(id.id)}
                    style={{
                      padding: "6px 10px",
                      background: "transparent",
                      border: "1px solid var(--border-strong)",
                      color: "var(--text-primary)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    Use
                  </button>
                )}

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
