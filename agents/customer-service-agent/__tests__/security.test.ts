import { describe, it, expect } from 'vitest';
import { originAllowed, rateLimit, captchaTriggerCount } from '../lib/security';

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

describe('captchaTriggerCount', () => {
  it('parses after_N_messages', () => {
    expect(captchaTriggerCount('after_3_messages')).toBe(3);
  });
  it('returns 0 for always', () => {
    expect(captchaTriggerCount('always')).toBe(0);
  });
});
