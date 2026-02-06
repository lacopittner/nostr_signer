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
  // Encrypted private key - only decrypted when identity is unlocked
  encryptedPrivateKey?: string;
}

export interface VaultState {
  identities: IdentityRecord[];
  activeIdentityId: string | null;
  unlockedSessions: Record<string, number>;
  // Map of identityId -> decrypted private key (only in memory, never persisted)
  sessionKeys?: Record<string, string>;
}

export interface NewIdentityInput {
  label: string;
  pubkey: string;
  npub?: string;
  color?: string;
  encryptedPrivateKey: string;
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

export interface CryptoAdapter {
  encrypt(data: string, password: string): Promise<string>;
  decrypt(encryptedData: string, password: string): Promise<string | null>;
  hashPassword(password: string): Promise<string>;
}
