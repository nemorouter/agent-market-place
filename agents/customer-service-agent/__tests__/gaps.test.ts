import { describe, it, expect } from 'vitest';
import { normalizeQuestion, aggregateGaps, type GapRow } from '../lib/gaps';

describe('normalizeQuestion', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeQuestion('  What is the LEGAL email??? ')).toBe('what is the legal email');
  });
  it('groups trivially different phrasings to the same key', () => {
    expect(normalizeQuestion('What is the legal email?')).toBe(normalizeQuestion('what is   the legal email'));
  });
  it('keeps unicode letters/numbers', () => {
    expect(normalizeQuestion('Plan 2 — café?')).toBe('plan 2 café');
  });
});

const row = (q: string, web = false, conf: string | null = 'low'): GapRow => ({
  question: q,
  question_norm: normalizeQuestion(q),
  confidence: conf,
  web_searched: web,
});

describe('aggregateGaps', () => {
  it('clusters by normalized question and ranks by frequency', () => {
    const rows = [
      row('What is the legal email?'),
      row('what is the legal email'),
      row('Do you have a 2 min video?', true),
    ];
    const out = aggregateGaps(rows);
    expect(out[0].count).toBe(2); // the two legal-email phrasings collapse
    expect(out[0].questionNorm).toBe('what is the legal email');
    expect(out[1].count).toBe(1);
  });

  it('computes the web-searched rate per cluster', () => {
    const rows = [row('x', true), row('x', false), row('x', true)];
    const out = aggregateGaps(rows);
    expect(out[0].count).toBe(3);
    expect(out[0].webSearchedRate).toBeCloseTo(2 / 3, 5);
  });

  it('keeps the most recent phrasing as the representative (rows are newest-first)', () => {
    const out = aggregateGaps([row('Legal EMAIL please'), row('what is the legal email')]);
    expect(out[0].question).toBe('Legal EMAIL please');
  });

  it('honors the limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`q${i}`));
    expect(aggregateGaps(rows, 3)).toHaveLength(3);
  });

  it('empty input → empty', () => {
    expect(aggregateGaps([])).toEqual([]);
  });
});
