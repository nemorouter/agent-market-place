// lib/gaps.ts — continuous learning: capture what the agent COULDN'T answer.
//
// Every low-confidence answer (the KB didn't cover it) is logged to `chat_gaps`,
// fire-and-forget, off the hot path. The /admin "Knowledge gaps" report groups these
// by normalized question and ranks by frequency so an operator sees exactly which docs
// to add — then `npm run ingest` re-embeds and the gap closes. That capture → surface
// → re-ingest cycle IS the continuous-learning loop.
//
// PURE bits (normalizeQuestion, aggregateGaps) are split out for unit testing.

import { supabaseService, supabaseAdmin } from './supabase';

const MAX_Q = 500;

/** Normalize a question into a grouping key: lowercase, strip punctuation, collapse ws. */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_Q);
}

export interface GapRow {
  question: string;
  question_norm: string;
  confidence: string | null;
  web_searched: boolean;
}

export interface GapCluster {
  question: string; // a representative (most recent) phrasing
  questionNorm: string;
  count: number;
  webSearchedRate: number; // fraction that already tried web and still failed
  lastConfidence: string | null;
}

/** Log one knowledge gap. Fire-and-forget — never throws, never blocks chat. */
export async function logGap(
  agentId: string,
  gap: { question: string; confidence?: string | null; webSearched?: boolean },
): Promise<void> {
  const question = (gap.question || '').trim().slice(0, MAX_Q);
  if (!question) return;
  try {
    await supabaseService()
      .from('chat_gaps')
      .insert({
        agent_id: agentId,
        question,
        question_norm: normalizeQuestion(question),
        confidence: gap.confidence ?? null,
        web_searched: gap.webSearched === true,
        resolved: false,
      });
  } catch {
    /* best-effort telemetry — a gap-log failure must never affect the answer */
  }
}

/** PURE: cluster raw gap rows by normalized question, ranked by frequency. */
export function aggregateGaps(rows: GapRow[], limit = 50): GapCluster[] {
  const byNorm = new Map<string, { rows: GapRow[]; sample: string }>();
  for (const r of rows) {
    const k = r.question_norm || normalizeQuestion(r.question);
    if (!k) continue;
    const e = byNorm.get(k) ?? { rows: [], sample: r.question };
    e.rows.push(r);
    e.sample = r.question; // rows come newest-first → keep the latest phrasing
    byNorm.set(k, e);
  }
  const clusters: GapCluster[] = [...byNorm.entries()].map(([k, e]) => ({
    question: e.sample,
    questionNorm: k,
    count: e.rows.length,
    webSearchedRate: e.rows.filter((r) => r.web_searched).length / e.rows.length,
    lastConfidence: e.rows[0]?.confidence ?? null,
  }));
  clusters.sort((a, b) => b.count - a.count || a.question.localeCompare(b.question));
  return clusters.slice(0, limit);
}

/** Read recent gaps (newest first) and return the ranked clusters. Never throws → []. */
export async function topGaps(agentId: string, opts?: { sampleSize?: number; limit?: number }): Promise<GapCluster[]> {
  const sampleSize = opts?.sampleSize ?? 1000;
  try {
    const { data, error } = await supabaseAdmin()
      .from('chat_gaps')
      .select('question,question_norm,confidence,web_searched')
      .eq('agent_id', agentId)
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(sampleSize);
    if (error || !Array.isArray(data)) return [];
    return aggregateGaps(data as GapRow[], opts?.limit ?? 50);
  } catch {
    return [];
  }
}
