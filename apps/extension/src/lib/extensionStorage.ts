import { createEmptyVaultState, type VaultState, type VaultStorage } from "@nostr-signer/signer-core";
import browser from "webextension-polyfill";

const STORAGE_KEY = "nostrSignerVault";

function safeClone(state: VaultState): VaultState {
  return {
    identities: state.identities,
    masterKey: null, // Never persist masterKey
    encryptedVault: state.encryptedVault,
    activeIdentityId: state.activeIdentityId ?? undefined,
  };
}

export class ExtensionVaultStorage implements VaultStorage {
  async load(): Promise<VaultState | null> {
    try {
      const payload = await browser.storage.local.get(STORAGE_KEY);
      const state = payload[STORAGE_KEY] as VaultState | undefined;
      if (!state) return null;

      // Return state without masterKey for safety
      return safeClone(state);
    } catch {
      return null;
    }
  }

  async save(state: VaultState): Promise<void> {
    try {
      await browser.storage.local.set({
        [STORAGE_KEY]: safeClone(state),
      });
    } catch (error) {
      console.error("Failed to save vault:", error);
    }
  }
}
