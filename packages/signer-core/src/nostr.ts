import type { UnsignedNostrEvent } from "./types";

function ensureCrypto(): Crypto {
  if (typeof globalThis.crypto !== "undefined") {
    return globalThis.crypto;
  }

  throw new Error("Web Crypto API is not available in this runtime");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function serializeEvent(pubkey: string, event: UnsignedNostrEvent): string {
  return JSON.stringify([0, pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export async function computeEventId(pubkey: string, event: UnsignedNostrEvent): Promise<string> {
  const payload = new TextEncoder().encode(serializeEvent(pubkey, event));
  const digest = await ensureCrypto().subtle.digest("SHA-256", payload);
  return bytesToHex(new Uint8Array(digest));
}

export async function hashHex(input: string): Promise<string> {
  const payload = new TextEncoder().encode(input);
  const digest = await ensureCrypto().subtle.digest("SHA-256", payload);
  return bytesToHex(new Uint8Array(digest));
}
