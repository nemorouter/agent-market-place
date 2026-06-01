// lib/settings.ts — the OPERATOR-EDITABLE presentation + behavior layer.
//
// `lib/config.ts` is the 12-factor, env-driven runtime source of truth (keys,
// origins, rate limits, identity). THIS layer is the subset an operator tunes
// from the /admin dashboard WITHOUT a redeploy: the agent's name, system prompt,
// model, the suggestion chips, the quick links, and the contact methods (phone,
// email, support URL) shown in the widget.
//
// Resolution order (last wins): built-in defaults → env vars → a row in the
// operator's OWN Supabase (`agent_config`, written by the dashboard). The Supabase
// overlay is best-effort: ANY failure (no table, no Supabase, network) degrades to
// the env/built-in defaults — mirroring lib/identity.ts, presentation must NEVER
// break the chat path. Hrefs are sanitized everywhere (no javascript:/data: links).

import { loadConfig, type AgentConfig } from './config';
import { supabaseAdmin } from './supabase';

export type ContactType = 'phone' | 'email' | 'url';
export interface ContactMethod {
  type: ContactType;
  label: string;
  value: string;
}
export interface QuickLink {
  label: string;
  href: string;
}

/** The full editable surface. systemPrompt/model/greet are SERVER-ONLY. */
export interface AgentSettings {
  agentName: string;
  systemPrompt: string;
  model: string;
  greet: boolean;
  suggestions: string[];
  quickLinks: QuickLink[];
  contactMethods: ContactMethod[];
}

/** The browser-facing projection — ONLY presentation fields cross the wire. */
export interface PublicSettings {
  agentName: string;
  suggestions: string[];
  quickLinks: QuickLink[];
  contactMethods: ContactMethod[];
}

// Built-in fallbacks — used when neither env nor Supabase supplies a value. These
// mirror the constants the widget historically hardcoded, so an un-configured fork
// looks exactly like before.
const DEFAULT_SUGGESTIONS = [
  'How does the platform fee work?',
  'Which models are live today?',
  'Is it OpenAI-compatible?',
  'How is this different from OpenRouter?',
];
const DEFAULT_QUICK_LINKS: QuickLink[] = [
  { label: 'Models', href: '/models' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Docs', href: '/docs' },
  { label: 'Playground', href: '/playground' },
];
const DEFAULT_CONTACT_METHODS: ContactMethod[] = [
  { type: 'phone', label: 'Call sales', value: '+1 (555) 010-2030' },
  { type: 'email', label: 'Email support', value: 'support@nemorouter.ai' },
  { type: 'url', label: 'Contact us', value: '/contact' },
];

// Schemes we render as-is. Everything else (javascript:, data:, vbscript:, ftp:…)
// is rejected. Site-relative ("/docs") and protocol-relative-free absolutes pass.
const SAFE_SCHEME = /^(https?|tel|mailto|sms):/i;

/** Return a render-safe href, or null if it uses a disallowed scheme. */
export function sanitizeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  if (!h) return null;
  if (h.startsWith('/')) return h; // site-relative
  if (SAFE_SCHEME.test(h)) return h;
  return null;
}

/** The clickable href for a contact method, or null if it can't be made safe. */
export function contactHref(m: ContactMethod): string | null {
  if (m.type === 'phone') {
    // Keep a single leading +, strip every other non-digit (spaces, dashes, parens).
    const lead = m.value.trim().startsWith('+') ? '+' : '';
    const digits = m.value.replace(/[^\d]/g, '');
    return digits ? `tel:${lead}${digits}` : null;
  }
  if (m.type === 'email') {
    const e = m.value.trim();
    return e ? `mailto:${e}` : null;
  }
  return sanitizeHref(m.value);
}

function isContactType(v: unknown): v is ContactType {
  return v === 'phone' || v === 'email' || v === 'url';
}

/** Keep only well-typed contact methods whose value resolves to a safe href. */
function sanitizeContactMethods(arr: unknown): ContactMethod[] {
  if (!Array.isArray(arr)) return [];
  const out: ContactMethod[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (!isContactType(r.type)) continue;
    if (typeof r.label !== 'string' || !r.label.trim()) continue;
    if (typeof r.value !== 'string' || !r.value.trim()) continue;
    const m: ContactMethod = { type: r.type, label: r.label.trim(), value: r.value.trim() };
    if (contactHref(m)) out.push(m);
  }
  return out;
}

/** Keep only links with a label + a safe href. */
function sanitizeQuickLinks(arr: unknown): QuickLink[] {
  if (!Array.isArray(arr)) return [];
  const out: QuickLink[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.label !== 'string' || !r.label.trim()) continue;
    const href = sanitizeHref(r.href);
    if (!href) continue;
    out.push({ label: r.label.trim(), href });
  }
  return out;
}

/** Parse the CONTACT_METHODS env / stored JSON (tolerant — [] on junk). */
export function parseContactMethods(v: string | undefined): ContactMethod[] {
  if (!v) return [];
  try {
    return sanitizeContactMethods(JSON.parse(v));
  } catch {
    return [];
  }
}

/** Parse the QUICK_LINKS env / stored JSON (tolerant — [] on junk). */
export function parseQuickLinks(v: string | undefined): QuickLink[] {
  if (!v) return [];
  try {
    return sanitizeQuickLinks(JSON.parse(v));
  } catch {
    return [];
  }
}

/** Parse suggestions — accepts a JSON array OR a comma-separated list. */
export function parseSuggestions(v: string | undefined): string[] {
  if (!v || !v.trim()) return [];
  const t = v.trim();
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t);
      return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
    } catch {
      return [];
    }
  }
  return t.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Built-in + env defaults (no Supabase). Pure — safe to unit test. */
export function defaultSettings(cfg: AgentConfig): AgentSettings {
  const env = process.env;
  const suggestions = parseSuggestions(env.SUGGESTIONS);
  const quickLinks = parseQuickLinks(env.QUICK_LINKS);
  const contactMethods = parseContactMethods(env.CONTACT_METHODS);
  return {
    agentName: cfg.name,
    systemPrompt: cfg.systemPrompt,
    model: cfg.model,
    greet: cfg.identity.greet,
    suggestions: suggestions.length ? suggestions : DEFAULT_SUGGESTIONS,
    quickLinks: quickLinks.length ? quickLinks : DEFAULT_QUICK_LINKS,
    contactMethods: contactMethods.length ? contactMethods : DEFAULT_CONTACT_METHODS,
  };
}

/** Overlay a partial (Supabase row) over a base. Arrays REPLACE wholesale, but an
 *  empty/undefined override is ignored so a partial save never blanks a section.
 *  Overridden links + contacts are re-sanitized. Pure — safe to unit test. */
export function mergeSettings(base: AgentSettings, over: Partial<AgentSettings> | null | undefined): AgentSettings {
  if (!over) return base;
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v : d);
  const out: AgentSettings = {
    agentName: str(over.agentName, base.agentName),
    systemPrompt: str(over.systemPrompt, base.systemPrompt),
    model: str(over.model, base.model),
    greet: typeof over.greet === 'boolean' ? over.greet : base.greet,
    suggestions: Array.isArray(over.suggestions) && over.suggestions.length ? parseSuggestions(JSON.stringify(over.suggestions)) : base.suggestions,
    quickLinks: Array.isArray(over.quickLinks) && over.quickLinks.length ? sanitizeQuickLinks(over.quickLinks) : base.quickLinks,
    contactMethods:
      Array.isArray(over.contactMethods) && over.contactMethods.length
        ? sanitizeContactMethods(over.contactMethods)
        : base.contactMethods,
  };
  return out;
}

/** Browser-safe projection — systemPrompt/model/greet NEVER cross the wire. */
export function publicSettings(s: AgentSettings): PublicSettings {
  return {
    agentName: s.agentName,
    suggestions: s.suggestions,
    quickLinks: s.quickLinks,
    contactMethods: s.contactMethods,
  };
}

const CONFIG_TABLE = 'agent_config';

/** Read the operator's stored override row (or null). Never throws → null. */
async function readOverride(agentId: string): Promise<Partial<AgentSettings> | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from(CONFIG_TABLE)
      .select('settings')
      .eq('agent_id', agentId)
      .maybeSingle();
    if (error || !data || typeof data.settings !== 'object') return null;
    return data.settings as Partial<AgentSettings>;
  } catch {
    return null; // no table / no supabase / network — fall back to env defaults
  }
}

/** Resolve the live settings: env defaults overlaid with the Supabase row.
 *  Best-effort overlay — any failure degrades to env defaults (chat must not break). */
export async function loadSettings(cfg: AgentConfig = loadConfig()): Promise<AgentSettings> {
  const base = defaultSettings(cfg);
  const over = await readOverride(cfg.id);
  return mergeSettings(base, over);
}

/** Persist an operator edit (dashboard PUT). Upserts a single row keyed by agent id.
 *  Returns the merged, sanitized result so the caller can echo it back. Throws on a
 *  real write failure so the dashboard can surface it. */
export async function saveSettings(cfg: AgentConfig, patch: Partial<AgentSettings>): Promise<AgentSettings> {
  const base = defaultSettings(cfg);
  const merged = mergeSettings(base, patch);
  // Store only the editable projection (never persist secrets / env-derived ids).
  const stored: Partial<AgentSettings> = {
    agentName: merged.agentName,
    systemPrompt: merged.systemPrompt,
    model: merged.model,
    greet: merged.greet,
    suggestions: merged.suggestions,
    quickLinks: merged.quickLinks,
    contactMethods: merged.contactMethods,
  };
  const { error } = await supabaseAdmin()
    .from(CONFIG_TABLE)
    .upsert({ agent_id: cfg.id, settings: stored, updated_at: new Date().toISOString() }, { onConflict: 'agent_id' });
  if (error) throw new Error(error.message);
  return merged;
}
