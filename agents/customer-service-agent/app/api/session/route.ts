// app/api/session/route.ts — "who is the visitor?" for the widget greeting.
//
// Same-origin GET the widget calls when it opens. Resolves identity SERVER-SIDE
// (cookie / proxy header / introspection) and returns ONLY the browser-safe
// projection: { authenticated, displayName, links }. Email, id, attributes, and
// doc-audience tags NEVER cross the wire — those stay server-side for the prompt.
//
// This is the fork's OWN Next.js route, not a Nemo gateway API — fully inside the
// "no new Nemo APIs" constraint (amp-architecture).
import { loadConfig } from '@/lib/config';
import { resolveIdentity, publicIdentity } from '@/lib/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // identity depends on per-request cookies/headers

export async function GET(req: Request): Promise<Response> {
  const cfg = loadConfig();
  const identity = await resolveIdentity(req, cfg.identity);
  return new Response(JSON.stringify(publicIdentity(identity)), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
