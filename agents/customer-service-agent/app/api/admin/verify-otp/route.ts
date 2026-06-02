// app/api/admin/verify-otp/route.ts — complete the /admin OTP login (self-contained).
//
// POST { email, token } → verify the submitted code against the signed challenge
// cookie + the allowlist, then mint our local signed session cookie. NO Supabase.
import {
  isAllowedEmail,
  verifyChallenge,
  issueSession,
  sessionCookie,
  clearOtpCookie,
  getCookie,
  OTP_COOKIE,
} from '@/lib/admin-auth';
import { rateLimit, clientIp } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(obj: unknown, status: number, cookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(obj), { status, headers });
}

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req.headers);
  if (!rateLimit(`otp-verify:${ip}`, 10, 60_000)) return json({ error: 'rate_limited' }, 429);

  let email = '';
  let code = '';
  try {
    const body = (await req.json()) as { email?: unknown; token?: unknown; code?: unknown };
    email = typeof body.email === 'string' ? body.email.trim() : '';
    code = typeof body.token === 'string' ? body.token.trim() : typeof body.code === 'string' ? body.code.trim() : '';
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!email || !code) return json({ error: 'bad_request' }, 400);
  if (!isAllowedEmail(email)) return json({ error: 'unauthorized' }, 401);

  const challenge = getCookie(req, OTP_COOKIE);
  if (!challenge || !verifyChallenge(challenge, email, code)) {
    return json({ error: 'invalid_code' }, 401);
  }

  const token = issueSession(email);
  if (!token) return json({ error: 'server_misconfigured', message: 'ADMIN_SESSION_SECRET not set.' }, 500);
  // Set the session, clear the one-time challenge.
  return json({ ok: true, email }, 200, [sessionCookie(token), clearOtpCookie()]);
}
