import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Supabase Auth so we test the route CONTRACT (allowlist + cookie), not email.
const verifyOtp = vi.fn();
const signInWithOtp = vi.fn(async () => ({ data: {}, error: null }));
vi.mock('@/lib/supabase-auth', () => ({
  supabaseAuth: () => ({ auth: { verifyOtp, signInWithOtp } }),
}));

const { POST: requestOtp } = await import('../app/api/admin/request-otp/route');
const { POST: verifyOtpRoute } = await import('../app/api/admin/verify-otp/route');

const post = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  process.env.ADMIN_EMAILS = 'owner@acme.com';
  process.env.ADMIN_SESSION_SECRET = 'sess-secret';
  verifyOtp.mockReset();
  signInWithOtp.mockClear();
});
afterEach(() => {
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_SESSION_SECRET;
});

describe('POST /api/admin/request-otp', () => {
  it('emails a code for an allowlisted address (generic 200)', async () => {
    const res = await requestOtp(post('http://localhost/api/admin/request-otp', { email: 'owner@acme.com' }));
    expect(res.status).toBe(200);
    expect(signInWithOtp).toHaveBeenCalledOnce();
  });

  it('returns the SAME generic 200 for a non-admin (anti-enumeration), sends nothing', async () => {
    const res = await requestOtp(post('http://localhost/api/admin/request-otp', { email: 'stranger@evil.com' }));
    expect(res.status).toBe(200);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/verify-otp', () => {
  it('rejects a non-allowlisted email BEFORE verifying (401, no verify call)', async () => {
    const res = await verifyOtpRoute(post('http://localhost/api/admin/verify-otp', { email: 'stranger@evil.com', token: '123456' }));
    expect(res.status).toBe(401);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('rejects a bad code (401, no cookie)', async () => {
    verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { message: 'invalid' } });
    const res = await verifyOtpRoute(post('http://localhost/api/admin/verify-otp', { email: 'owner@acme.com', token: '000000' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('on a valid code → 200 + HttpOnly session cookie', async () => {
    verifyOtp.mockResolvedValueOnce({ data: { session: { access_token: 'x' } }, error: null });
    const res = await verifyOtpRoute(post('http://localhost/api/admin/verify-otp', { email: 'owner@acme.com', token: '654321' }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') || '';
    expect(cookie).toContain('amp_admin_session=');
    expect(cookie).toContain('HttpOnly');
  });

  it('400 when email or code missing', async () => {
    expect((await verifyOtpRoute(post('http://localhost/api/admin/verify-otp', { email: 'owner@acme.com' }))).status).toBe(400);
  });
});
