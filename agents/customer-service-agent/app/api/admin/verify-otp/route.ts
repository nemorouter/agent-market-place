// app/api/admin/verify-otp/route.ts — complete the /admin OTP login.
//
// POST { email, token } → verify the code with Supabase Auth, re-check the allowlist,
// then mint our own signed session and set it as an HttpOnly cookie. From then on the
// admin routes accept that cookie (lib/admin-auth isAuthorized).
import { isAllowedEmail, issueSession, sessionCookie } from '@/lib/admin-auth';
import { supabaseAuth } from '@/lib/supabase-auth';
import { rateLimit, clientIp } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(obj: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
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
  // Allowlist BEFORE trusting any verification (defense in depth).
  if (!isAllowedEmail(email)) return json({ error: 'unauthorized' }, 401);

  try {
    const { data, error } = await supabaseAuth().auth.verifyOtp({ email, token: code, type: 'email' });
    if (error || !data?.session) return json({ error: 'invalid_code' }, 401);
  } catch {
    return json({ error: 'invalid_code' }, 401);
  }

  const token = issueSession(email);
  if (!token) return json({ error: 'server_misconfigured', message: 'ADMIN_SESSION_SECRET not set.' }, 500);
  return json({ ok: true, email }, 200, { 'Set-Cookie': sessionCookie(token) });
}
