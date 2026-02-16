// lib/vault/export-encrypt.ts

/**
 * Export Encryption for Consent-Based Data Access
 *
 * When user approves a consent request:
 * 1. Data is decrypted with vault key (client-side)
 * 2. A random export key is generated
 * 3. Data is re-encrypted with export key
 * 4. Export key is embedded in consent token
 *
 * This maintains zero-knowledge: server never sees plaintext.
 */
import { base64ToBytes, bytesToBase64 } from "@/lib/vault/base64";

/**
 * Generate a random 256-bit (32-byte) export key
 */
export async function generateExportKey(): Promise<string> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(keyBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Encrypt data with an export key for consent-based access
 */
export async function encryptForExport(
  plaintext: string,
  exportKeyHex: string
): Promise<{
  ciphertext: string;
  iv: string;
  tag: string;
}> {
  // Convert hex key to bytes
  const keyBytes = new Uint8Array(
    exportKeyHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  // Import as AES-GCM key
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );

  // Split ciphertext and tag (last 16 bytes is auth tag)
  const ciphertext = new Uint8Array(encrypted.slice(0, -16));
  const tag = new Uint8Array(encrypted.slice(-16));

  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag),
  };
}

/**
 * Decrypt export-encrypted data (for testing/verification)
 */
export async function decryptExport(
  ciphertext: string,
  iv: string,
  tag: string,
  exportKeyHex: string
): Promise<string> {
  // Convert hex key to bytes
  const keyBytes = new Uint8Array(
    exportKeyHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  // Import as AES-GCM key
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  // Decode base64
  const ciphertextBytes = base64ToBytes(ciphertext);
  const ivBytes = base64ToBytes(iv);
  const tagBytes = base64ToBytes(tag);

  // Combine ciphertext and tag for decryption
  const combined = new Uint8Array(ciphertextBytes.length + tagBytes.length);
  combined.set(ciphertextBytes);
  combined.set(tagBytes, ciphertextBytes.length);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    key,
    combined
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
