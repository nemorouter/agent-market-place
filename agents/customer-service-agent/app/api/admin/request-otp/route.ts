// app/api/admin/request-otp/route.ts — start the /admin OTP login.
//
// POST { email } → if the email is on ADMIN_EMAILS, Supabase emails a one-time code.
// Anti-enumeration: the response is ALWAYS a generic 200, so a stranger can't learn
// which emails are admins. Rate-limited per IP.
import { isAllowedEmail } from '@/lib/admin-auth';
import { supabaseAuth } from '@/lib/supabase-auth';
import { rateLimit, clientIp } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERIC = { ok: true, message: 'If that email is an admin, a sign-in code is on its way.' };

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req.headers);
  if (!rateLimit(`otp-req:${ip}`, 5, 60_000)) return json({ error: 'rate_limited' }, 429);

  let email = '';
  try {
    const body = (await req.json()) as { email?: unknown };
    email = typeof body.email === 'string' ? body.email.trim() : '';
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  // Only send to allowlisted admins; otherwise return the same generic 200.
  if (email && isAllowedEmail(email)) {
    try {
      await supabaseAuth().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    } catch {
      /* swallow — never reveal send failures / whether the email exists */
    }
  }
  return json(GENERIC, 200);
}
