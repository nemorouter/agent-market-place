// lib/feedback.ts — persist a 👍/👎 rating on an answer.
//
// Writes to the agent's OWN Supabase (`chat_feedback`) with the service-role key.
// PURE validation (validateFeedback) is split out so it's unit-testable without a DB.
// Persistence is best-effort to the CALLER's contract: the route decides whether a
// write failure is surfaced (it returns 200 either way — feedback must never feel
// broken to a visitor), but we DO bound + sanitize every field before storing.

import { supabaseService } from './supabase';

export type Rating = 'up' | 'down';

export interface FeedbackInput {
  rating: Rating;
  sessionId: string;
  messageId?: string;
  question?: string;
  confidence?: string;
  webSearched?: boolean;
  /** Why the answer was unhelpful (only meaningful for a 👎): a reason code or free text. */
  reason?: string;
}

export interface ValidFeedback {
  rating: Rating;
  sessionId: string;
  messageId: string | null;
  question: string | null;
  confidence: string | null;
  webSearched: boolean;
  reason: string | null;
}

const MAX_ID = 200;
const MAX_QUESTION = 2_000;
const MAX_CONFIDENCE = 16;
const MAX_REASON = 280;

function clip(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/** Validate + bound an inbound feedback payload. Returns null when unusable. */
export function validateFeedback(body: unknown): ValidFeedback | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.rating !== 'up' && b.rating !== 'down') return null;
  const sessionId = clip(b.sessionId, MAX_ID);
  if (!sessionId) return null;
  return {
    rating: b.rating,
    sessionId,
    messageId: clip(b.messageId, MAX_ID),
    question: clip(b.question, MAX_QUESTION),
    confidence: clip(b.confidence, MAX_CONFIDENCE),
    webSearched: b.webSearched === true,
    // Reason only carries for a 👎 (why it wasn't helpful); ignored for 👍.
    reason: b.rating === 'down' ? clip(b.reason, MAX_REASON) : null,
  };
}

/** Insert one feedback row. Throws on a real write failure (route swallows it). */
export async function saveFeedback(agentId: string, fb: ValidFeedback): Promise<void> {
  const { error } = await supabaseService()
    .from('chat_feedback')
    .insert({
      agent_id: agentId,
      session_id: fb.sessionId,
      message_id: fb.messageId,
      rating: fb.rating,
      question: fb.question,
      confidence: fb.confidence,
      web_searched: fb.webSearched,
      reason: fb.reason,
    });
  if (error) throw new Error(error.message);
}
