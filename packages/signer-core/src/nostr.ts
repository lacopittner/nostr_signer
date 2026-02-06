import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { bech32 } from "@scure/base";
import type { SignRequest, UnsignedNostrEvent, SignedNostrEvent, SignerAdapter } from "./types";

export function getPublicKey(privateKeyHex: string): string {
  const pubkey = schnorr.getPublicKey(hexToBytes(privateKeyHex));
  return bytesToHex(pubkey);
}

export function generatePrivateKey(): string {
  const privateKey = schnorr.utils.randomPrivateKey();
  return bytesToHex(privateKey);
}

export function hexToNpub(hex: string): string {
  const data = bech32.toWords(hexToBytes(hex));
  return bech32.encode("npub", data, 1000);
}

export function npubToHex(npub: string): string {
  const decoded = bech32.decode(npub as `${string}1${string}`);
  const bytes = bech32.fromWords(decoded.words);
  return bytesToHex(bytes);
}

export function signEvent(privateKeyHex: string, eventHash: string): string {
  const sig = schnorr.sign(eventHash, hexToBytes(privateKeyHex));
  return bytesToHex(sig);
}

export async function computeEventId(
  pubkey: string,
  event: UnsignedNostrEvent
): Promise<string> {
  const serialized = JSON.stringify([
    0,
    pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  const hash = sha256(new TextEncoder().encode(serialized));
  return bytesToHex(hash);
}

export function serializeEvent(pubkey: string, event: UnsignedNostrEvent): string {
  return JSON.stringify([
    0,
    pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

export class RealSignerAdapter implements SignerAdapter {
  async signEvent(request: SignRequest): Promise<string> {
    return signEvent(request.privateKey, request.eventHash);
  }

  async generatePrivateKey(): Promise<string> {
    return generatePrivateKey();
  }

  async getPublicKey(privateKey: string): Promise<string> {
    return getPublicKey(privateKey);
  }
}

// Simple crypto for key encryption (AES-GCM with PBKDF2)
export async function encryptWithPassword(
  data: string,
  password: string
): Promise<string> {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    dataBytes
  );
  
  const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  result.set(salt);
  result.set(iv, salt.length);
  result.set(new Uint8Array(encrypted), salt.length + iv.length);
  
  return btoa(String.fromCharCode(...result));
}

export async function decryptWithPassword(
  encryptedData: string,
  password: string
): Promise<string | null> {
  try {
    const data = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));
    
    const salt = data.slice(0, 16);
    const iv = data.slice(16, 28);
    const ciphertext = data.slice(28);
    
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );
    
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash));
}
