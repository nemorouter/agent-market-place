import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isAllowedEmail,
  adminEmails,
  issueSession,
  verifySession,
  isAuthorized,
  ADMIN_COOKIE,
  generateCode,
  issueChallenge,
  verifyChallenge,
} from '../lib/admin-auth';

const SECRET = 'test-admin-session-secret-key';

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = SECRET;
  process.env.ADMIN_EMAILS = 'owner@acme.com, Boss@Acme.com';
  process.env.ADMIN_TOKEN = 'tok-123';
});
afterEach(() => {
  delete process.env.ADMIN_SESSION_SECRET;
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_TOKEN;
});

const reqWith = (headers: Record<string, string>) => new Request('http://localhost/api/config', { headers });

describe('email allowlist', () => {
  it('parses ADMIN_EMAILS case-insensitively, trimmed', () => {
    expect(adminEmails()).toEqual(['owner@acme.com', 'boss@acme.com']);
  });
  it('allows only configured emails (case-insensitive)', () => {
    expect(isAllowedEmail('owner@acme.com')).toBe(true);
    expect(isAllowedEmail('  BOSS@acme.com ')).toBe(true);
    expect(isAllowedEmail('stranger@evil.com')).toBe(false);
    expect(isAllowedEmail('')).toBe(false);
  });
  it('allows nobody when ADMIN_EMAILS is unset', () => {
    delete process.env.ADMIN_EMAILS;
    expect(isAllowedEmail('owner@acme.com')).toBe(false);
  });
});

describe('signed session', () => {
  it('round-trips an allowlisted email', () => {
    const t = issueSession('owner@acme.com');
    expect(t).toBeTruthy();
    expect(verifySession(t as string)).toEqual({ email: 'owner@acme.com' });
  });
  it('rejects a tampered token', () => {
    const t = issueSession('owner@acme.com') as string;
    const [p] = t.split('.');
    expect(verifySession(`${p}.deadbeef`)).toBeNull();
  });
  it('rejects when signed with a different secret', () => {
    const t = issueSession('owner@acme.com') as string;
    process.env.ADMIN_SESSION_SECRET = 'different-secret';
    expect(verifySession(t)).toBeNull();
  });
  it('rejects an expired token', () => {
    const t = issueSession('owner@acme.com', -10) as string; // already expired
    expect(verifySession(t)).toBeNull();
  });
  it('rejects a session whose email was REMOVED from the allowlist (revocation)', () => {
    const t = issueSession('owner@acme.com') as string;
    process.env.ADMIN_EMAILS = 'someone-else@acme.com';
    expect(verifySession(t)).toBeNull();
  });
  it('returns null when no session secret is configured', () => {
    delete process.env.ADMIN_SESSION_SECRET;
    expect(issueSession('owner@acme.com')).toBeNull();
  });
});

describe('OTP challenge (stateless, SendGrid — no Supabase)', () => {
  it('generateCode returns a 6-digit string', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
  it('verifies the right code against its challenge', () => {
    const ch = issueChallenge('owner@acme.com', '123456') as string;
    expect(verifyChallenge(ch, 'owner@acme.com', '123456')).toBe(true);
  });
  it('rejects a wrong code', () => {
    const ch = issueChallenge('owner@acme.com', '123456') as string;
    expect(verifyChallenge(ch, 'owner@acme.com', '000000')).toBe(false);
  });
  it('rejects a code bound to a different email', () => {
    const ch = issueChallenge('owner@acme.com', '123456') as string;
    expect(verifyChallenge(ch, 'someone@acme.com', '123456')).toBe(false);
  });
  it('rejects a tampered challenge', () => {
    const ch = issueChallenge('owner@acme.com', '123456') as string;
    const [p] = ch.split('.');
    expect(verifyChallenge(`${p}.bad`, 'owner@acme.com', '123456')).toBe(false);
  });
  it('rejects an expired challenge', () => {
    const ch = issueChallenge('owner@acme.com', '123456', -1) as string;
    expect(verifyChallenge(ch, 'owner@acme.com', '123456')).toBe(false);
  });
  it('cannot be verified under a different secret (cookie alone is useless)', () => {
    const ch = issueChallenge('owner@acme.com', '123456') as string;
    process.env.ADMIN_SESSION_SECRET = 'other';
    expect(verifyChallenge(ch, 'owner@acme.com', '123456')).toBe(false);
  });
});

describe('isAuthorized — session cookie OR ADMIN_TOKEN', () => {
  it('accepts a valid ADMIN_TOKEN bearer (machine/script path kept)', () => {
    expect(isAuthorized(reqWith({ authorization: 'Bearer tok-123' }))).toBe(true);
  });
  it('rejects a wrong bearer', () => {
    expect(isAuthorized(reqWith({ authorization: 'Bearer nope' }))).toBe(false);
  });
  it('accepts a valid session cookie (human OTP path)', () => {
    const t = issueSession('owner@acme.com') as string;
    expect(isAuthorized(reqWith({ cookie: `${ADMIN_COOKIE}=${t}` }))).toBe(true);
  });
  it('rejects a tampered session cookie', () => {
    expect(isAuthorized(reqWith({ cookie: `${ADMIN_COOKIE}=abc.def` }))).toBe(false);
  });
  it('rejects when neither is present', () => {
    expect(isAuthorized(reqWith({}))).toBe(false);
  });
  it('rejects token path when ADMIN_TOKEN is unset (no empty-bearer bypass)', () => {
    delete process.env.ADMIN_TOKEN;
    expect(isAuthorized(reqWith({ authorization: 'Bearer ' }))).toBe(false);
  });
});
