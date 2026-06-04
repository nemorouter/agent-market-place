// app/api/admin/gaps/route.ts — the continuous-learning surface (admin-gated).
//
// GET → ranked "knowledge gaps": the questions the agent couldn't confidently answer,
// grouped by normalized phrasing and ranked by frequency. Operators use this to decide
// which docs to add; `npm run ingest` then re-embeds and the gap closes.
//
// Same auth as the rest of /admin: a signed session cookie OR the ADMIN_TOKEN bearer.
import { loadConfig } from '@/lib/config';
import { topGaps } from '@/lib/gaps';
import { isAuthorized } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req)) return json({ error: 'unauthorized' }, 401);
  const clusters = await topGaps(loadConfig().id, { limit: 50 });
  return json({ gaps: clusters, total: clusters.reduce((a, c) => a + c.count, 0) }, 200);
}
