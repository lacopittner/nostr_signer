import {
  IdentityVault,
  RealSignerAdapter,
  createEmptyVaultState,
  type VaultState,
  type VaultStorage,
} from "@nostr-signer/signer-core";
import browser from "webextension-polyfill";

const STORAGE_KEY = "nostr_signer_vault_v3";
const STORAGE_BACKUP_KEY = "nostr_signer_vault_v3_backup";
const SESSION_STATE_KEY = "nostr_signer_vault_v3_session_state";

interface VaultSessionState {
  unlockedAt: number | null;
  masterKey: string | null;
}

function toSafeVaultState(stored: unknown): VaultState | null {
  if (!stored || typeof stored !== "object") return null;
  return {
    ...(stored as VaultState),
    unlockedAt: null,
    masterKey: null,
  };
}

function toSessionState(stored: unknown): VaultSessionState {
  if (!stored || typeof stored !== "object") {
    return { unlockedAt: null, masterKey: null };
  }

  const value = stored as Record<string, unknown>;
  const unlockedAt = typeof value.unlockedAt === "number" ? value.unlockedAt : null;
  const masterKey = typeof value.masterKey === "string" && value.masterKey.length > 0
    ? value.masterKey
    : null;

  return { unlockedAt, masterKey };
}

class ChromeVaultStorage implements VaultStorage {
  async load(): Promise<VaultState | null> {
    try {
      const [result, sessionResult] = await Promise.all([
        browser.storage.local.get([STORAGE_KEY, STORAGE_BACKUP_KEY]),
        browser.storage.session.get(SESSION_STATE_KEY),
      ]);
      const primary = toSafeVaultState(result[STORAGE_KEY]);
      const sessionState = toSessionState(sessionResult[SESSION_STATE_KEY]);
      if (primary) {
        return {
          ...primary,
          unlockedAt: sessionState.unlockedAt,
          masterKey: sessionState.masterKey,
        };
      }

      const backup = toSafeVaultState(result[STORAGE_BACKUP_KEY]);
      if (backup) {
        return {
          ...backup,
          unlockedAt: sessionState.unlockedAt,
          masterKey: sessionState.masterKey,
        };
      }
      return null;
    } catch (error) {
      // Never treat a storage read failure as an empty vault.
      throw error instanceof Error ? error : new Error("Failed to load vault storage");
    }
  }

  async save(state: VaultState): Promise<void> {
    // Never save session-only unlock state to storage.
    const safeState = {
      ...state,
      unlockedAt: null,
      masterKey: null,
    };

    const sessionState: VaultSessionState = {
      unlockedAt: state.unlockedAt,
      masterKey: state.masterKey,
    };

    try {
      const ops: Array<Promise<unknown>> = [
        browser.storage.local.set({
          [STORAGE_KEY]: safeState,
          [STORAGE_BACKUP_KEY]: safeState,
        }),
      ];

      if (sessionState.unlockedAt && sessionState.masterKey) {
        ops.push(browser.storage.session.set({ [SESSION_STATE_KEY]: sessionState }));
      } else {
        ops.push(browser.storage.session.remove(SESSION_STATE_KEY));
      }

      await Promise.all(ops);
    } catch (error) {
      console.error("Failed to save vault:", error);
    }
  }
}

// Create singleton vault instance
export const vault = new IdentityVault(
  new ChromeVaultStorage(),
  new RealSignerAdapter()
);
