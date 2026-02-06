import { useCallback, useEffect, useState } from "react";
import type { IdentityRecord } from "@nostr-signer/signer-core";
import { vault } from "./lib/vault";

function formatNpub(identity: IdentityRecord): string {
  return identity.npub ?? `${identity.pubkey.slice(0, 12)}...${identity.pubkey.slice(-8)}`;
}

export default function App() {
  const [identities, setIdentities] = useState<IdentityRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Ready");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [password, setPassword] = useState("");

  const refresh = useCallback(async () => {
    const list = await vault.listIdentities();
    const active = await vault.getActiveIdentity();
    setIdentities(list);
    setActiveId(active?.id ?? null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    if (!newLabel.trim() || !password) {
      setError("Enter label and password");
      return;
    }
    
    try {
      setError(null);
      await vault.createIdentity(newLabel.trim(), password);
      setStatus(`Created identity: ${newLabel}`);
      setNewLabel("");
      setPassword("");
      setIsCreating(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    }
  };

  const handleActivate = async (id: string) => {
    try {
      await vault.setActiveIdentity(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate");
    }
  };

  const handleUnlock = async (id: string) => {
    const pwd = prompt("Enter password to unlock:");
    if (!pwd) return;
    
    try {
      const success = await vault.unlockIdentity(id, pwd);
      if (success) {
        setStatus("Unlocked successfully");
        await refresh();
      } else {
        setError("Wrong password");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock");
    }
  };

  const handleSign = async () => {
    try {
      const signed = await vault.signEvent({
        kind: 1,
        content: "Test from Nostr Signer",
        tags: [["client", "nostr-signer"]],
      });
      setStatus(`Signed: ${signed.id.slice(0, 16)}...`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign");
    }
  };

  return (
    <div style={{ padding: "20px", maxWidth: "360px", fontFamily: "system-ui" }}>
      <h2 style={{ marginBottom: "16px" }}>Nostr Signer</h2>

      {error && (
        <div style={{ padding: "10px", background: "#fee", color: "#c00", borderRadius: "6px", marginBottom: "12px" }}>
          {error}
        </div>
      )}

      {status && (
        <div style={{ padding: "10px", background: "#efe", color: "#0a0", borderRadius: "6px", marginBottom: "12px" }}>
          {status}
        </div>
      )}

      <div style={{ marginBottom: "16px" }}>
        <button
          onClick={() => setIsCreating(!isCreating)}
          style={{
            padding: "10px 16px",
            background: "#6d4aff",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          {isCreating ? "Cancel" : "+ Create Identity"}
        </button>
      </div>

      {isCreating && (
        <div style={{ marginBottom: "16px", padding: "12px", background: "#f5f5f5", borderRadius: "8px" }}>
          <input
            type="text"
            placeholder="Identity name"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ width: "100%", padding: "8px", marginBottom: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%", padding: "8px", marginBottom: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
          />
          <button
            onClick={handleCreate}
            style={{
              padding: "10px 16px",
              background: "#6d4aff",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              width: "100%",
            }}
          >
            Create
          </button>
        </div>
      )}

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
                <div style={{ fontSize: "12px", color: "#666" }}>{formatNpub(id)}</div>
              </div>
              {id.id === activeId ? (
                <span style={{ color: "#6d4aff", fontSize: "12px" }}>Active</span>
              ) : (
                <button
                  onClick={() => handleActivate(id.id)}
                  style={{
                    padding: "6px 12px",
                    background: "transparent",
                    border: "1px solid #ccc",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                >
                  Activate
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {identities.length > 0 && (
        <button
          onClick={handleSign}
          style={{
            marginTop: "16px",
            padding: "12px 20px",
            background: "#28a745",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            width: "100%",
          }}
        >
          Sign Test Event
        </button>
      )}
    </div>
  );
}
