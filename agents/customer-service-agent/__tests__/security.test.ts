import { describe, it, expect } from 'vitest';
import {
  originAllowed,
  rateLimit,
  rateLimitAsync,
  rateLimitBackend,
  validateChatPayload,
  captchaTriggerCount,
  clientIp,
  verifyCaptcha,
  type PayloadLimits,
} from '../lib/security';

describe('originAllowed', () => {
  const allow = ['https://acme.com', 'https://*.acme.com', 'http://localhost:3000'];

  it('allows the exact apex host', () => {
    expect(originAllowed('https://acme.com', allow)).toBe(true);
  });
  it('allows a wildcard subdomain', () => {
    expect(originAllowed('https://help.acme.com', allow)).toBe(true);
    expect(originAllowed('https://app.staging.acme.com', allow)).toBe(true);
  });
  it('allows localhost for dev', () => {
    expect(originAllowed('http://localhost:3000', allow)).toBe(true);
  });
  it('rejects an unrelated site', () => {
    expect(originAllowed('https://evil.com', allow)).toBe(false);
  });
  it('rejects a look-alike that only ends with the domain', () => {
    expect(originAllowed('https://evilacme.com', allow)).toBe(false);
  });
  it('rejects a null/empty origin', () => {
    expect(originAllowed(null, allow)).toBe(false);
    expect(originAllowed('', allow)).toBe(false);
  });
  it('matches the apex via a wildcard-only rule (regression: new URL() throws on *)', () => {
    expect(originAllowed('https://acme.com', ['https://*.acme.com'])).toBe(true);
    expect(originAllowed('https://x.acme.com', ['https://*.acme.com'])).toBe(true);
  });
});

describe('rateLimit', () => {
  it('allows up to the limit, then blocks', () => {
    const key = `t:${Math.random()}`;
    expect(rateLimit(key, 2, 60_000)).toBe(true);
    expect(rateLimit(key, 2, 60_000)).toBe(true);
    expect(rateLimit(key, 2, 60_000)).toBe(false);
  });
});

describe('rateLimitAsync (distributed)', () => {
  it('defaults to the in-memory limiter when Upstash is not configured', async () => {
    // No UPSTASH_* env in the test env → must fall back to the local Map limiter.
    expect(rateLimitBackend()).toBe('memory');
    const key = `d:${Math.random()}`;
    expect(await rateLimitAsync(key, 1, 60_000)).toBe(true);
    expect(await rateLimitAsync(key, 1, 60_000)).toBe(false);
  });
});

describe('validateChatPayload', () => {
  const limits: PayloadLimits = { maxMessages: 3, maxMessageChars: 20, maxTotalChars: 40 };

  it('accepts a small well-formed payload', () => {
    expect(validateChatPayload([{ role: 'user', content: 'hi' }], limits)).toEqual({ ok: true });
  });
  it('rejects a non-array / empty payload', () => {
    expect(validateChatPayload(undefined, limits)).toEqual({ ok: false, error: 'messages_required' });
    expect(validateChatPayload([], limits)).toEqual({ ok: false, error: 'messages_required' });
  });
  it('rejects too many messages', () => {
    const many = Array.from({ length: 4 }, () => ({ role: 'user', content: 'x' }));
    expect(validateChatPayload(many, limits)).toEqual({ ok: false, error: 'too_many_messages' });
  });
  it('rejects an unknown role', () => {
    expect(validateChatPayload([{ role: 'root', content: 'x' }], limits)).toEqual({ ok: false, error: 'bad_role' });
  });
  it('rejects an over-long single message', () => {
    expect(validateChatPayload([{ role: 'user', content: 'x'.repeat(21) }], limits)).toEqual({
      ok: false,
      error: 'message_too_long',
    });
  });
  it('rejects an over-large total payload', () => {
    const msgs = [
      { role: 'user', content: 'x'.repeat(20) },
      { role: 'assistant', content: 'y'.repeat(20) },
      { role: 'user', content: 'z'.repeat(5) },
    ];
    expect(validateChatPayload(msgs, limits)).toEqual({ ok: false, error: 'payload_too_large' });
  });
  it('counts non-string (multimodal) content by its JSON length', () => {
    const big = [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(40) }] }];
    expect(validateChatPayload(big, limits)).toEqual({ ok: false, error: 'message_too_long' });
  });
});

describe('captchaTriggerCount', () => {
  it('parses after_N_messages', () => {
    expect(captchaTriggerCount('after_3_messages')).toBe(3);
  });
  it('returns 0 for always', () => {
    expect(captchaTriggerCount('always')).toBe(0);
  });
});

describe('clientIp (X-Forwarded-For spoof resistance)', () => {
  const h = (xff?: string, real?: string) =>
    new Headers({ ...(xff ? { 'x-forwarded-for': xff } : {}), ...(real ? { 'x-real-ip': real } : {}) });

  it('uses the proxy-appended (rightmost) entry, ignoring spoofed prefixes', () => {
    // default TRUSTED_PROXY_HOPS=1 → rightmost is the only non-spoofable token
    expect(clientIp(h('9.9.9.9, 2.2.2.2'))).toBe('2.2.2.2');
  });
  it('handles a single real entry', () => {
    expect(clientIp(h('1.1.1.1'))).toBe('1.1.1.1');
  });
  it('falls back to x-real-ip then unknown', () => {
    expect(clientIp(h(undefined, '3.3.3.3'))).toBe('3.3.3.3');
    expect(clientIp(h())).toBe('unknown');
  });
});

describe('verifyCaptcha (fails closed)', () => {
  const base = { enabled: true, provider: 'turnstile' as const, trigger: 'always', secretKey: 'sk' };
  it('passes when captcha is disabled', async () => {
    expect(await verifyCaptcha({ ...base, enabled: false }, undefined, '1.1.1.1')).toBe(true);
  });
  it('rejects when enabled but no token is supplied', async () => {
    expect(await verifyCaptcha(base, undefined, '1.1.1.1')).toBe(false);
  });
  it('rejects (fails closed) for an unimplemented provider instead of silently passing', async () => {
    expect(await verifyCaptcha({ ...base, provider: 'hcaptcha' }, 'tok', '1.1.1.1')).toBe(false);
  });
});
