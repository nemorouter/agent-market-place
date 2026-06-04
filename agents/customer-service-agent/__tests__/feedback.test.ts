import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateFeedback } from '../lib/feedback';

describe('validateFeedback (pure)', () => {
  it('accepts a minimal valid 👍', () => {
    expect(validateFeedback({ rating: 'up', sessionId: 's1' })).toEqual({
      rating: 'up',
      sessionId: 's1',
      messageId: null,
      question: null,
      confidence: null,
      webSearched: false,
    });
  });

  it('keeps + bounds optional fields', () => {
    const fb = validateFeedback({
      rating: 'down',
      sessionId: 's2',
      messageId: 'm2',
      question: 'why?',
      confidence: 'low',
      webSearched: true,
    });
    expect(fb).toMatchObject({ rating: 'down', messageId: 'm2', question: 'why?', confidence: 'low', webSearched: true });
  });

  it('rejects bad/missing rating', () => {
    expect(validateFeedback({ rating: 'meh', sessionId: 's' })).toBeNull();
    expect(validateFeedback({ sessionId: 's' })).toBeNull();
  });

  it('rejects missing sessionId', () => {
    expect(validateFeedback({ rating: 'up' })).toBeNull();
    expect(validateFeedback({ rating: 'up', sessionId: '   ' })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(validateFeedback(null)).toBeNull();
    expect(validateFeedback('up')).toBeNull();
  });

  it('caps an over-long question', () => {
    const fb = validateFeedback({ rating: 'down', sessionId: 's', question: 'x'.repeat(5000) });
    expect(fb!.question!.length).toBe(2000);
  });

  it('webSearched only true when strictly === true', () => {
    expect(validateFeedback({ rating: 'up', sessionId: 's', webSearched: 'yes' })!.webSearched).toBe(false);
    expect(validateFeedback({ rating: 'up', sessionId: 's', webSearched: 1 })!.webSearched).toBe(false);
  });
});

// ── Route: origin + rate-limit + graceful persistence ────────────────────────
const saveFeedback = vi.fn();
vi.mock('../lib/feedback', async (orig) => ({
  ...(await orig<typeof import('../lib/feedback')>()),
  saveFeedback: (...a: unknown[]) => saveFeedback(...a),
}));

const { POST } = await import('../app/api/feedback/route');

const ORIGIN = 'https://acme.com';
const post = (bodyObj: unknown, origin = ORIGIN) =>
  new Request('http://localhost/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': `1.2.3.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(bodyObj),
  });

beforeEach(() => {
  process.env.ALLOWED_ORIGINS = ORIGIN;
  saveFeedback.mockReset();
});
afterEach(() => {
  delete process.env.ALLOWED_ORIGINS;
});

describe('POST /api/feedback', () => {
  it('403 from a disallowed origin (no DB write)', async () => {
    const res = await POST(post({ rating: 'up', sessionId: 's' }, 'https://evil.com'));
    expect(res.status).toBe(403);
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  it('400 on an invalid payload', async () => {
    const res = await POST(post({ rating: 'sideways', sessionId: 's' }));
    expect(res.status).toBe(400);
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  it('200 + stored:true on a valid rating', async () => {
    saveFeedback.mockResolvedValueOnce(undefined);
    const res = await POST(post({ rating: 'down', sessionId: 's', confidence: 'low' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: true });
    expect(saveFeedback).toHaveBeenCalledOnce();
  });

  it('still 200 (stored:false) when persistence throws — never breaks the visitor', async () => {
    saveFeedback.mockRejectedValueOnce(new Error('db down'));
    const res = await POST(post({ rating: 'up', sessionId: 's' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: false });
  });
});
