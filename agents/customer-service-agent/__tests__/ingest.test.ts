import { describe, it, expect } from 'vitest';
import { chunk, parseAudiences, isBlockedHost, isSafeCrawlUrl, parseSeedUrls, buildEmbedBatches } from '../lib/ingest';

describe('chunk', () => {
  it('returns a single chunk for short text', () => {
    expect(chunk('hello world')).toEqual(['hello world']);
  });
  it('returns nothing for empty/whitespace', () => {
    expect(chunk('   \n  ')).toEqual([]);
  });
  it('splits long text into overlapping chunks', () => {
    const text = 'a'.repeat(3000);
    const chunks = chunk(text);
    expect(chunks.length).toBeGreaterThan(1);
    // every chunk is within the size bound
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1200);
    // reassembling (minus overlap) covers the whole input
    expect(chunks.join('').length).toBeGreaterThanOrEqual(text.length);
  });
  it('collapses excessive blank lines', () => {
    expect(chunk('a\n\n\n\n\nb')).toEqual(['a\n\nb']);
  });
});

describe('parseAudiences', () => {
  it('returns undefined when there is no frontmatter (stays public)', () => {
    expect(parseAudiences('# Title\n\nbody')).toBeUndefined();
  });
  it('returns undefined when frontmatter omits audiences', () => {
    expect(parseAudiences('---\ntitle: X\n---\nbody')).toBeUndefined();
  });
  it('parses a bracketed list', () => {
    expect(parseAudiences('---\naudiences: [pro, enterprise]\n---\nbody')).toEqual(['pro', 'enterprise']);
  });
  it('parses a comma list and a single value', () => {
    expect(parseAudiences('---\naudiences: pro, enterprise\n---\n')).toEqual(['pro', 'enterprise']);
    expect(parseAudiences('---\naudiences: pro\n---\n')).toEqual(['pro']);
  });
  it('strips quotes', () => {
    expect(parseAudiences('---\naudiences: ["pro", \'beta\']\n---\n')).toEqual(['pro', 'beta']);
  });
});

describe('isBlockedHost (SSRF guard)', () => {
  it('blocks loopback, private, link-local, CGNAT and metadata addresses', () => {
    for (const h of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1'])
      expect(isBlockedHost(h)).toBe(true);
  });
  it('blocks internal/local/metadata hostnames', () => {
    for (const h of ['localhost', 'foo.internal', 'svc.local', 'metadata.google.internal'])
      expect(isBlockedHost(h)).toBe(true);
  });
  it('allows ordinary public hosts', () => {
    for (const h of ['example.com', 'docs.acme.io', '8.8.8.8']) expect(isBlockedHost(h)).toBe(false);
  });
});

describe('isSafeCrawlUrl', () => {
  it('allows public http(s) URLs', () => {
    expect(isSafeCrawlUrl('https://acme.com/docs')).toBe(true);
    expect(isSafeCrawlUrl('http://acme.com')).toBe(true);
  });
  it('rejects non-http schemes and internal/metadata targets', () => {
    for (const u of [
      'ftp://acme.com',
      'file:///etc/passwd',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000',
      'not a url',
    ])
      expect(isSafeCrawlUrl(u)).toBe(false);
  });
});

describe('parseSeedUrls', () => {
  it('returns [] for empty/undefined', () => {
    expect(parseSeedUrls(undefined)).toEqual([]);
    expect(parseSeedUrls('')).toEqual([]);
    expect(parseSeedUrls('   ')).toEqual([]);
  });
  it('splits on commas and whitespace/newlines', () => {
    expect(parseSeedUrls('https://a.com/x, https://a.com/y\nhttps://a.com/z')).toEqual([
      'https://a.com/x',
      'https://a.com/y',
      'https://a.com/z',
    ]);
  });
  it('de-dupes repeated URLs', () => {
    expect(parseSeedUrls('https://a.com/x, https://a.com/x')).toEqual(['https://a.com/x']);
  });
  it('drops unsafe (SSRF) and malformed entries', () => {
    expect(
      parseSeedUrls('https://a.com/ok, http://localhost/x, file:///etc/passwd, http://169.254.169.254/, not-a-url'),
    ).toEqual(['https://a.com/ok']);
  });
});

describe('buildEmbedBatches (token-budgeted batching)', () => {
  const rows = (n: number, len: number) => Array.from({ length: n }, (_, i) => ({ id: i, content: 'x'.repeat(len) }));

  it('splits by char budget before the count cap (the Vertex 20k-token bug)', () => {
    // 64×1200 chars = 76,800 > 40k budget → must split into multiple batches,
    // NOT one over-budget request (which Vertex rejects with 400).
    const batches = buildEmbedBatches(rows(64, 1200));
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) {
      const chars = b.reduce((a, r) => a + r.content.length, 0);
      expect(chars).toBeLessThanOrEqual(40_000);
      expect(b.length).toBeLessThanOrEqual(64);
    }
    // every row is covered exactly once
    expect(batches.reduce((a, b) => a + b.length, 0)).toBe(64);
  });

  it('caps by count when chunks are tiny', () => {
    const batches = buildEmbedBatches(rows(200, 10), { maxChars: 1_000_000, maxCount: 64 });
    expect(batches.every((b) => b.length <= 64)).toBe(true);
    expect(batches.reduce((a, b) => a + b.length, 0)).toBe(200);
  });

  it('keeps an over-budget single row in its own batch (never drops it)', () => {
    const batches = buildEmbedBatches([{ content: 'x'.repeat(50_000) }], { maxChars: 40_000 });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });

  it('returns [] for no rows', () => {
    expect(buildEmbedBatches([])).toEqual([]);
  });
});
