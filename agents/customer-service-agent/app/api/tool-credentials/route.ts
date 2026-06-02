// app/api/tool-credentials/route.ts — operator sets/clears a tool's secret.
//
//   GET    → { vaultConfigured, toolIds: [...] }  (which tools have a credential)
//   POST   → { toolId, secret }  → seal + store (ciphertext only)
//   DELETE → { toolId }          → remove
//
// ADMIN_TOKEN-gated. The secret is sealed server-side by the agent-infra vault
// (lib/vault.ts) before it touches the DB; the plaintext is NEVER returned by GET
// and NEVER logged. nemo-backend is not involved here at all.
import { loadConfig } from '@/lib/config';
import { vaultConfigured } from '@/lib/vault';
import { setCredential, clearCredential, listCredentialedToolIds } from '@/lib/credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isAdmin(req: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  return Boolean(token) && req.headers.get('authorization') === `Bearer ${token}`;
}

export async function GET(req: Request): Promise<Response> {
  if (!isAdmin(req)) return json({ error: 'unauthorized' }, 401);
  const cfg = loadConfig();
  const toolIds = await listCredentialedToolIds(cfg.id);
  return json({ vaultConfigured: vaultConfigured(), toolIds }, 200);
}

export async function POST(req: Request): Promise<Response> {
  if (!isAdmin(req)) return json({ error: 'unauthorized' }, 401);
  if (!vaultConfigured()) {
    return json({ error: 'vault_disabled', message: 'Set TOOL_VAULT_KEY to store tool credentials.' }, 400);
  }
  let body: { toolId?: unknown; secret?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const toolId = typeof body.toolId === 'string' ? body.toolId.trim() : '';
  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (!toolId || !secret) return json({ error: 'bad_request', message: 'toolId + secret required' }, 400);
  try {
    await setCredential(loadConfig().id, toolId, secret);
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: 'save_failed', message: e instanceof Error ? e.message : 'failed' }, 500);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  if (!isAdmin(req)) return json({ error: 'unauthorized' }, 401);
  let body: { toolId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const toolId = typeof body.toolId === 'string' ? body.toolId.trim() : '';
  if (!toolId) return json({ error: 'bad_request' }, 400);
  try {
    await clearCredential(loadConfig().id, toolId);
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: 'delete_failed', message: e instanceof Error ? e.message : 'failed' }, 500);
  }
}
