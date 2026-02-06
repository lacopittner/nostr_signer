import { useCallback, useEffect, useState } from "react";
import type { IdentityRecord } from "@nostr-signer/signer-core";
import { vault } from "./lib/vault";

// PIN Lock Screen
function PinLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await vault.unlock(pin);
    if (success) {
      onUnlock();
    } else {
      setError("Invalid PIN");
      setPin("");
    }
  };

  return (
    <div style={{ padding: "40px 20px", textAlign: "center" }}>
      <div style={{ fontSize: "48px", marginBottom: "20px" }}>🔒</div>
      <h2>Enter PIN</h2>
      <p style={{ color: "#666", marginBottom: "20px" }}>Unlock Nostr Signer</p>
      
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
            border: "1px solid #ddd",
            marginBottom: "12px",
          }}
        />
        {error && (
          <p style={{ color: "#c00", marginBottom: "12px" }}>{error}</p>
        )}
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "12px",
            background: "#6d4aff",
            color: "white",
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
    <div style={{ padding: "40px 20px", textAlign: "center" }}>
      <div style={{ fontSize: "48px", marginBottom: "20px" }}>🔐</div>
      <h2>{step === 1 ? "Create PIN" : "Confirm PIN"}</h2>
      <p style={{ color: "#666", marginBottom: "20px" }}>
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
              border: "1px solid #ddd",
              marginBottom: "12px",
            }}
          />
          {error && <p style={{ color: "#c00", marginBottom: "12px" }}>{error}</p>}
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "12px",
              background: "#6d4aff",
              color: "white",
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
              border: "1px solid #ddd",
              marginBottom: "12px",
            }}
          />
          {error && <p style={{ color: "#c00", marginBottom: "12px" }}>{error}</p>}
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "12px",
              background: "#6d4aff",
              color: "white",
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
              color: "#666",
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
  const [identities, setIdentities] = useState<IdentityRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
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

  useEffect(() => {
    const init = async () => {
      const pinSet = await vault.isPinSet();
      setHasPin(pinSet);
      
      if (pinSet) {
        const unlocked = await vault.isUnlocked();
        setIsLocked(!unlocked);
        if (unlocked) {
          await refresh();
        }
      }
      
      setIsLoading(false);
    };
    void init();
  }, [refresh]);

  const handleUnlock = async () => {
    setIsLocked(false);
    await refresh();
  };

  const handleSetupComplete = async () => {
    setHasPin(true);
    setIsLocked(false);
    await refresh();
  };

  const handleLock = async () => {
    await vault.lock();
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

  if (!hasPin) {
    return <PinSetupScreen onComplete={handleSetupComplete} />;
  }

  if (isLocked) {
    return <PinLockScreen onUnlock={handleUnlock} />;
  }

  return (
    <div style={{ padding: "20px", maxWidth: "360px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2>Nostr Signer</h2>
        <button
          onClick={handleLock}
          style={{
            padding: "8px 16px",
            background: "#f0f0f0",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          🔒 Lock
        </button>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            flex: 1,
            padding: "10px",
            background: "#6d4aff",
            color: "white",
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
            background: "#fff",
            color: "#6d4aff",
            border: "1px solid #6d4aff",
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
              border: id.id === activeId ? "2px solid #6d4aff" : "1px solid #ddd",
              background: id.id === activeId ? "#f0ebff" : "white",
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
                <div style={{ fontSize: "11px", color: "#666", fontFamily: "monospace" }}>
                  {id.pubkey.slice(0, 16)}...{id.pubkey.slice(-8)}
                </div>
              </div>
              
              <div style={{ display: "flex", gap: "4px" }}>
                {id.id === activeId ? (
                  <span style={{ color: "#6d4aff", fontSize: "12px" }}>Active</span>
                ) : (
                  <button
                    onClick={() => handleActivate(id.id)}
                    style={{
                      padding: "6px 10px",
                      background: "transparent",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    Use
                  </button>
                )}
                
                <button
                  onClick={() => {
                    setEditingId(id.id);
                    setEditLabel(id.label);
                  }}
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
        <p style={{ textAlign: "center", color: "#999", padding: "40px" }}>
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
            background: "#28a745",
            color: "white",
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
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{ background: "white", padding: "20px", borderRadius: "12px", width: "300px" }}>
            <h3>Create Identity</h3>
            <input
              type="text"
              placeholder="Name (e.g., Personal)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{ width: "100%", padding: "10px", marginBottom: "12px", borderRadius: "6px", border: "1px solid #ddd" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => { setShowCreate(false); setNewLabel(""); }}
                style={{ flex: 1, padding: "10px", background: "#f0f0f0", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                style={{ flex: 1, padding: "10px", background: "#6d4aff", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Create
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
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{ background: "white", padding: "20px", borderRadius: "12px", width: "300px" }}>
            <h3>Import Identity</h3>
            <input
              type="text"
              placeholder="Name"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{ width: "100%", padding: "10px", marginBottom: "8px", borderRadius: "6px", border: "1px solid #ddd" }}
            />
            <textarea
              placeholder="Private key (hex or nsec)"
              value={importKey}
              onChange={(e) => setImportKey(e.target.value)}
              style={{ width: "100%", padding: "10px", marginBottom: "12px", borderRadius: "6px", border: "1px solid #ddd", height: "80px" }}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => { setShowImport(false); setNewLabel(""); setImportKey(""); }}
                style={{ flex: 1, padding: "10px", background: "#f0f0f0", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                style={{ flex: 1, padding: "10px", background: "#6d4aff", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Import
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
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{ background: "white", padding: "20px", borderRadius: "12px", width: "300px" }}>
            <h3>Edit Identity</h3>
            <input
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              style={{ width: "100%", padding: "10px", marginBottom: "12px", borderRadius: "6px", border: "1px solid #ddd" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => { setEditingId(null); setEditLabel(""); }}
                style={{ flex: 1, padding: "10px", background: "#f0f0f0", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleEdit}
                style={{ flex: 1, padding: "10px", background: "#6d4aff", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Save
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
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{ background: "white", padding: "20px", borderRadius: "12px", width: "300px" }}>
            <h3>Delete Identity?</h3>
            <p style={{ color: "#666", marginBottom: "16px" }}>
              This will permanently delete this identity and its private key.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setDeletingId(null)}
                style={{ flex: 1, padding: "10px", background: "#f0f0f0", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                style={{ flex: 1, padding: "10px", background: "#dc3545", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
