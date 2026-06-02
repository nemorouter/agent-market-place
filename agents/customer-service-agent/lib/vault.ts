// lib/vault.ts — the AGENT-INFRA-ONLY credential vault (envelope encryption).
//
// Tool credentials (the customer's OWN secrets — a Slack token, an API key) are
// sealed with AES-256-GCM using a key that lives ONLY in THIS agent's environment
// (TOOL_VAULT_KEY). The sealed blob is stored in the agent's OWN Supabase; nemo-
// backend never holds the key or the ciphertext. Only this agent process can open
// a secret — a DB compromise alone (or another agent) cannot. At tool-execution
// time the agent opens the secret and passes the plaintext to the gateway for ONE
// transient call; the gateway uses it and never stores it.
//
//   TOOL_VAULT_KEY = base64 of 32 random bytes (generate with `generateKey()`).
//   Rotating it re-keys the agent: re-enter the credentials in /admin.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** A sealed secret. All fields base64. Safe to store at rest (in the agent's DB). */
export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
}

const ALGO = 'aes-256-gcm';

function getKey(): Buffer | null {
  const k = process.env.TOOL_VAULT_KEY;
  if (!k) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(k, 'base64');
  } catch {
    return null;
  }
  return buf.length === 32 ? buf : null;
}

/** True when a valid 32-byte TOOL_VAULT_KEY is configured for this agent. */
export function vaultConfigured(): boolean {
  return getKey() !== null;
}

function requireKey(): Buffer {
  const key = getKey();
  if (!process.env.TOOL_VAULT_KEY) throw new Error('TOOL_VAULT_KEY is not set — the credential vault is disabled.');
  if (!key) throw new Error('TOOL_VAULT_KEY must be base64 of exactly 32 bytes.');
  return key;
}

/** Seal a plaintext secret. Fresh random IV each call (semantic security). */
export function seal(plaintext: string): Sealed {
  const key = requireKey();
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ct.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64') };
}

/** Open a sealed secret. Throws if the key is wrong or the blob was tampered (GCM). */
export function open(sealed: Sealed): string {
  const key = requireKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

/** Generate a fresh TOOL_VAULT_KEY (base64 of 32 bytes). For setup/rotation. */
export function generateKey(): string {
  return randomBytes(32).toString('base64');
}
