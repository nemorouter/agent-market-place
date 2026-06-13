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

/** Page-context hardening — the widget forwards the page the visitor is on (e.g.
 *  "/onboarding") so the agent can give page-aware help. The value is BROWSER-supplied
 *  and therefore untrusted: we keep the PATHNAME ONLY (query/hash dropped — they can
 *  carry session tokens / PII), strip control chars (no prompt-injection line breaks),
 *  normalize a leading slash, and bound the length. Returns null for unusable input. */
export function sanitizePageContext(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  // A full URL → reduce to its pathname (drops scheme, host, query, hash).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname;
    } catch {
      return null;
    }
  } else {
    // Bare path → drop query (?) and hash (#) ourselves.
    s = s.split('#')[0].split('?')[0];
  }
  // Strip control chars / newlines so it can't break out of its prompt line.
  s = s.replace(/[\x00-\x1f\x7f]/g, '');
  if (!s) return null;
  if (!s.startsWith('/')) s = '/' + s;
  return s.slice(0, 256);
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

/** Layer 3 — verify a captcha token. Default provider: Cloudflare Turnstile.
 *  FAILS CLOSED: an enabled-but-unimplemented provider, a siteverify outage, or a
 *  malformed reply all return false (request is challenged) — never silently passes,
 *  and never throws (the caller checks this BEFORE its try/catch). */
export async function verifyCaptcha(
  cfg: SecurityConfig['captcha'],
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  if (!cfg.enabled) return true;
  if (!token) return false;
  // Only Turnstile is implemented. Any other configured provider must NOT pass
  // unverified — fail closed until that backend is wired up.
  if (cfg.provider !== 'turnstile') return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: cfg.secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false; // siteverify down / timeout / non-JSON → challenge the request
  }
}

// Number of TRUSTED reverse-proxy hops between the real client and this app. A client
// can freely PREPEND X-Forwarded-For entries, but each trusted proxy APPENDS the peer it
// saw at the right end — so the true client sits `hops` entries from the right and the
// leftmost token is fully attacker-controlled. The real client index is `len - hops`
// (hops=1 → rightmost, the entry our own infra set). Set this to how many proxies you
// actually run (Cloud Run behind Google's LB = 1). Default 1.
const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1) || 1);

/** Best-effort client IP for rate-limit keying. Picks the X-Forwarded-For entry our
 *  trusted proxy appended (`len - hops`, clamped), which a caller cannot forge — falling
 *  back to x-real-ip then 'unknown'. Taking the leftmost token (the old behavior) let any
 *  caller rotate the key with a forged header and defeat every per-IP limit. */
export function clientIp(headers: Headers): string {
  const xff = (headers.get('x-forwarded-for') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (xff.length) {
    const idx = Math.min(xff.length - 1, Math.max(0, xff.length - TRUSTED_PROXY_HOPS));
    return xff[idx];
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/** "after_3_messages" → 3 ; "always" → 0 */
export function captchaTriggerCount(trigger: string): number {
  const m = trigger.match(/after_(\d+)_messages/);
  return m ? Number(m[1]) : 0;
}
