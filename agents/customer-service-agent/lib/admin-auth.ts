// lib/admin-auth.ts — /admin authentication.
//
// Two ways in, both checked by `isAuthorized`:
//   1. HUMAN — email OTP login (Supabase Auth). On success we mint a short signed
//      session token (HMAC) and set it as an HttpOnly cookie. Restricted to the
//      ADMIN_EMAILS allowlist at request, verify, AND on every cookie check (so
//      removing an email instantly revokes its sessions).
//   2. MACHINE — the existing ADMIN_TOKEN bearer (scripts/ingest, programmatic).
//
// The session secret + allowlist live in env. No plaintext password anywhere.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'amp_admin_session';

function sessionSecret(): string | null {
  return process.env.ADMIN_SESSION_SECRET || null;
}

const b64url = (b: Buffer | string): string =>
  (Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const b64urlDecode = (s: string): string =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** The configured admin emails (lowercased, trimmed). [] when unset. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True iff `email` is on the allowlist. Empty allowlist allows NOBODY. */
export function isAllowedEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return Boolean(e) && adminEmails().includes(e);
}

/** Mint a signed session token for an email, or null if no secret configured. */
export function issueSession(email: string, ttlSec = 60 * 60 * 12): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload = b64url(JSON.stringify({ email: email.trim().toLowerCase(), exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Verify a session token: signature + expiry + STILL on the allowlist. */
export function verifySession(token: string): { email: string } | null {
  const secret = sessionSecret();
  if (!secret || !token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(createHmac('sha256', secret).update(payload).digest());
  if (!safeEqual(expected, sig)) return null;
  try {
    const obj = JSON.parse(b64urlDecode(payload)) as { email?: unknown; exp?: unknown };
    if (typeof obj.exp === 'number' && obj.exp * 1000 < Date.now()) return null;
    if (typeof obj.email !== 'string' || !isAllowedEmail(obj.email)) return null;
    return { email: obj.email };
  } catch {
    return null;
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** The gate every admin route uses: a valid OTP session cookie OR the ADMIN_TOKEN.
 *  No token configured → the bearer path is closed (never an empty-bearer bypass). */
export function isAuthorized(req: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (token && req.headers.get('authorization') === `Bearer ${token}`) return true;
  const cookie = readCookie(req.headers.get('cookie'), ADMIN_COOKIE);
  return cookie ? verifySession(cookie) !== null : false;
}

/** Serialize the session cookie (HttpOnly, SameSite=Lax, Secure in prod). */
export function sessionCookie(token: string, ttlSec = 60 * 60 * 12): string {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${ttlSec}`;
}

/** A cookie string that clears the session (logout). */
export function clearCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
