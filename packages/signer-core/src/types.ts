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
}

export interface VaultState {
  identities: IdentityRecord[];
  activeIdentityId: string | null;
  unlockedSessions: Record<string, number>;
}

export interface NewIdentityInput {
  label: string;
  pubkey: string;
  npub?: string;
  color?: string;
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
}

export interface SignerAdapter {
  signEvent(request: SignRequest): Promise<string>;
}

export interface VaultStorage {
  load(): Promise<VaultState | null>;
  save(state: VaultState): Promise<void>;
}
