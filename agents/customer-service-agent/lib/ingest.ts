// lib/ingest.ts — Option 3 ingestion: read ./docs + crawl WEBSITE_URL, chunk,
// embed via Nemo, upsert into the customer's OWN Supabase pgvector table.
//
// EXTENSION POINT: add a new source adapter (Notion, sitemap, PDF, DB) by producing
// SourceDoc[] and passing them to ingest() — no other file changes needed.
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { embed } from './nemo';
import { supabaseAdmin } from './supabase';

export interface SourceDoc {
  title: string;
  url: string | null;
  content: string;
}

const CHUNK_CHARS = 1200;
const OVERLAP = 150;

export function chunk(text: string): string[] {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += CHUNK_CHARS - OVERLAP) out.push(clean.slice(i, i + CHUNK_CHARS));
  return out;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // code fences
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/^---[\s\S]*?---/m, ' ') // frontmatter
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read every .md/.mdx file under a docs directory (recursively). */
export async function readDocsDir(dir: string, baseUrl?: string): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];
  async function walk(d: string): Promise<void> {
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (/\.(md|mdx)$/i.test(e.name)) {
        const raw = await fs.readFile(full, 'utf8');
        const rel = path.relative(dir, full).replace(/\.(md|mdx)$/i, '');
        const title = (raw.match(/^#\s+(.+)$/m)?.[1] || rel).trim();
        const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/${rel}` : null;
        docs.push({ title, url, content: stripMarkdown(raw) });
      }
    }
  }
  await walk(dir);
  return docs;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLinks(html: string, base: string): string[] {
  const links: string[] = [];
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      links.push(new URL(m[1], base).toString().split('#')[0]);
    } catch {
      /* skip malformed href */
    }
  }
  return links;
}

/** Bounded, same-origin website crawl (stdlib fetch + naive link extraction). */
export async function crawlWebsite(startUrl: string, maxPages: number): Promise<SourceDoc[]> {
  const origin = new URL(startUrl).origin;
  const seen = new Set<string>();
  const queue: string[] = [startUrl];
  const docs: SourceDoc[] = [];
  while (queue.length && docs.length < maxPages) {
    const url = queue.shift() as string;
    if (seen.has(url)) continue;
    seen.add(url);
    let html = '';
    try {
      html = await (await fetch(url)).text();
    } catch {
      continue;
    }
    const text = htmlToText(html);
    const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] || url).trim();
    if (text.length > 200) docs.push({ title, url, content: text });
    for (const href of extractLinks(html, url)) {
      if (href.startsWith(origin) && !seen.has(href) && queue.length + docs.length < maxPages) queue.push(href);
    }
  }
  return docs;
}

/** Full ingest: sources → chunks → embeddings → upsert. Replaces the KB (full re-index). */
export async function ingest(opts: { docs: SourceDoc[]; embeddingModel: string; batchSize?: number }): Promise<number> {
  const db = supabaseAdmin();
  // Full re-index: clear the table, then insert fresh chunks.
  await db.from('kb_chunks').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const rows: Array<{ title: string; url: string | null; content: string }> = [];
  for (const d of opts.docs) for (const c of chunk(d.content)) rows.push({ title: d.title, url: d.url, content: c });

  const batch = opts.batchSize ?? 64;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const vectors = await embed(opts.embeddingModel, slice.map((r) => r.content));
    const payload = slice.map((r, j) => ({ ...r, embedding: vectors[j] as unknown as string }));
    const { error } = await db.from('kb_chunks').insert(payload);
    if (error) throw new Error(`ingest insert failed: ${error.message}`);
    inserted += slice.length;
  }
  return inserted;
}
