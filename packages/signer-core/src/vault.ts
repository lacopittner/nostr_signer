import { computeEventId, serializeEvent } from "./nostr";
import type {
  IdentityRecord,
  NewIdentityInput,
  SignEventInput,
  SignRequest,
  SignedNostrEvent,
  SignerAdapter,
  VaultState,
  VaultStorage,
  CryptoAdapter,
} from "./types";

const DEFAULT_UNLOCK_TTL_MS = 5 * 60 * 1000;
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
    unlockedSessions: {},
    sessionKeys: {},
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
    // Never save session keys to storage!
    const stateToSave = {
      ...state,
      sessionKeys: {},
    };
    this.state = structuredClone(stateToSave);
  }
}

export class IdentityVault {
  private state: VaultState = createEmptyVaultState();
  private loaded = false;

  constructor(
    private readonly storage: VaultStorage,
    private readonly signer: SignerAdapter,
    private readonly crypto: CryptoAdapter,
    private readonly now: () => number = () => Date.now()
  ) {}

  async listIdentities(): Promise<IdentityRecord[]> {
    await this.ensureLoaded();
    return [...this.state.identities];
  }

  async getActiveIdentity(): Promise<IdentityRecord | null> {
    await this.ensureLoaded();

    if (!this.state.activeIdentityId) {
      return null;
    }

    return (
      this.state.identities.find(
        (identity) => identity.id === this.state.activeIdentityId
      ) ?? null
    );
  }

  async createIdentity(
    label: string,
    password: string
  ): Promise<{ identity: IdentityRecord; mnemonic?: string }> {
    await this.ensureLoaded();

    // Generate new keypair
    const privateKey = await this.signer.generatePrivateKey();
    const pubkey = await this.signer.getPublicKey(privateKey);

    // Encrypt private key with password
    const encryptedPrivateKey = await this.crypto.encrypt(privateKey, password);

    const timestamp = this.now();
    const identity: IdentityRecord = {
      id: buildIdentityId(),
      label,
      pubkey,
      npub: undefined, // TODO: convert to npub
      color: this.pickColor(pubkey),
      createdAt: timestamp,
      lastUsedAt: timestamp,
      encryptedPrivateKey,
    };

    this.state.identities.push(identity);

    if (!this.state.activeIdentityId) {
      this.state.activeIdentityId = identity.id;
    }

    // Auto-unlock this identity
    await this.unlockIdentity(identity.id, password);

    await this.persist();
    return { identity };
  }

  async importIdentity(
    label: string,
    privateKey: string,
    password: string
  ): Promise<IdentityRecord> {
    await this.ensureLoaded();

    const pubkey = await this.signer.getPublicKey(privateKey);
    const encryptedPrivateKey = await this.crypto.encrypt(privateKey, password);

    const timestamp = this.now();
    const identity: IdentityRecord = {
      id: buildIdentityId(),
      label,
      pubkey,
      npub: undefined,
      color: this.pickColor(pubkey),
      createdAt: timestamp,
      lastUsedAt: timestamp,
      encryptedPrivateKey,
    };

    this.state.identities.push(identity);

    if (!this.state.activeIdentityId) {
      this.state.activeIdentityId = identity.id;
    }

    await this.unlockIdentity(identity.id, password);
    await this.persist();

    return identity;
  }

  async removeIdentity(identityId: string): Promise<void> {
    await this.ensureLoaded();

    this.state.identities = this.state.identities.filter(
      (identity) => identity.id !== identityId
    );
    delete this.state.unlockedSessions[identityId];
    delete this.state.sessionKeys?.[identityId];

    if (this.state.activeIdentityId === identityId) {
      this.state.activeIdentityId = this.state.identities[0]?.id ?? null;
    }

    await this.persist();
  }

  async setActiveIdentity(identityId: string): Promise<void> {
    await this.ensureLoaded();

    const identity = this.state.identities.find(
      (entry) => entry.id === identityId
    );
    if (!identity) {
      throw new Error("Identity not found");
    }

    this.state.activeIdentityId = identityId;
    identity.lastUsedAt = this.now();
    await this.persist();
  }

  async unlockIdentity(
    identityId: string,
    password: string,
    ttlMs: number = DEFAULT_UNLOCK_TTL_MS
  ): Promise<boolean> {
    await this.ensureLoaded();

    const identity = this.state.identities.find((i) => i.id === identityId);
    if (!identity || !identity.encryptedPrivateKey) {
      return false;
    }

    // Try to decrypt the private key
    const privateKey = await this.crypto.decrypt(
      identity.encryptedPrivateKey,
      password
    );

    if (!privateKey) {
      return false;
    }

    // Store in session (memory only)
    if (!this.state.sessionKeys) {
      this.state.sessionKeys = {};
    }
    this.state.sessionKeys[identityId] = privateKey;
    this.state.unlockedSessions[identityId] = this.now() + ttlMs;

    await this.persist();
    return true;
  }

  async lockIdentity(identityId: string): Promise<void> {
    await this.ensureLoaded();

    delete this.state.unlockedSessions[identityId];
    delete this.state.sessionKeys?.[identityId];
    await this.persist();
  }

  async lockAllIdentities(): Promise<void> {
    await this.ensureLoaded();

    this.state.unlockedSessions = {};
    this.state.sessionKeys = {};
    await this.persist();
  }

  async isUnlocked(identityId: string): Promise<boolean> {
    await this.ensureLoaded();

    const expiry = this.state.unlockedSessions[identityId];
    if (!expiry) {
      return false;
    }

    if (expiry <= this.now()) {
      delete this.state.unlockedSessions[identityId];
      delete this.state.sessionKeys?.[identityId];
      await this.persist();
      return false;
    }

    return true;
  }

  async signEvent(input: SignEventInput): Promise<SignedNostrEvent> {
    await this.ensureLoaded();

    const identity = await this.resolveIdentity(input.identityId);
    const unlocked = await this.isUnlocked(identity.id);
    if (!unlocked) {
      throw new Error(`Identity "${identity.label}" is locked`);
    }

    const privateKey = this.state.sessionKeys?.[identity.id];
    if (!privateKey) {
      throw new Error(`Private key not available for "${identity.label}"`);
    }

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

  async getSnapshot(): Promise<VaultState> {
    await this.ensureLoaded();
    // Return without session keys for security
    return {
      ...this.state,
      sessionKeys: {},
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    const existing = await this.storage.load();
    this.state = existing ?? createEmptyVaultState();
    // Always clear session keys on load
    this.state.sessionKeys = {};
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.save(this.state);
  }

  private async resolveIdentity(
    identityId?: string
  ): Promise<IdentityRecord> {
    const selected = identityId ?? this.state.activeIdentityId;

    if (!selected) {
      throw new Error("No active identity selected");
    }

    const identity = this.state.identities.find(
      (entry) => entry.id === selected
    );
    if (!identity) {
      throw new Error("Identity not found");
    }

    return identity;
  }

  private pickColor(pubkey: string): string {
    const normalized = pubkey.toLowerCase().replace(/[^0-9a-f]/g, "");
    if (!normalized) {
      return DEFAULT_COLOR_POOL[0] ?? "#6d4aff";
    }

    const score = normalized
      .split("")
      .reduce((acc, chunk) => acc + Number.parseInt(chunk, 16), 0);

    const selected = DEFAULT_COLOR_POOL[score % DEFAULT_COLOR_POOL.length];
    return selected ?? "#6d4aff";
  }
}
