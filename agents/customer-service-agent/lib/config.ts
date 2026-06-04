// lib/config.ts — typed agent configuration, loaded from environment variables.
//
// The agent.config.yaml in this folder is the human-readable manifest; these env
// vars are the runtime source of truth (12-factor, Vercel-friendly). A Phase-2
// admin UI can override these from a row in the customer's OWN Supabase.

export interface SecurityConfig {
  allowedOrigins: string[]; // exact hosts + "*." wildcards, e.g. ["https://acme.com", "https://*.acme.com"]
  rateLimit: { perIpPerMin: number; perSessionPerMin: number; perIpPerDay: number };
  captcha: {
    enabled: boolean;
    provider: 'turnstile' | 'hcaptcha' | 'recaptcha';
    trigger: string; // "always" | "after_N_messages"
    secretKey?: string;
  };
  /** Hard caps on the inbound chat payload — DoS / cost-blowup protection (enterprise). */
  limits: { maxMessages: number; maxMessageChars: number; maxTotalChars: number };
  requireEmail: boolean;
}

/** Pluggable login/personalization layer — see lib/identity.ts. All env-driven. */
export interface IdentityConfig {
  mode: 'none' | 'jwt' | 'header' | 'introspect' | 'custom';
  /** jwt mode: cookie holding the signed JWT. */
  cookieName: string;
  /** jwt mode: HS256 shared secret. */
  jwtSecret?: string;
  /** Claim/field name mapping (works for jwt + introspect + header). */
  claims: { name: string; id: string; email: string; attributes: string[] };
  /** header mode: the trusted name header + "attrKey:header-name" attribute pairs. */
  header: { name: string; attributes: string[] };
  /** introspect mode: the fork's own "who am I" URL (receives forwarded cookies). */
  introspectUrl?: string;
  /** Inject a "greet by name" instruction when signed in. */
  greet: boolean;
  /** Personalized links; url/label may contain {attr} placeholders. */
  linksTemplate: Array<{ label: string; url: string }>;
  /** Which attribute (e.g. "plan") becomes the extra retrieval audience tag. */
  docAudienceAttr?: string;
}

/** Web-search fallback — escalate to the gateway `web_search` tool when the KB
 *  can't answer (low confidence) or the user explicitly asks to search the web. */
export interface WebSearchConfig {
  /** Master switch. When off, no web-search escalation ever runs. */
  enabled: boolean;
  /** Auto-run web search when retrieval confidence is LOW (else only on explicit request). */
  autoOnLowConfidence: boolean;
  /** Confidence thresholds (topSimilarity): >= high → 'high', < low → 'low'. */
  confidenceHigh: number;
  confidenceLow: number;
  /** Restrict the fallback to a single SITE (e.g. "nemorouter.ai") via the Google
   *  `site:` operator — "if it's not in the docs, search OUR website". Empty = whole web.
   *  Defaults to the domain of WEBSITE_URL so a fork auto-scopes to its own site. */
  site: string;
}

/** Extract a bare host ("nemorouter.ai") from a URL or host string. '' on junk. */
export function domainOf(v: string | undefined): string {
  if (!v || !v.trim()) return '';
  let h = v.trim();
  try {
    h = new URL(h.includes('://') ? h : `https://${h}`).hostname;
  } catch {
    return '';
  }
  return h.replace(/^www\./i, '');
}

export interface AgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  /** Chat model OR a Nemo model_group alias — Nemo applies routing/fallback for the alias. */
  model: string;
  /** Embedding model Nemo serves; MUST match the vector() dimension in supabase/migration.sql. */
  embeddingModel: string;
  /** Max RAG chunks injected into the prompt. */
  topK: number;
  /** Max agent loop steps (reserved for tool use in Phase 2). */
  maxSteps: number;
  /** Optional Nemo guardrail ids to apply per-request, ON TOP of the key's server-side defaults. */
  guardrails: string[];
  security: SecurityConfig;
  identity: IdentityConfig;
  webSearch: WebSearchConfig;
}

const list = (v: string | undefined, fallback: string[] = []): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;
const num = (v: string | undefined, d: number): number => (Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: string | undefined, d = false): boolean => (v == null ? d : /^(1|true|yes|on)$/i.test(v));
/** Parse a JSON array env var (e.g. IDENTITY_LINKS); tolerant — returns [] on junk. */
function jsonLinks(v: string | undefined): Array<{ label: string; url: string }> {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr)
      ? arr.filter((l) => l && typeof l.label === 'string' && typeof l.url === 'string')
      : [];
  } catch {
    return [];
  }
}

export function loadConfig(): AgentConfig {
  const env = process.env;
  return {
    id: env.AGENT_ID || 'support-agent',
    name: env.AGENT_NAME || 'Support Agent',
    systemPrompt:
      env.SYSTEM_PROMPT ||
      'You are a helpful support assistant. Answer ONLY from the provided context. ' +
        'If the context does not cover the question, say so plainly and offer to escalate. Keep answers concise.',
    model: env.MODEL || 'gemini-2.5-flash-lite',
    embeddingModel: env.EMBEDDING_MODEL || 'text-embedding-005',
    topK: num(env.TOP_K, 6),
    maxSteps: num(env.MAX_STEPS, 4),
    guardrails: list(env.GUARDRAILS),
    security: {
      allowedOrigins: list(env.ALLOWED_ORIGINS, ['http://localhost:3000']),
      rateLimit: {
        perIpPerMin: num(env.RATE_LIMIT_PER_IP_PER_MIN, 20),
        perSessionPerMin: num(env.RATE_LIMIT_PER_SESSION_PER_MIN, 10),
        perIpPerDay: num(env.RATE_LIMIT_PER_IP_PER_DAY, 500),
      },
      captcha: {
        enabled: bool(env.CAPTCHA_ENABLED),
        provider: (env.CAPTCHA_PROVIDER as SecurityConfig['captcha']['provider']) || 'turnstile',
        trigger: env.CAPTCHA_TRIGGER || 'after_3_messages',
        secretKey: env.CAPTCHA_SECRET_KEY,
      },
      limits: {
        maxMessages: num(env.MAX_MESSAGES, 60),
        maxMessageChars: num(env.MAX_MESSAGE_CHARS, 12_000),
        maxTotalChars: num(env.MAX_TOTAL_CHARS, 60_000),
      },
      requireEmail: bool(env.REQUIRE_EMAIL),
    },
    identity: {
      mode: (env.IDENTITY_MODE as IdentityConfig['mode']) || 'none',
      cookieName: env.IDENTITY_COOKIE || 'session',
      jwtSecret: env.IDENTITY_JWT_SECRET,
      claims: {
        name: env.IDENTITY_CLAIM_NAME || 'name',
        id: env.IDENTITY_CLAIM_ID || 'sub',
        email: env.IDENTITY_CLAIM_EMAIL || 'email',
        attributes: list(env.IDENTITY_CLAIM_ATTRIBUTES), // e.g. "org,plan,tier"
      },
      header: {
        name: (env.IDENTITY_HEADER || 'x-forwarded-user').toLowerCase(),
        attributes: list(env.IDENTITY_HEADER_ATTRIBUTES), // e.g. "org:x-forwarded-org,plan:x-plan"
      },
      introspectUrl: env.IDENTITY_INTROSPECT_URL,
      greet: bool(env.IDENTITY_GREET, true),
      linksTemplate: jsonLinks(env.IDENTITY_LINKS),
      docAudienceAttr: env.IDENTITY_DOC_AUDIENCE_ATTR,
    },
    webSearch: {
      // Defaults ON + auto: the whole point is to rescue unanswered questions. It
      // still degrades gracefully when the gateway tool isn't deployed (lib/web-search.ts).
      enabled: bool(env.WEB_SEARCH_ENABLED, true),
      autoOnLowConfidence: bool(env.WEB_SEARCH_AUTO_ON_LOW_CONFIDENCE, true),
      // Calibrated for text-embedding-005: on-topic KB matches cluster ~0.55-0.65,
      // off-topic ~0.35. high>=0.55 → "high"; <0.45 → "low" (auto web-search). Tune
      // per embedding model via env — a different model shifts the whole distribution.
      confidenceHigh: num(env.CONFIDENCE_HIGH, 0.55),
      confidenceLow: num(env.CONFIDENCE_LOW, 0.45),
      // "Not in the docs? search our website." Defaults to the agent's own WEBSITE_URL
      // domain (e.g. nemorouter.ai); set WEB_SEARCH_SITE='' to allow whole-web search.
      site: env.WEB_SEARCH_SITE != null ? domainOf(env.WEB_SEARCH_SITE) : domainOf(env.WEBSITE_URL),
    },
  };
}
