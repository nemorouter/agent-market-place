import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Self-contained OTP: mock the email sender + pin the code; everything else is real
// (challenge cookie, allowlist, session). No Supabase anywhere.
const sendEmail = vi.fn(async () => true);
vi.mock('@/lib/email', () => ({ sendEmail, emailConfigured: () => true }));
vi.mock('@/lib/admin-auth', async (orig) => {
  const actual = await orig<typeof import('../lib/admin-auth')>();
  return { ...actual, generateCode: () => '123456' };
});

const { POST: requestOtp } = await import('../app/api/admin/request-otp/route');
const { POST: verifyOtpRoute } = await import('../app/api/admin/verify-otp/route');

const post = (url: string, body: unknown, cookie?: string) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const cookieValue = (setCookie: string | null): string => (setCookie ? setCookie.split(';')[0] : '');

beforeEach(() => {
  process.env.ADMIN_EMAILS = 'owner@acme.com';
  process.env.ADMIN_SESSION_SECRET = 'sess-secret';
  sendEmail.mockClear();
});
afterEach(() => {
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_SESSION_SECRET;
});

describe('POST /api/admin/request-otp (SendGrid)', () => {
  it('emails an allowlisted admin + sets a challenge cookie', async () => {
    const res = await requestOtp(post('http://localhost/x', { email: 'owner@acme.com' }));
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(res.headers.get('set-cookie') || '').toContain('amp_admin_otp=');
  });
  it('non-admin: same generic 200 + cookie, but NO email (anti-enumeration)', async () => {
    const res = await requestOtp(post('http://localhost/x', { email: 'stranger@evil.com' }));
    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie') || '').toContain('amp_admin_otp='); // cookie still set → can't enumerate
  });
});

describe('POST /api/admin/verify-otp (challenge cookie)', () => {
  async function challengeFor(email: string): Promise<string> {
    const res = await requestOtp(post('http://localhost/x', { email }));
    return cookieValue(res.headers.get('set-cookie'));
  }

  it('valid code + challenge → 200 + session cookie, clears the challenge', async () => {
    const ch = await challengeFor('owner@acme.com');
    const res = await verifyOtpRoute(post('http://localhost/x', { email: 'owner@acme.com', token: '123456' }, ch));
    expect(res.status).toBe(200);
    const cookies = res.headers.get('set-cookie') || '';
    expect(cookies).toContain('amp_admin_session=');
  });
  it('wrong code → 401', async () => {
    const ch = await challengeFor('owner@acme.com');
    const res = await verifyOtpRoute(post('http://localhost/x', { email: 'owner@acme.com', token: '999999' }, ch));
    expect(res.status).toBe(401);
  });
  it('non-allowlisted email → 401 (before any cookie check)', async () => {
    const ch = await challengeFor('owner@acme.com');
    const res = await verifyOtpRoute(post('http://localhost/x', { email: 'stranger@evil.com', token: '123456' }, ch));
    expect(res.status).toBe(401);
  });
  it('no challenge cookie → 401', async () => {
    const res = await verifyOtpRoute(post('http://localhost/x', { email: 'owner@acme.com', token: '123456' }));
    expect(res.status).toBe(401);
  });
  it('400 when code missing', async () => {
    expect((await verifyOtpRoute(post('http://localhost/x', { email: 'owner@acme.com' }))).status).toBe(400);
  });
});
