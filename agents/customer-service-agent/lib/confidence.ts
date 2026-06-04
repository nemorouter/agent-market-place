// lib/confidence.ts — how sure are we the KB actually answers this question?
//
// PURE + dependency-free so it's trivially unit-testable. The chat route feeds it
// the RAG chunks' cosine similarities (match_chunks returns `similarity = 1 - dist`,
// ~0..1) and gets back a level + score. The level drives two things:
//   • the widget shows a confidence badge after the answer, and
//   • a LOW level auto-triggers the web-search fallback (lib/web-search.ts).
//
// Thresholds are operator-tunable (env / settings) — different KBs cluster
// differently, so a fixed cutoff would be wrong for some forks.

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceThresholds {
  /** topSimilarity >= high  → 'high'. */
  high: number;
  /** topSimilarity <  low   → 'low'. */
  low: number;
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = { high: 0.78, low: 0.62 };

export interface ConfidenceResult {
  level: ConfidenceLevel;
  /** 0..1, rounded to 2dp — the strongest single chunk's similarity. */
  score: number;
  /** How many retrieved chunks cleared the `low` bar (a breadth signal). */
  supportingChunks: number;
}

interface SimilarityBearing {
  similarity?: number | null;
}

/** Clamp + round a raw similarity to a clean 0..1, 2-dp number. */
function norm(s: unknown): number {
  const n = typeof s === 'number' && Number.isFinite(s) ? s : 0;
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

/**
 * Score how confident we are that the retrieved chunks answer the question.
 * No chunks → low / 0. Otherwise level is from the single strongest chunk
 * (topSimilarity), which is what actually grounds the answer.
 */
export function scoreConfidence(
  chunks: ReadonlyArray<SimilarityBearing>,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
): ConfidenceResult {
  if (!chunks.length) return { level: 'low', score: 0, supportingChunks: 0 };
  const sims = chunks.map((c) => norm(c.similarity));
  const score = Math.max(...sims);
  const supportingChunks = sims.filter((s) => s >= thresholds.low).length;
  const level: ConfidenceLevel = score >= thresholds.high ? 'high' : score < thresholds.low ? 'low' : 'medium';
  return { level, score, supportingChunks };
}
