// app/api/ingest/route.ts — admin-triggered "Re-index".
//
// Reads ./docs + crawls WEBSITE_URL, embeds via Nemo, upserts into the customer's
// pgvector KB. Gated by a shared ADMIN_TOKEN (server-side env) so the public can't
// trigger it. Run it after your docs/site change.
import { loadConfig } from '@/lib/config';
import { readDocsDir, crawlWebsite, ingest, type SourceDoc } from '@/lib/ingest';
import path from 'node:path';

export const runtime = 'nodejs';
export const maxDuration = 300;

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(req: Request): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.ADMIN_TOKEN}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  const cfg = loadConfig();
  const docsPath = process.env.DOCS_PATH;
  const websiteUrl = process.env.WEBSITE_URL;
  const baseUrl = process.env.DOCS_BASE_URL;
  const maxPages = Number(process.env.WEBSITE_MAX_PAGES || 60);

  const sources: SourceDoc[] = [];
  if (docsPath) sources.push(...(await readDocsDir(path.resolve(process.cwd(), docsPath), baseUrl)));
  if (websiteUrl) sources.push(...(await crawlWebsite(websiteUrl, maxPages)));
  if (!sources.length) {
    return json({ error: 'no_sources', message: 'Set DOCS_PATH and/or WEBSITE_URL in your env.' }, 400);
  }

  const chunks = await ingest({ docs: sources, embeddingModel: cfg.embeddingModel });
  return json({ ok: true, sources: sources.length, chunks }, 200);
}
