import { computeEventId, hashHex, serializeEvent } from "./nostr";
import type {
  IdentityRecord,
  NewIdentityInput,
  SignEventInput,
  SignRequest,
  SignedNostrEvent,
  SignerAdapter,
  VaultState,
  VaultStorage,
} from "./types";

const DEFAULT_UNLOCK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_COLOR_POOL = [
  "#1f7a8c",
  "#8f2d56",
  "#2e4057",
  "#7f5539",
  "#3a5a40",
  "#6b2737",
  "#385f71",
  "#5a189a",
];

function buildIdentityId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `id-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyVaultState(): VaultState {
  return {
    identities: [],
    activeIdentityId: null,
    unlockedSessions: {},
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
    this.state = structuredClone(state);
  }
}

export class DemoSignerAdapter implements SignerAdapter {
  async signEvent(request: SignRequest): Promise<string> {
    return hashHex(`${request.identityId}:${request.eventHash}`);
  }
}

export class IdentityVault {
  private state: VaultState = createEmptyVaultState();
  private loaded = false;

  constructor(
    private readonly storage: VaultStorage,
    private readonly signer: SignerAdapter,
    private readonly now: () => number = () => Date.now(),
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

    return this.state.identities.find((identity) => identity.id === this.state.activeIdentityId) ?? null;
  }

  async addIdentity(input: NewIdentityInput): Promise<IdentityRecord> {
    await this.ensureLoaded();

    const timestamp = this.now();
    const identity: IdentityRecord = {
      id: buildIdentityId(),
      label: input.label,
      pubkey: input.pubkey,
      npub: input.npub,
      color: input.color ?? this.pickColor(input.pubkey),
      createdAt: timestamp,
      lastUsedAt: timestamp,
    };

    this.state.identities.push(identity);

    if (!this.state.activeIdentityId) {
      this.state.activeIdentityId = identity.id;
    }

    await this.persist();
    return identity;
  }

  async removeIdentity(identityId: string): Promise<void> {
    await this.ensureLoaded();

    this.state.identities = this.state.identities.filter((identity) => identity.id !== identityId);
    delete this.state.unlockedSessions[identityId];

    if (this.state.activeIdentityId === identityId) {
      this.state.activeIdentityId = this.state.identities[0]?.id ?? null;
    }

    await this.persist();
  }

  async setActiveIdentity(identityId: string): Promise<void> {
    await this.ensureLoaded();

    const identity = this.state.identities.find((entry) => entry.id === identityId);
    if (!identity) {
      throw new Error("Identity not found");
    }

    this.state.activeIdentityId = identityId;
    identity.lastUsedAt = this.now();
    await this.persist();
  }

  async unlockIdentity(identityId: string, ttlMs: number = DEFAULT_UNLOCK_TTL_MS): Promise<void> {
    await this.ensureLoaded();
    this.assertIdentity(identityId);

    this.state.unlockedSessions[identityId] = this.now() + ttlMs;
    await this.persist();
  }

  async lockIdentity(identityId: string): Promise<void> {
    await this.ensureLoaded();

    delete this.state.unlockedSessions[identityId];
    await this.persist();
  }

  async lockAllIdentities(): Promise<void> {
    await this.ensureLoaded();

    this.state.unlockedSessions = {};
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
      throw new Error(`Identity \"${identity.label}\" is locked`);
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
    return structuredClone(this.state);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    const existing = await this.storage.load();
    this.state = existing ?? createEmptyVaultState();
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.save(this.state);
  }

  private async resolveIdentity(identityId?: string): Promise<IdentityRecord> {
    const selected = identityId ?? this.state.activeIdentityId;

    if (!selected) {
      throw new Error("No active identity selected");
    }

    const identity = this.state.identities.find((entry) => entry.id === selected);
    if (!identity) {
      throw new Error("Identity not found");
    }

    return identity;
  }

  private assertIdentity(identityId: string): void {
    const exists = this.state.identities.some((entry) => entry.id === identityId);
    if (!exists) {
      throw new Error("Identity not found");
    }
  }

  private pickColor(pubkey: string): string {
    const normalized = pubkey.toLowerCase().replace(/[^0-9a-f]/g, "");
    if (!normalized) {
      return DEFAULT_COLOR_POOL[0] ?? "#205d8f";
    }

    const score = normalized
      .split("")
      .reduce((acc, chunk) => acc + Number.parseInt(chunk, 16), 0);

    const selected = DEFAULT_COLOR_POOL[score % DEFAULT_COLOR_POOL.length];
    return selected ?? "#205d8f";
  }
}
