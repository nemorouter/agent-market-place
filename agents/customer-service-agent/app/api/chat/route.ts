// app/api/chat/route.ts — the public chat endpoint the widget calls.
//
// Order of operations:
//   Layer 1 origin allow-list → Layer 2 rate limit → Layer 3 captcha
//   → retrieve from the customer's KB → stream from Nemo.
// Nemo then enforces guardrails + routing/fallback + credits + key rate-limits
// server-side. We surface its errors (guardrail_blocked / insufficient_credits /
// rate_limited) back to the widget untouched.
import { loadConfig } from '@/lib/config';
import { retrieve } from '@/lib/retrieval';
import { chatStream, NemoError, type ChatMessage } from '@/lib/nemo';
import { originAllowed, rateLimit, verifyCaptcha, clientIp, captchaTriggerCount } from '@/lib/security';

export const runtime = 'nodejs';

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(req: Request): Promise<Response> {
  const cfg = loadConfig();
  const origin = req.headers.get('origin');
  const ip = clientIp(req.headers);

  // Layer 1 — origin allow-list
  if (!originAllowed(origin, cfg.security.allowedOrigins)) {
    return json({ error: 'origin_not_allowed' }, 403);
  }
  // Layer 2a — per-IP rate limit
  if (!rateLimit(`ip:${ip}`, cfg.security.rateLimit.perIpPerMin, 60_000)) {
    return json({ error: 'rate_limited' }, 429);
  }

  let body: { messages?: ChatMessage[]; sessionId?: string; captchaToken?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const messages = body.messages ?? [];
  const session = body.sessionId || ip;

  // Layer 2b — per-session rate limit
  if (!rateLimit(`sess:${session}`, cfg.security.rateLimit.perSessionPerMin, 60_000)) {
    return json({ error: 'rate_limited' }, 429);
  }

  // Layer 3 — captcha (configurable trigger)
  const userTurns = messages.filter((m) => m.role === 'user').length;
  const needsCaptcha =
    cfg.security.captcha.enabled &&
    (cfg.security.captcha.trigger === 'always' || userTurns >= captchaTriggerCount(cfg.security.captcha.trigger));
  if (needsCaptcha && !(await verifyCaptcha(cfg.security.captcha, body.captchaToken, ip))) {
    return json({ error: 'captcha_required' }, 428);
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = typeof lastUser?.content === 'string' ? lastUser.content : '';

  try {
    // Retrieve from the customer's OWN knowledge base. This calls Nemo /v1/embeddings,
    // so it must live INSIDE the try — a Nemo error here (bad key, 402, guardrail) must
    // surface as a clean JSON error, not an unhandled 500.
    let context = '';
    let citations: Array<{ title: string; url: string | null }> = [];
    if (question) {
      const chunks = await retrieve(question, cfg.embeddingModel, cfg.topK);
      context = chunks.map((c, i) => `[${i + 1}] ${c.title}\n${c.content}`).join('\n\n');
      citations = chunks.map((c) => ({ title: c.title, url: c.url }));
    }

    const system: ChatMessage = {
      role: 'system',
      content: `${cfg.systemPrompt}\n\nContext:\n${context || '(no relevant context found)'}`,
    };

    // Nemo applies guardrails + routing/fallback + credit reserve+settle here.
    const upstream = await chatStream({
      model: cfg.model,
      messages: [system, ...messages],
      guardrails: cfg.guardrails,
      sessionId: session,
    });
    // Pass Nemo's cost through as an x-nemo-* header (Rule #14: never expose x-litellm-*).
    const headers = new Headers({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const cost = upstream.headers.get('x-litellm-response-cost');
    if (cost) headers.set('x-nemo-response-cost', cost);
    headers.set('x-nemo-citations', Buffer.from(JSON.stringify(citations)).toString('base64'));
    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    if (e instanceof NemoError) return json({ error: e.code, message: e.message }, e.status);
    return json({ error: 'internal_error' }, 500);
  }
}
