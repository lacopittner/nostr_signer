import {
  IdentityVault,
  RealSignerAdapter,
  type CryptoAdapter,
} from "@nostr-signer/signer-core";
import {
  encryptPrivateKey,
  decryptPrivateKey,
  hashPassword,
} from "@nostr-signer/signer-core";
import browser from "webextension-polyfill";
import type { VaultState, VaultStorage } from "@nostr-signer/signer-core";

const STORAGE_KEY = "nostr_signer_vault_v2";

class ChromeVaultStorage implements VaultStorage {
  async load(): Promise<VaultState | null> {
    try {
      const result = await browser.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] ?? null;
    } catch {
      return null;
    }
  }

  async save(state: VaultState): Promise<void> {
    // Never save session keys to storage!
    const safeState = {
      ...state,
      sessionKeys: {},
    };
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: safeState });
    } catch (error) {
      console.error("Failed to save vault:", error);
    }
  }
}

class WebCryptoAdapter implements CryptoAdapter {
  async encrypt(data: string, password: string): Promise<string> {
    return encryptPrivateKey(data, password);
  }

  async decrypt(encryptedData: string, password: string): Promise<string | null> {
    return decryptPrivateKey(encryptedData, password);
  }

  async hashPassword(password: string): Promise<string> {
    return hashPassword(password);
  }
}

// Create singleton vault instance
export const vault = new IdentityVault(
  new ChromeVaultStorage(),
  new RealSignerAdapter(),
  new WebCryptoAdapter()
);
