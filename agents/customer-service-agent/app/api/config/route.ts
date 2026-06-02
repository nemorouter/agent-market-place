// app/api/config/route.ts — read/write the operator-editable agent settings.
//
//   GET  → public projection (agentName, suggestions, quickLinks, contactMethods).
//          The widget calls this on open to render config-driven UI.
//          If a valid ADMIN_TOKEN bearer is present, returns the FULL settings
//          (incl. systemPrompt/model/greet) so the /admin dashboard can prefill.
//   PUT  → ADMIN_TOKEN-gated. Validates + upserts the override row in the operator's
//          OWN Supabase, then echoes the merged full settings back.
//
// This is the fork's OWN Next.js route, not a Nemo gateway API — inside the
// "no new Nemo APIs" constraint (amp-architecture). Same ADMIN_TOKEN that gates
// /api/ingest. Reads degrade to env defaults on any Supabase failure.
import { loadConfig } from '@/lib/config';
import { loadSettings, saveSettings, publicSettings, type AgentSettings } from '@/lib/settings';
import { isAuthorized } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // settings live in Supabase, per-request

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: Request): Promise<Response> {
  const settings = await loadSettings();
  // Admins get the full object to prefill the editor; everyone else the safe subset.
  return json(isAuthorized(req) ? settings : publicSettings(settings), 200);
}

export async function PUT(req: Request): Promise<Response> {
  if (!isAuthorized(req)) return json({ error: 'unauthorized' }, 401);

  let body: Partial<AgentSettings>;
  try {
    body = (await req.json()) as Partial<AgentSettings>;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ error: 'bad_request' }, 400);

  try {
    const merged = await saveSettings(loadConfig(), body);
    return json({ ok: true, settings: merged }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'save_failed';
    return json({ error: 'save_failed', message }, 500);
  }
}
