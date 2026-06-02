// app/api/chat/route.ts — the public chat endpoint the widget calls.
//
// Order of operations:
//   Layer 1 origin allow-list → Layer 2 rate limit → Layer 3 captcha
//   → retrieve from the customer's KB → stream from Nemo.
// Nemo then enforces guardrails + routing/fallback + credits + key rate-limits
// server-side. We surface its errors (guardrail_blocked / insufficient_credits /
// rate_limited) back to the widget untouched.
import { loadConfig } from '@/lib/config';
import { loadSettings } from '@/lib/settings';
import { retrieve } from '@/lib/retrieval';
import { chatStream, chatComplete, NemoError, type ChatMessage } from '@/lib/nemo';
import { listTools, callTool, runToolLoop, type ToolStepEvent } from '@/lib/tools';
import { getCredential, listCredentialedToolIds } from '@/lib/credentials';
import { originAllowed, rateLimit, verifyCaptcha, clientIp, captchaTriggerCount } from '@/lib/security';
import { resolveIdentity, buildPersona } from '@/lib/identity';

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

  // Pluggable login layer: resolve the visitor SERVER-SIDE from the request
  // (cookie / proxy header / introspection). Anonymous when IDENTITY_MODE=none
  // or on any failure — personalization never breaks the chat path. We never
  // trust an identity the browser puts in the body (Rule #26).
  const identity = await resolveIdentity(req, cfg.identity);

  // Operator-editable settings (system prompt + model) overlaid from the dashboard;
  // degrades to env defaults on any Supabase failure (chat must never break).
  const settings = await loadSettings(cfg);

  try {
    // Retrieve from the customer's OWN knowledge base. This calls Nemo /v1/embeddings,
    // so it must live INSIDE the try — a Nemo error here (bad key, 402, guardrail) must
    // surface as a clean JSON error, not an unhandled 500.
    // Signed-in users get docs scoped to their entitlements (e.g. ["public","pro"]).
    let context = '';
    let citations: Array<{ title: string; url: string | null }> = [];
    if (question) {
      const chunks = await retrieve(question, cfg.embeddingModel, cfg.topK, identity.docAudiences);
      context = chunks.map((c, i) => `[${i + 1}] ${c.title}\n${c.content}`).join('\n\n');
      citations = chunks.map((c) => ({ title: c.title, url: c.url }));
    }

    // ── Optional MCP-gateway tool use (Phase 2) ──────────────────────────────
    // When the operator enabled tools, run a bounded tool-decision loop against
    // the Nemo gateway (each tool call enforces guardrail→reserve→settle server-
    // side). Tool output is folded into the answer's context. Fully graceful: an
    // unreachable gateway / unsupported model / tool error → pure-RAG answer.
    let toolContext = '';
    const toolSteps: ToolStepEvent[] = [];
    if (question && settings.enabledTools.length) {
      try {
        const catalog = await listTools();
        const enabled = catalog.filter((t) => settings.enabledTools.includes(t.id));
        if (enabled.length) {
          // Which enabled tools have a stored credential (sealed in the agent vault).
          const credIds = new Set(await listCredentialedToolIds(cfg.id));
          const loop = await runToolLoop({
            messages: [
              { role: 'system', content: `${settings.systemPrompt}\n\nYou may call tools when they help answer. Prefer the provided context first.` },
              ...messages,
            ],
            enabled,
            maxSteps: cfg.maxSteps,
            chat: (msgs, tools) =>
              chatComplete({ model: settings.model, messages: msgs, tools, guardrails: cfg.guardrails, sessionId: session }),
            // Open the sealed credential (agent-infra key) ONLY at call time and pass it
            // transiently to the gateway; it is never stored or logged here.
            call: async (id, args) => {
              const credential = credIds.has(id) ? await getCredential(cfg.id, id) : null;
              return callTool(id, args, credential ? { credential } : undefined);
            },
            onStep: (e) => {
              const i = toolSteps.findIndex((s) => s.tool === e.tool);
              if (i >= 0) toolSteps[i] = e;
              else toolSteps.push(e);
            },
          });
          toolContext = loop.toolContext;
        }
      } catch {
        /* tool layer is best-effort — never blocks the answer */
      }
    }

    const system: ChatMessage = {
      role: 'system',
      content: `${settings.systemPrompt}${buildPersona(identity, cfg.identity)}\n\nContext:\n${
        context || '(no relevant context found)'
      }${toolContext}`,
    };

    // Nemo applies guardrails + routing/fallback + credit reserve+settle here. The
    // final answer streams WITHOUT tools (tool results are already in the context).
    const upstream = await chatStream({
      model: settings.model,
      messages: [system, ...messages],
      guardrails: cfg.guardrails,
      sessionId: session,
    });
    // Pass Nemo's cost through as an x-nemo-* header (Rule #14: never expose x-litellm-*).
    const headers = new Headers({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const cost = upstream.headers.get('x-litellm-response-cost');
    if (cost) headers.set('x-nemo-response-cost', cost);
    headers.set('x-nemo-citations', Buffer.from(JSON.stringify(citations)).toString('base64'));

    // No tools ran → stream upstream untouched (identical to the pure-RAG path).
    if (!toolSteps.length || !upstream.body) {
      return new Response(upstream.body, { status: 200, headers });
    }
    // Tools ran → prepend the tool-step events (widget renders them) then pipe the answer.
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const s of toolSteps) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ nemo_event: 'tool_call', tool: s.tool, title: s.title, status: 'done' })}\n\n`),
          );
        }
        const reader = upstream.body!.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(body, { status: 200, headers });
  } catch (e) {
    if (e instanceof NemoError) return json({ error: e.code, message: e.message }, e.status);
    return json({ error: 'internal_error' }, 500);
  }
}
