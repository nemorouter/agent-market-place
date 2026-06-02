// app/api/admin/request-otp/route.ts — start the /admin OTP login (SendGrid).
//
// POST { email } → if the email is on ADMIN_EMAILS, email a 6-digit code and set a
// signed HttpOnly challenge cookie. NO Supabase, NO database — fully self-contained.
// Anti-enumeration: ALWAYS returns a generic 200 AND always sets a challenge cookie
// (a non-admin just never receives a code), so a prober can't tell admins apart.
import { isAllowedEmail, generateCode, issueChallenge, otpCookie } from '@/lib/admin-auth';
import { sendEmail } from '@/lib/email';
import { rateLimit, clientIp } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERIC = { ok: true, message: 'If that email is an admin, a sign-in code is on its way.' };

function json(obj: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
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
  if (!email) return json(GENERIC, 200);

  const code = generateCode();
  const challenge = issueChallenge(email, code);
  if (!challenge) return json(GENERIC, 200); // ADMIN_SESSION_SECRET unset → vault off

  // Only ACTUALLY email an allowlisted admin; everyone gets the same cookie + 200.
  if (isAllowedEmail(email)) {
    const text = `Your Nemo Router admin sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't request this, ignore this email.`;
    const html = `<p>Your Nemo Router admin sign-in code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:2px">${code}</p><p>It expires in 10 minutes. If you didn't request this, ignore this email.</p>`;
    await sendEmail(email, 'Your Nemo Router admin sign-in code', text, html);
  }
  return json(GENERIC, 200, { 'Set-Cookie': otpCookie(challenge) });
}
