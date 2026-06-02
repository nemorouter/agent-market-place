import { describe, it, expect } from 'vitest';
import { chunk, parseAudiences, isBlockedHost, isSafeCrawlUrl } from '../lib/ingest';

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
