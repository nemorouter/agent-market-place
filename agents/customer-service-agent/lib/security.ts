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

/** Layer 2 — fixed-window rate limit. Returns true if the request is allowed. */
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
