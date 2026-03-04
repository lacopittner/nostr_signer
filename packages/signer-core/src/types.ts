export type NostrTag = string[];

export interface UnsignedNostrEvent {
  kind: number;
  content: string;
  tags: NostrTag[];
  created_at: number;
}

export interface SignedNostrEvent extends UnsignedNostrEvent {
  pubkey: string;
  id: string;
  sig: string;
}

export interface IdentityRecord {
  id: string;
  label: string;
  pubkey: string;
  npub?: string;
  color: string;
  createdAt: number;
  lastUsedAt: number;
  encryptedPrivateKey?: string;
}

export interface VaultState {
  identities: IdentityRecord[];
  activeIdentityId: string | null;
  // Global PIN hash
  pinHash?: string;
  // Salt for PIN-based key derivation
  pinSalt?: string;
  // Session state (never persisted)
  unlockedAt: number | null;
  masterKey: string | null;
}

export interface SignEventInput {
  identityId?: string;
  kind: number;
  content: string;
  tags?: NostrTag[];
  created_at?: number;
}

export interface SignRequest {
  identityId: string;
  pubkey: string;
  eventHash: string;
  serialized: string;
  privateKey: string;
}

export interface SignerAdapter {
  signEvent(request: SignRequest): Promise<string>;
  generatePrivateKey(): Promise<string>;
  getPublicKey(privateKey: string): Promise<string>;
}

export interface VaultStorage {
  load(): Promise<VaultState | null>;
  save(state: VaultState): Promise<void>;
}
