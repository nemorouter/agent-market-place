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
}

const list = (v: string | undefined, fallback: string[] = []): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;
const num = (v: string | undefined, d: number): number => (Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: string | undefined, d = false): boolean => (v == null ? d : /^(1|true|yes|on)$/i.test(v));

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
    embeddingModel: env.EMBEDDING_MODEL || 'text-embedding-3-small',
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
  };
}
