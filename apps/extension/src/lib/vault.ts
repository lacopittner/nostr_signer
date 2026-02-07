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

function toSafeVaultState(stored: unknown): VaultState | null {
  if (!stored || typeof stored !== "object") return null;
  return {
    ...(stored as VaultState),
    masterKey: null,
  };
}

class ChromeVaultStorage implements VaultStorage {
  async load(): Promise<VaultState | null> {
    try {
      const result = await browser.storage.local.get([STORAGE_KEY, STORAGE_BACKUP_KEY]);
      const primary = toSafeVaultState(result[STORAGE_KEY]);
      if (primary) return primary;

      const backup = toSafeVaultState(result[STORAGE_BACKUP_KEY]);
      if (backup) return backup;
      return null;
    } catch (error) {
      // Never treat a storage read failure as an empty vault.
      throw error instanceof Error ? error : new Error("Failed to load vault storage");
    }
  }

  async save(state: VaultState): Promise<void> {
    // Never save masterKey to storage.
    const safeState = {
      ...state,
      masterKey: null,
    };
    try {
      await browser.storage.local.set({
        [STORAGE_KEY]: safeState,
        [STORAGE_BACKUP_KEY]: safeState,
      });
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
