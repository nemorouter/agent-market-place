// app/api/admin/session/route.ts — who is the logged-in admin?
//
// GET  → { authenticated, email }  (reads the OTP session cookie)
// POST { action: 'logout' } → clears the session cookie.
import { ADMIN_COOKIE, verifySession, clearCookie } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(obj: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
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

export async function GET(req: Request): Promise<Response> {
  const cookie = readCookie(req.headers.get('cookie'), ADMIN_COOKIE);
  const session = cookie ? verifySession(cookie) : null;
  return json({ authenticated: Boolean(session), email: session?.email ?? null }, 200);
}

export async function POST(): Promise<Response> {
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}
