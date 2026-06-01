import { describe, it, expect } from 'vitest';
import { chunk, parseAudiences } from '../lib/ingest';

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
