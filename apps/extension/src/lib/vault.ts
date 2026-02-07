import {
  IdentityVault,
  RealSignerAdapter,
  createEmptyVaultState,
  type VaultState,
  type VaultStorage,
} from "@nostr-signer/signer-core";
import browser from "webextension-polyfill";

const STORAGE_KEY = "nostr_signer_vault_v3";

class ChromeVaultStorage implements VaultStorage {
  async load(): Promise<VaultState | null> {
    try {
      const result = await browser.storage.local.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY];
      if (!stored) return null;
      // Never keep masterKey in persisted storage.
      return {
        ...stored,
        masterKey: null,
      };
    } catch {
      return null;
    }
  }

  async save(state: VaultState): Promise<void> {
    // Never save masterKey to storage.
    const safeState = {
      ...state,
      masterKey: null,
    };
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: safeState });
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
