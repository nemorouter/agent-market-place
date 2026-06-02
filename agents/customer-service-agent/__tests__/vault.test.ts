import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { seal, open, vaultConfigured, generateKey, type Sealed } from '../lib/vault';

// A valid 32-byte key, base64 — the shape TOOL_VAULT_KEY must take.
const KEY = randomBytes(32).toString('base64');

beforeEach(() => {
  process.env.TOOL_VAULT_KEY = KEY;
});
afterEach(() => {
  delete process.env.TOOL_VAULT_KEY;
});

describe('vault — AES-256-GCM, agent-infra-only key', () => {
  it('round-trips a secret (seal → open)', () => {
    const secret = 'xoxb-acme-slack-1234567890';
    const sealed = seal(secret);
    expect(open(sealed)).toBe(secret);
  });

  it('produces ciphertext that does NOT contain the plaintext', () => {
    const sealed = seal('super-secret-token');
    const blob = JSON.stringify(sealed);
    expect(blob).not.toContain('super-secret-token');
    // iv + tag + ciphertext are all present and base64
    expect(sealed.iv).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(sealed.tag).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(sealed.ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('uses a fresh IV each time (same plaintext → different ciphertext)', () => {
    const a = seal('same');
    const b = seal('same');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects tampered ciphertext (GCM auth tag fails)', () => {
    const sealed = seal('do-not-tamper');
    const flipped = Buffer.from(sealed.ciphertext, 'base64');
    flipped[0] ^= 0xff;
    const bad: Sealed = { ...sealed, ciphertext: flipped.toString('base64') };
    expect(() => open(bad)).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const sealed = seal('do-not-tamper');
    const flipped = Buffer.from(sealed.tag, 'base64');
    flipped[0] ^= 0xff;
    expect(() => open({ ...sealed, tag: flipped.toString('base64') })).toThrow();
  });

  it('cannot be opened with a DIFFERENT key (no cross-agent decrypt)', () => {
    const sealed = seal('agent-a-secret');
    process.env.TOOL_VAULT_KEY = randomBytes(32).toString('base64'); // another agent's key
    expect(() => open(sealed)).toThrow();
  });

  it('throws when the key is missing or wrong length', () => {
    delete process.env.TOOL_VAULT_KEY;
    expect(vaultConfigured()).toBe(false);
    expect(() => seal('x')).toThrow(/TOOL_VAULT_KEY/);
    process.env.TOOL_VAULT_KEY = Buffer.from('too-short').toString('base64');
    expect(vaultConfigured()).toBe(false);
    expect(() => seal('x')).toThrow(/32 bytes/);
  });

  it('vaultConfigured() is true with a valid key', () => {
    expect(vaultConfigured()).toBe(true);
  });

  it('generateKey() returns a valid 32-byte base64 key usable by seal/open', () => {
    const k = generateKey();
    process.env.TOOL_VAULT_KEY = k;
    expect(vaultConfigured()).toBe(true);
    expect(open(seal('hi'))).toBe('hi');
  });
});
