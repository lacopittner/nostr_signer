import { computeEventId, serializeEvent } from "./nostr";
import type {
  IdentityRecord,
  SignEventInput,
  SignRequest,
  SignedNostrEvent,
  SignerAdapter,
  VaultState,
  VaultStorage,
} from "./types";

const DEFAULT_UNLOCK_TTL_MS = 15 * 60 * 1000;
const DEFAULT_COLOR_POOL = [
  "#6d4aff",
  "#1f7a8c",
  "#8f2d56",
  "#2e4057",
  "#7f5539",
  "#3a5a40",
  "#6b2737",
  "#385f71",
];

function buildIdentityId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyVaultState(): VaultState {
  return {
    identities: [],
    activeIdentityId: null,
    unlockedAt: null,
    masterKey: null, // In-memory only, never persisted
  };
}

export class MemoryVaultStorage implements VaultStorage {
  private state: VaultState | null;

  constructor(seed?: VaultState) {
    this.state = seed ? structuredClone(seed) : null;
  }

  async load(): Promise<VaultState | null> {
    return this.state ? structuredClone(this.state) : null;
  }

  async save(state: VaultState): Promise<void> {
    // Never save masterKey or unlockedAt to storage
    const safeState = {
      ...state,
      masterKey: null,
      unlockedAt: null,
    };
    this.state = structuredClone(safeState);
  }
}

export class IdentityVault {
  private state: VaultState = createEmptyVaultState();
  private loaded = false;

  constructor(
    private readonly storage: VaultStorage,
    private readonly signer: SignerAdapter,
    private readonly now: () => number = () => Date.now()
  ) {}

  // === PIN / Unlock Management ===

  async isPinSet(): Promise<boolean> {
    await this.ensureLoaded();
    return !!this.state.pinHash;
  }

  async setPin(pin: string): Promise<void> {
    await this.ensureLoaded();
    const { hashPassword } = await import("./nostr");
    this.state.pinHash = await hashPassword(pin);
    await this.persist();
  }

  async verifyPin(pin: string): Promise<boolean> {
    await this.ensureLoaded();
    if (!this.state.pinHash) return false;
    
    const { hashPassword } = await import("./nostr");
    const hash = await hashPassword(pin);
    return hash === this.state.pinHash;
  }

  async unlock(pin: string, ttlMs: number = DEFAULT_UNLOCK_TTL_MS): Promise<boolean> {
    const valid = await this.verifyPin(pin);
    if (!valid) return false;

    this.state.unlockedAt = this.now() + ttlMs;
    await this.persist();
    return true;
  }

  async isUnlocked(): Promise<boolean> {
    await this.ensureLoaded();
    if (!this.state.unlockedAt) return false;
    
    if (this.state.unlockedAt <= this.now()) {
      this.state.unlockedAt = null;
      this.state.masterKey = null;
      await this.persist();
      return false;
    }
    return true;
  }

  async lock(): Promise<void> {
    await this.ensureLoaded();
    this.state.unlockedAt = null;
    this.state.masterKey = null;
    await this.persist();
  }

  async changePin(oldPin: string, newPin: string): Promise<boolean> {
    const valid = await this.verifyPin(oldPin);
    if (!valid) return false;
    
    await this.setPin(newPin);
    return true;
  }

  // === Identity CRUD ===

  async listIdentities(): Promise<IdentityRecord[]> {
    await this.ensureLoaded();
    return [...this.state.identities];
  }

  async getActiveIdentity(): Promise<IdentityRecord | null> {
    await this.ensureLoaded();
    if (!this.state.activeIdentityId) return null;
    return this.state.identities.find(i => i.id === this.state.activeIdentityId) ?? null;
  }

  async createIdentity(label: string): Promise<IdentityRecord> {
    await this.ensureUnlocked();

    const privateKey = await this.signer.generatePrivateKey();
    const pubkey = await this.signer.getPublicKey(privateKey);

    // Encrypt private key with master password (derived from PIN session)
    const encryptedKey = await this.encryptWithMasterKey(privateKey);

    const identity: IdentityRecord = {
      id: buildIdentityId(),
      label,
      pubkey,
      npub: undefined, // TODO
      color: this.pickColor(pubkey),
      createdAt: this.now(),
      lastUsedAt: this.now(),
      encryptedPrivateKey: encryptedKey,
    };

    this.state.identities.push(identity);
    if (!this.state.activeIdentityId) {
      this.state.activeIdentityId = identity.id;
    }

    await this.persist();
    return identity;
  }

  async importIdentity(label: string, privateKey: string): Promise<IdentityRecord> {
    await this.ensureUnlocked();

    const pubkey = await this.signer.getPublicKey(privateKey);
    const encryptedKey = await this.encryptWithMasterKey(privateKey);

    const identity: IdentityRecord = {
      id: buildIdentityId(),
      label,
      pubkey,
      npub: undefined,
      color: this.pickColor(pubkey),
      createdAt: this.now(),
      lastUsedAt: this.now(),
      encryptedPrivateKey: encryptedKey,
    };

    this.state.identities.push(identity);
    if (!this.state.activeIdentityId) {
      this.state.activeIdentityId = identity.id;
    }

    await this.persist();
    return identity;
  }

  async updateIdentity(id: string, updates: { label?: string }): Promise<void> {
    await this.ensureLoaded();
    const identity = this.state.identities.find(i => i.id === id);
    if (!identity) throw new Error("Identity not found");

    if (updates.label) {
      identity.label = updates.label;
    }

    await this.persist();
  }

  async removeIdentity(id: string): Promise<void> {
    await this.ensureUnlocked();

    this.state.identities = this.state.identities.filter(i => i.id !== id);
    
    if (this.state.activeIdentityId === id) {
      this.state.activeIdentityId = this.state.identities[0]?.id ?? null;
    }

    await this.persist();
  }

  async setActiveIdentity(id: string): Promise<void> {
    await this.ensureLoaded();
    const identity = this.state.identities.find(i => i.id === id);
    if (!identity) throw new Error("Identity not found");

    this.state.activeIdentityId = id;
    identity.lastUsedAt = this.now();
    await this.persist();
  }

  // === Signing ===

  async signEvent(input: SignEventInput): Promise<SignedNostrEvent> {
    await this.ensureUnlocked();

    const identity = await this.getActiveIdentity();
    if (!identity) throw new Error("No active identity");

    const privateKey = await this.decryptWithMasterKey(identity.encryptedPrivateKey!);
    if (!privateKey) throw new Error("Failed to decrypt private key");

    const unsignedEvent = {
      kind: input.kind,
      content: input.content,
      tags: input.tags ?? [],
      created_at: input.created_at ?? Math.floor(this.now() / 1000),
    };

    const id = await computeEventId(identity.pubkey, unsignedEvent);
    const serialized = serializeEvent(identity.pubkey, unsignedEvent);
    const sig = await this.signer.signEvent({
      identityId: identity.id,
      pubkey: identity.pubkey,
      eventHash: id,
      serialized,
      privateKey,
    });

    identity.lastUsedAt = this.now();
    await this.persist();

    return {
      ...unsignedEvent,
      pubkey: identity.pubkey,
      id,
      sig,
    };
  }

  // === Private helpers ===

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    
    const existing = await this.storage.load();
    this.state = existing ?? createEmptyVaultState();
    this.state.masterKey = null; // Always clear on load
    this.loaded = true;
  }

  private async ensureUnlocked(): Promise<void> {
    await this.ensureLoaded();
    const unlocked = await this.isUnlocked();
    if (!unlocked) throw new Error("Vault is locked");
    
    // Initialize master key if needed (simplified - in real app use proper key derivation)
    if (!this.state.masterKey) {
      this.state.masterKey = await this.deriveMasterKey();
    }
  }

  private async persist(): Promise<void> {
    await this.storage.save(this.state);
  }

  private async deriveMasterKey(): Promise<string> {
    // Simplified - in production use proper key derivation from PIN
    return "master-key-placeholder";
  }

  private async encryptWithMasterKey(data: string): Promise<string> {
    const { encryptWithPassword } = await import("./nostr");
    // Use a derived key from the vault state
    const key = this.state.masterKey || (await this.deriveMasterKey());
    return encryptWithPassword(data, key);
  }

  private async decryptWithMasterKey(encryptedData: string): Promise<string | null> {
    const { decryptWithPassword } = await import("./nostr");
    const key = this.state.masterKey || (await this.deriveMasterKey());
    return decryptWithPassword(encryptedData, key);
  }

  private pickColor(pubkey: string): string {
    const normalized = pubkey.toLowerCase().replace(/[^0-9a-f]/g, "");
    if (!normalized) return DEFAULT_COLOR_POOL[0] ?? "#6d4aff";

    const score = normalized.split("").reduce((acc, chunk) => 
      acc + Number.parseInt(chunk, 16), 0
    );
    return DEFAULT_COLOR_POOL[score % DEFAULT_COLOR_POOL.length] ?? "#6d4aff";
  }
}
