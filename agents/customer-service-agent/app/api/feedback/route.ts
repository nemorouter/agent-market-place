// app/api/feedback/route.ts — record a 👍/👎 on an answer (public, from the widget).
//
// Same defense posture as /api/chat: origin allow-list → per-IP rate limit → bounded,
// validated payload → write to the agent's OWN Supabase. It NEVER fails the visitor:
// any persistence error still returns 200 (a broken thumbs-up must not look like an
// app error). The write itself is fully sanitized + size-capped (lib/feedback.ts).
import { loadConfig } from '@/lib/config';
import { validateFeedback, saveFeedback } from '@/lib/feedback';
import { originAllowed, rateLimitAsync, clientIp } from '@/lib/security';

export const runtime = 'nodejs';

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const cfg = loadConfig();

  if (!originAllowed(req.headers.get('origin'), cfg.security.allowedOrigins)) {
    return json({ error: 'origin_not_allowed' }, 403);
  }
  const ip = clientIp(req.headers);
  // Generous but bounded — a visitor rates a handful of answers, not hundreds.
  if (!(await rateLimitAsync(`fb:${ip}`, 60, 60_000))) {
    return json({ error: 'rate_limited' }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const fb = validateFeedback(body);
  if (!fb) return json({ error: 'bad_request' }, 400);

  try {
    await saveFeedback(cfg.id, fb);
  } catch (e) {
    // Don't punish the visitor for our DB hiccup — log + acknowledge.
    console.error('[feedback] persist failed:', e instanceof Error ? e.message : e);
    return json({ ok: true, stored: false }, 200);
  }
  return json({ ok: true, stored: true }, 200);
}
