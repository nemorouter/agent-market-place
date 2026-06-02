// app/api/health/route.ts — liveness + readiness for load balancers / Cloud Run.
//
//   GET /api/health           → liveness: always 200 if the process is up.
//   GET /api/health?ready=1   → readiness: also probes Supabase reachability and
//                               reports whether the Nemo key + vault are configured.
//                               503 if a hard dependency (Supabase) is unreachable.
//
// Readiness is intentionally CHEAP and never spends model credits — it does a
// bounded HEAD-style count against the config table, not an LLM call. Anyone can
// hit liveness; readiness leaks nothing sensitive (only booleans + a backend name).
import { checkReadiness } from '@/lib/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!url.searchParams.has('ready')) {
    return json({ status: 'ok' }, 200);
  }
  const report = await checkReadiness();
  return json(report, report.ready ? 200 : 503);
}
