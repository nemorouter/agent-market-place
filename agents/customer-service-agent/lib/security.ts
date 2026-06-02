// lib/security.ts — abuse-protection Layers 1-3 (Layer 4 = the per-day BUDGET on the
// Nemo virtual key, enforced server-side by Nemo — set that in the Nemo dashboard).
//
//   Layer 1  originAllowed()  → blocks other sites embedding the widget
//   Layer 2  rateLimit()      → blocks volume abuse (per IP + per session)
//   Layer 3  verifyCaptcha()  → blocks bots (Cloudflare Turnstile by default)
//
// The in-memory limiter is fine for a single instance / preview. For multi-instance
// production, swap the Map for Upstash/Redis (same function signature).
import type { SecurityConfig } from './config';

/** Layer 1 — exact-host or "*."-wildcard match against the allow-list. */
export function originAllowed(origin: string | null, allow: string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return allow.some((rule) => {
    // Normalize the rule to a bare host. Don't use new URL() here — it throws on the
    // "*" in wildcard rules like https://*.acme.com. Strip scheme + path manually.
    const r = rule.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (r.startsWith('*.')) {
      const base = r.slice(2); // "acme.com"
      return host === base || host.endsWith('.' + base);
    }
    return host === r;
  });
}

/** Layer 2 — fixed-window rate limit (in-memory). Returns true if allowed.
 *  Correct for a SINGLE instance. Across horizontally-scaled instances each one
 *  keeps its own Map, so the effective ceiling is N× — use rateLimitAsync() with
 *  Upstash configured for a shared limit (the production path). */
const hits = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count += 1;
  return true;
}

// ── Distributed rate limit (Upstash Redis REST) — the multi-instance path ────
// Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN and the limit becomes a
// SHARED fixed window across every Cloud Run instance (one INCR+EXPIRE round-trip
// per request). Unconfigured → falls back to the in-memory limiter. On ANY backend
// error (Redis down, timeout, malformed reply) we also fall back to in-memory so a
// limiter outage can never take chat down — abuse is still bounded per instance.
const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

/** Which limiter backend is live — surfaced by /api/health for ops visibility. */
export function rateLimitBackend(): 'redis' | 'memory' {
  return UPSTASH_URL && UPSTASH_TOKEN ? 'redis' : 'memory';
}

export async function rateLimitAsync(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return rateLimit(key, limit, windowMs);
  const seconds = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    // One pipelined round-trip: INCR the window key, then set its TTL only if it's
    // newly created (EXPIRE … NX) so the window slides correctly under concurrency.
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', `rl:${key}`],
        ['EXPIRE', `rl:${key}`, String(seconds), 'NX'],
      ]),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return rateLimit(key, limit, windowMs);
    const data = (await res.json()) as Array<{ result?: number }>;
    const count = data?.[0]?.result;
    if (typeof count !== 'number') return rateLimit(key, limit, windowMs);
    return count <= limit;
  } catch {
    return rateLimit(key, limit, windowMs); // fail to local limiter — never break chat
  }
}

// ── Inbound payload caps — DoS / cost-blowup protection ──────────────────────
export interface PayloadLimits {
  maxMessages: number;
  maxMessageChars: number;
  maxTotalChars: number;
}

/** Validate + bound the chat `messages` array BEFORE any model/embedding call.
 *  Pure + dependency-free → unit-testable. Rejects oversized or malformed
 *  payloads with a stable error code the route maps to 413/400. */
export function validateChatPayload(
  messages: unknown,
  limits: PayloadLimits,
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, error: 'messages_required' };
  if (messages.length > limits.maxMessages) return { ok: false, error: 'too_many_messages' };
  let total = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') return { ok: false, error: 'bad_message' };
    const role = (m as { role?: unknown }).role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') return { ok: false, error: 'bad_role' };
    const content = (m as { content?: unknown }).content;
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    if (text.length > limits.maxMessageChars) return { ok: false, error: 'message_too_long' };
    total += text.length;
    if (total > limits.maxTotalChars) return { ok: false, error: 'payload_too_large' };
  }
  return { ok: true };
}

/** Layer 3 — verify a captcha token. Default provider: Cloudflare Turnstile. */
export async function verifyCaptcha(
  cfg: SecurityConfig['captcha'],
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  if (!cfg.enabled) return true;
  if (!token) return false;
  if (cfg.provider !== 'turnstile') return true; // implement hcaptcha/recaptcha here if needed
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: cfg.secretKey, response: token, remoteip: ip }),
  });
  const json = (await res.json()) as { success: boolean };
  return json.success;
}

export function clientIp(headers: Headers): string {
  return (
    (headers.get('x-forwarded-for') || '').split(',')[0].trim() || headers.get('x-real-ip') || 'unknown'
  );
}

/** "after_3_messages" → 3 ; "always" → 0 */
export function captchaTriggerCount(trigger: string): number {
  const m = trigger.match(/after_(\d+)_messages/);
  return m ? Number(m[1]) : 0;
}
