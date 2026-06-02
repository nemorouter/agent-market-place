// lib/ingest.ts — Option 3 ingestion: read ./docs + crawl WEBSITE_URL, chunk,
// embed via Nemo, upsert into the customer's OWN Supabase pgvector table.
//
// EXTENSION POINT: add a new source adapter (Notion, sitemap, PDF, DB) by producing
// SourceDoc[] and passing them to ingest() — no other file changes needed.
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { embed } from './nemo';
import { supabaseService } from './supabase';

export interface SourceDoc {
  title: string;
  url: string | null;
  content: string;
  /** Optional entitlement tags — which signed-in tiers may see this doc, e.g.
   *  ["pro","enterprise"]. Omitted → the chunk falls back to the DB default
   *  {public} (visible to everyone). See lib/identity.ts + supabase/migration.sql. */
  audiences?: string[];
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

/** Pull `audiences` out of leading frontmatter (--- ... ---). Accepts
 *  `audiences: [pro, enterprise]`, `audiences: pro, enterprise`, or `audiences: pro`.
 *  Returns undefined when absent → the chunk stays public. Dependency-free. */
export function parseAudiences(raw: string): string[] | undefined {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!fm) return undefined;
  const line = fm[1].split('\n').find((l) => /^\s*audiences\s*:/.test(l));
  if (!line) return undefined;
  const items = line
    .slice(line.indexOf(':') + 1)
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return items.length ? items : undefined;
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
        docs.push({ title, url, content: stripMarkdown(raw), audiences: parseAudiences(raw) });
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

// ── SSRF guard ───────────────────────────────────────────────────────────────
// The crawler fetches operator-configured URLs AND links discovered inside fetched
// pages, so a compromised/poisoned page could point us at cloud metadata or an
// internal service. Only http(s) to a PUBLIC host is ever fetched.
const CRAWL_TIMEOUT_MS = Number(process.env.WEBSITE_FETCH_TIMEOUT_MS) || 10_000;
const CRAWL_MAX_BYTES = Number(process.env.WEBSITE_MAX_PAGE_BYTES) || 2_000_000; // 2 MB / page

/** True for IPv4/IPv6 literals + hostnames that must NEVER be fetched server-side
 *  (loopback, RFC-1918 private, link-local, cloud metadata, .internal/.local). */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (!h || h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.internal') || h.endsWith('.local') || h === 'metadata.google.internal') return true;
  // IPv6 loopback / link-local / unique-local
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  // IPv4 literal → check private/loopback/link-local/metadata ranges
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}

/** Validate a crawl target: http(s) scheme + non-blocked host. */
export function isSafeCrawlUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return !isBlockedHost(u.hostname);
}

/** Fetch a page with SSRF guard, timeout, NO redirect-following (a 3xx to an
 *  internal host would bypass the host check), and a hard byte cap. */
async function fetchPage(url: string): Promise<string | null> {
  if (!isSafeCrawlUrl(url)) return null;
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(CRAWL_TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (!res.ok || !res.body) return null; // 3xx (manual) / 4xx / 5xx → skip
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > CRAWL_MAX_BYTES) return null;
  // Stream with a hard cap so a huge / slow-drip body can't OOM the instance.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > CRAWL_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

/** Bounded, same-origin website crawl (stdlib fetch + naive link extraction).
 *  SSRF-guarded: only public http(s) hosts, no redirect-following, per-page byte cap. */
export async function crawlWebsite(startUrl: string, maxPages: number): Promise<SourceDoc[]> {
  if (!isSafeCrawlUrl(startUrl)) return [];
  const origin = new URL(startUrl).origin;
  const seen = new Set<string>();
  const queue: string[] = [startUrl];
  const docs: SourceDoc[] = [];
  while (queue.length && docs.length < maxPages) {
    const url = queue.shift() as string;
    if (seen.has(url)) continue;
    seen.add(url);
    const html = await fetchPage(url);
    if (html == null) continue;
    const text = htmlToText(html);
    const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] || url).trim();
    if (text.length > 200) docs.push({ title, url, content: text });
    for (const href of extractLinks(html, url)) {
      if (href.startsWith(origin) && isSafeCrawlUrl(href) && !seen.has(href) && queue.length + docs.length < maxPages)
        queue.push(href);
    }
  }
  return docs;
}

/** Full ingest: sources → chunks → embeddings → upsert. Replaces the KB (full re-index).
 *  Writes require the service-role key (RLS-bypassing); fails loudly otherwise.
 *  Embeds EVERYTHING first, THEN swaps the table — so an embedding/gateway failure
 *  aborts before the wipe and can never leave the KB empty. */
export async function ingest(opts: { docs: SourceDoc[]; embeddingModel: string; batchSize?: number }): Promise<number> {
  const db = supabaseService();

  const rows: Array<{ title: string; url: string | null; content: string; audiences?: string[] }> = [];
  for (const d of opts.docs)
    for (const c of chunk(d.content)) rows.push({ title: d.title, url: d.url, content: c, audiences: d.audiences });

  // 1) Embed all batches up front. Any failure throws BEFORE we touch the table.
  const batch = opts.batchSize ?? 64;
  const payloads: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const vectors = await embed(opts.embeddingModel, slice.map((r) => r.content));
    slice.forEach((r, j) => {
      const row: Record<string, unknown> = {
        title: r.title,
        url: r.url,
        content: r.content,
        embedding: vectors[j] as unknown as string,
      };
      // Only write the column when a doc declared audiences — so installs that
      // haven't run the (optional) migration keep inserting against the DB default.
      if (r.audiences && r.audiences.length) row.audiences = r.audiences;
      payloads.push(row);
    });
  }

  // 2) Now that every vector exists, clear the table and insert the fresh set.
  await db.from('kb_chunks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  let inserted = 0;
  for (let i = 0; i < payloads.length; i += batch) {
    const { error } = await db.from('kb_chunks').insert(payloads.slice(i, i + batch));
    if (error) throw new Error(`ingest insert failed: ${error.message}`);
    inserted += Math.min(batch, payloads.length - i);
  }
  return inserted;
}
