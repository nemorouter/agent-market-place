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
  };
}
