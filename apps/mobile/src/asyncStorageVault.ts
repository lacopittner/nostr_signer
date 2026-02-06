import AsyncStorage from "@react-native-async-storage/async-storage";

import { createEmptyVaultState, type VaultState, type VaultStorage } from "@nostr-signer/signer-core";

const STORAGE_KEY = "nostrSignerVault";

export class AsyncStorageVault implements VaultStorage {
  async load(): Promise<VaultState | null> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as VaultState;
    } catch {
      return createEmptyVaultState();
    }
  }

  async save(state: VaultState): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
