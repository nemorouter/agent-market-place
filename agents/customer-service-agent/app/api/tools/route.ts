// app/api/tools/route.ts — the MCP gateway tool catalog, for the /admin Tools UI.
//
// GET → the tools this agent's sk-nemo key can see on the Nemo gateway
// (GET /v1/mcp/tools), so the operator can pick which ones the agent may use.
// ADMIN_TOKEN-gated (same gate as /api/config + /api/ingest) — the catalog is
// fetched server-side with the agent key, never exposing the key to the browser.
// Degrades to an empty list if the gateway is unreachable (UI shows "none").
import { listTools } from '@/lib/tools';
import { isAuthorized } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req)) return json({ error: 'unauthorized' }, 401);
  const tools = await listTools();
  return json({ object: 'list', data: tools }, 200);
}
