import { useCallback, useEffect, useMemo, useState } from "react";

import type { IdentityRecord, VaultState } from "@nostr-signer/signer-core";

import { vault } from "./lib/vault";

const DEFAULT_SEED: Array<{ label: string; pubkey: string; npub: string }> = [
  {
    label: "Personal",
    pubkey: "5f4dcc3b5aa765d61d8327deb882cf99f13c24b8894d74b7c57f1f5f44d22d11",
    npub: "npub1personaldemo",
  },
  {
    label: "Work",
    pubkey: "8b1a9953c4611296a827abf8c47804d7116f4f3e37af5f58ed5d5e7882d2f78c",
    npub: "npub1workdemo",
  },
];

function randomHex(size: number): string {
  const alphabet = "0123456789abcdef";
  return Array.from({ length: size })
    .map(() => alphabet[Math.floor(Math.random() * alphabet.length)])
    .join("");
}

function formatIdentityMeta(identity: IdentityRecord): string {
  return identity.npub ?? `${identity.pubkey.slice(0, 12)}...${identity.pubkey.slice(-8)}`;
}

function formatLastUsed(timestamp: number): string {
  return new Date(timestamp).toLocaleString("sk-SK", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function App() {
  const [snapshot, setSnapshot] = useState<VaultState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Vault ready");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshVault = useCallback(async () => {
    const state = await vault.getSnapshot();
    setSnapshot(state);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const identities = await vault.listIdentities();
        if (identities.length === 0) {
          for (const seed of DEFAULT_SEED) {
            await vault.addIdentity(seed);
          }
          const afterSeed = await vault.listIdentities();
          const first = afterSeed[0];
          if (first) {
            await vault.unlockIdentity(first.id, 15 * 60 * 1000);
          }
        }

        await refreshVault();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to initialize vault";
        setErrorMessage(message);
      }
    };

    void bootstrap();
  }, [refreshVault]);

  const identities = snapshot?.identities ?? [];

  const sortedIdentities = useMemo(() => {
    return [...identities].sort((a, b) => {
      if (a.id === snapshot?.activeIdentityId) {
        return -1;
      }

      if (b.id === snapshot?.activeIdentityId) {
        return 1;
      }

      return b.lastUsedAt - a.lastUsedAt;
    });
  }, [identities, snapshot?.activeIdentityId]);

  const isUnlocked = useCallback(
    (identityId: string) => {
      const expiry = snapshot?.unlockedSessions[identityId] ?? 0;
      return expiry > Date.now();
    },
    [snapshot?.unlockedSessions],
  );

  const handleSelectIdentity = useCallback(
    async (identityId: string) => {
      try {
        await vault.setActiveIdentity(identityId);
        await refreshVault();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to switch identity";
        setErrorMessage(message);
      }
    },
    [refreshVault],
  );

  const handleAddIdentity = useCallback(async () => {
    try {
      const index = (snapshot?.identities.length ?? 0) + 1;
      await vault.addIdentity({
        label: `Identity ${index}`,
        pubkey: randomHex(64),
        npub: `npub1demo${randomHex(10)}`,
      });
      setStatusMessage("New identity added to vault");
      await refreshVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add identity";
      setErrorMessage(message);
    }
  }, [refreshVault, snapshot?.identities.length]);

  const handleUnlock = useCallback(
    async (identityId: string) => {
      try {
        await vault.unlockIdentity(identityId, 15 * 60 * 1000);
        setStatusMessage("Identity unlocked for 15 minutes");
        await refreshVault();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to unlock identity";
        setErrorMessage(message);
      }
    },
    [refreshVault],
  );

  const handleLock = useCallback(
    async (identityId: string) => {
      try {
        await vault.lockIdentity(identityId);
        setStatusMessage("Identity locked");
        await refreshVault();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to lock identity";
        setErrorMessage(message);
      }
    },
    [refreshVault],
  );

  const handleLockAll = useCallback(async () => {
    try {
      await vault.lockAllIdentities();
      setStatusMessage("All identities locked");
      await refreshVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to lock all identities";
      setErrorMessage(message);
    }
  }, [refreshVault]);

  const handleSign = useCallback(async () => {
    try {
      const signed = await vault.signEvent({
        kind: 1,
        content: "Signed from Nostr Signer vault",
        tags: [["client", "nostr-signer"]],
      });

      setStatusMessage(`Signed event ${signed.id.slice(0, 14)}...`);
      setErrorMessage(null);
      await refreshVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign event";
      setErrorMessage(message);
    }
  }, [refreshVault]);

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Nostr Vault</p>
          <h1>Multi-Identity Signer</h1>
          <p className="hero-copy">Fast switching between personas, session-based unlock, deterministic signing.</p>
        </div>
        <button type="button" className="ghost-button" onClick={() => void handleLockAll()}>
          Lock all
        </button>
      </section>

      <section className="identity-grid" aria-label="Identity list">
        {sortedIdentities.map((identity) => {
          const active = identity.id === snapshot?.activeIdentityId;
          const unlocked = isUnlocked(identity.id);

          return (
            <article className={`identity-card${active ? " active" : ""}`} key={identity.id}>
              <button type="button" className="identity-main" onClick={() => void handleSelectIdentity(identity.id)}>
                <span className="avatar" style={{ backgroundColor: identity.color }} aria-hidden="true">
                  {identity.label[0]?.toUpperCase() ?? "N"}
                </span>
                <span className="identity-content">
                  <strong>{identity.label}</strong>
                  <span>{formatIdentityMeta(identity)}</span>
                  <small>Last used {formatLastUsed(identity.lastUsedAt)}</small>
                </span>
              </button>
              <div className="identity-actions">
                {unlocked ? (
                  <button type="button" className="mini danger" onClick={() => void handleLock(identity.id)}>
                    Lock
                  </button>
                ) : (
                  <button type="button" className="mini" onClick={() => void handleUnlock(identity.id)}>
                    Unlock
                  </button>
                )}
                <span className={`status-pill ${unlocked ? "open" : "locked"}`}>{unlocked ? "Unlocked" : "Locked"}</span>
              </div>
            </article>
          );
        })}
      </section>

      <section className="action-row">
        <button type="button" className="primary-button" onClick={() => void handleSign()}>
          Sign test event
        </button>
        <button type="button" className="secondary-button" onClick={() => void handleAddIdentity()}>
          Add identity
        </button>
      </section>

      <section className="status-card" aria-live="polite">
        <strong>Status</strong>
        <p>{statusMessage}</p>
        {errorMessage ? <p className="error">{errorMessage}</p> : null}
      </section>
    </main>
  );
}
