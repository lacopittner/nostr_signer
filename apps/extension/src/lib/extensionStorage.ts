import { createEmptyVaultState, type VaultState, type VaultStorage } from "@nostr-signer/signer-core";
import browser from "webextension-polyfill";

const STORAGE_KEY = "nostrSignerVault";

function safeClone(state: VaultState): VaultState {
  return structuredClone(state);
}

export class ExtensionVaultStorage implements VaultStorage {
  async load(): Promise<VaultState | null> {
    const fromExtensionApi = await this.loadFromExtensionStorage();
    if (fromExtensionApi) {
      return fromExtensionApi;
    }

    if (typeof localStorage === "undefined") {
      return null;
    }

    const payload = localStorage.getItem(STORAGE_KEY);
    if (!payload) {
      return null;
    }

    try {
      const decoded = JSON.parse(payload) as VaultState;
      return safeClone(decoded);
    } catch {
      return createEmptyVaultState();
    }
  }

  async save(state: VaultState): Promise<void> {
    await this.saveToExtensionStorage(state);

    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }

  private async loadFromExtensionStorage(): Promise<VaultState | null> {
    try {
      const payload = await browser.storage.local.get(STORAGE_KEY);
      return (payload[STORAGE_KEY] as VaultState | undefined) ?? null;
    } catch {
      return null;
    }
  }

  private async saveToExtensionStorage(state: VaultState): Promise<void> {
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: safeClone(state) });
    } catch {
      // Popup sandbox can block storage API in local previews.
    }
  }
}
