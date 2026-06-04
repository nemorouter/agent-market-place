import { describe, it, expect } from 'vitest';
import { scoreConfidence, DEFAULT_CONFIDENCE_THRESHOLDS } from '../lib/confidence';

describe('scoreConfidence', () => {
  it('no chunks → low, score 0', () => {
    expect(scoreConfidence([])).toEqual({ level: 'low', score: 0, supportingChunks: 0 });
  });

  it('strong top similarity → high', () => {
    const r = scoreConfidence([{ similarity: 0.91 }, { similarity: 0.4 }]);
    expect(r.level).toBe('high');
    expect(r.score).toBe(0.91);
    expect(r.supportingChunks).toBe(1); // only 0.91 clears the 0.62 low bar
  });

  it('mid top similarity → medium', () => {
    expect(scoreConfidence([{ similarity: 0.7 }]).level).toBe('medium');
  });

  it('weak top similarity → low (drives web-search fallback)', () => {
    expect(scoreConfidence([{ similarity: 0.3 }, { similarity: 0.1 }]).level).toBe('low');
  });

  it('uses the STRONGEST chunk, not the first', () => {
    expect(scoreConfidence([{ similarity: 0.2 }, { similarity: 0.85 }]).score).toBe(0.85);
  });

  it('clamps + rounds out-of-range / junk similarities', () => {
    expect(scoreConfidence([{ similarity: 1.7 }]).score).toBe(1);
    expect(scoreConfidence([{ similarity: -3 }]).score).toBe(0);
    expect(scoreConfidence([{ similarity: undefined }]).score).toBe(0);
    expect(scoreConfidence([{ similarity: NaN as unknown as number }]).score).toBe(0);
  });

  it('honors custom thresholds', () => {
    const t = { high: 0.5, low: 0.2 };
    expect(scoreConfidence([{ similarity: 0.55 }], t).level).toBe('high');
    expect(scoreConfidence([{ similarity: 0.55 }], DEFAULT_CONFIDENCE_THRESHOLDS).level).toBe('low');
  });
});
