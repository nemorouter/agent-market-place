// lib/identity.ts — the PLUGGABLE login/personalization layer.
//
// One agent, one widget, 1000 forks — and each fork turns on "Hello <name>",
// personalized URLs, and plan-scoped docs by setting ENV VARS, not by editing
// code. That's the whole point: identity resolution is a single swappable
// function with five built-in adapters + a one-file override escape hatch.
//
//   IDENTITY_MODE=none        → anonymous (default; current behavior, zero cost)
//   IDENTITY_MODE=jwt         → verify a signed JWT cookie (HS256), map claims
//   IDENTITY_MODE=header      → trust a reverse-proxy header (oauth2-proxy / SSO)
//   IDENTITY_MODE=introspect  → forward the visitor's cookies to the fork's OWN
//                               "who am I" URL; it returns the identity JSON
//   IDENTITY_MODE=custom      → dynamic-import ./identity.custom (you write it)
//
// HARD RULE: identity is resolved SERVER-SIDE from the request only. We never
// trust a name/org the browser sends in the chat body (mirrors Rule #26 —
// AuthContext is the only source of truth; the client can't spoof who it is).
// Any failure degrades to anonymous — personalization must never break chat.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IdentityConfig } from './config';

/** What the resolver returns. `attributes`/`email`/`id` are SERVER-ONLY. */
export interface Identity {
  authenticated: boolean;
  /** Stable id — for logging/scoping only, never shown to the browser. */
  id?: string;
  /** First name / handle — the "Hello Guru" greeting. SAFE to expose. */
  displayName?: string;
  /** Server-only. */
  email?: string;
  /** Arbitrary claims (org, plan, tier…) injected into the prompt. Server-only. */
  attributes?: Record<string, string>;
  /** Personalized deep-links. SAFE to expose (rendered in the widget rail). */
  links?: Array<{ label: string; url: string }>;
  /** Retrieval scoping tags, e.g. ["public","pro"]. Server-only. */
  docAudiences?: string[];
}

const ANON: Identity = { authenticated: false };

/** The browser-facing projection — ONLY name + links cross the wire. */
export function publicIdentity(id: Identity): {
  authenticated: boolean;
  displayName: string | null;
  links: Array<{ label: string; url: string }>;
} {
  return {
    authenticated: id.authenticated,
    displayName: id.authenticated ? id.displayName ?? null : null,
    links: id.authenticated ? id.links ?? [] : [],
  };
}

// ── tiny dependency-free helpers ─────────────────────────────────────────────

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Read a bearer token from the Authorization header (cross-origin embed path,
 *  where third-party cookies are blocked and the host forwards a signed token). */
function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Verify + decode an HS256 JWT. Returns the claims, or null if invalid/expired. */
export function verifyJwtHS256(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  let header: { alg?: string };
  try {
    header = JSON.parse(b64urlToBuf(h).toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null; // we only trust HS256 here
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const got = b64urlToBuf(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(b64urlToBuf(p).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null;
  return claims;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined;

/** Pull configured attribute claims out of a flat claims/JSON object. */
function pickAttributes(src: Record<string, unknown>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = str(src[k]);
    if (v != null) out[k] = v;
  }
  return out;
}

/** Substitute {attr} placeholders in the link template from attributes.
 *  A link that references an attribute we don't have is DROPPED (not rendered
 *  with a hole) — better no link than a truncated/broken one. */
function buildLinks(
  template: IdentityConfig['linksTemplate'],
  attrs: Record<string, string>,
): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  for (const l of template) {
    let missing = false;
    const fill = (s: string) =>
      s.replace(/\{(\w+)\}/g, (_, k: string) => {
        if (attrs[k] == null) missing = true;
        return attrs[k] ?? '';
      });
    const url = fill(l.url);
    const label = fill(l.label);
    if (!missing && url) out.push({ label, url });
  }
  return out;
}

/** Common assembly once a mode has produced raw claims. */
function fromClaims(claims: Record<string, unknown>, cfg: IdentityConfig): Identity {
  const attributes = pickAttributes(claims, cfg.claims.attributes);
  const displayName = str(claims[cfg.claims.name]);
  const id: Identity = {
    authenticated: true,
    id: str(claims[cfg.claims.id]),
    displayName,
    email: str(claims[cfg.claims.email]),
    attributes,
    links: buildLinks(cfg.linksTemplate, attributes),
    docAudiences: ['public'],
  };
  if (cfg.docAudienceAttr && attributes[cfg.docAudienceAttr]) {
    id.docAudiences = ['public', attributes[cfg.docAudienceAttr]];
  }
  return id;
}

// ── the built-in adapters ────────────────────────────────────────────────────

function jwtAdapter(req: Request, cfg: IdentityConfig): Identity {
  if (!cfg.jwtSecret) return ANON;
  // Cookie first (same-site deploy — the default, zero-config path); fall back to
  // a forwarded bearer token (cross-origin embed, where cookies can't flow).
  const token = readCookie(req.headers.get('cookie'), cfg.cookieName) || bearerToken(req);
  if (!token) return ANON;
  const claims = verifyJwtHS256(token, cfg.jwtSecret);
  return claims ? fromClaims(claims, cfg) : ANON;
}

function headerAdapter(req: Request, cfg: IdentityConfig): Identity {
  // Trust a header injected by an upstream auth proxy (oauth2-proxy, ALB OIDC,
  // Cloudflare Access…). Only meaningful when the proxy strips client-set copies.
  const name = req.headers.get(cfg.header.name);
  if (!name) return ANON;
  const claims: Record<string, unknown> = { [cfg.claims.name]: name };
  // header.attributes maps "attrKey:header-name" pairs.
  for (const pair of cfg.header.attributes) {
    const [attr, hdr] = pair.split(':').map((s) => s.trim());
    if (attr && hdr) {
      const v = req.headers.get(hdr);
      if (v) claims[attr] = v;
    }
  }
  return fromClaims(claims, cfg);
}

async function introspectAdapter(req: Request, cfg: IdentityConfig): Promise<Identity> {
  if (!cfg.introspectUrl) return ANON;
  // Forward the visitor's cookies to the fork's existing session endpoint.
  // That endpoint already knows how to answer "who is this?" for ANY auth stack.
  const res = await fetch(cfg.introspectUrl, {
    headers: { cookie: req.headers.get('cookie') ?? '', accept: 'application/json' },
  });
  if (!res.ok) return ANON;
  const data = (await res.json()) as Record<string, unknown>;
  // Two accepted shapes: a flat claims object, OR a ready-made Identity.
  if (typeof data.authenticated === 'boolean') {
    const ident = data as unknown as Identity;
    return ident.authenticated ? { docAudiences: ['public'], ...ident } : ANON;
  }
  if (data && Object.keys(data).length) return fromClaims(data, cfg);
  return ANON;
}

async function customAdapter(req: Request, cfg: IdentityConfig): Promise<Identity> {
  // The fork drops a lib/identity.custom.ts exporting `resolve(req, cfg) => Identity`.
  // Optional file (not shipped upstream) — the computed specifier keeps the
  // typechecker/bundler from requiring it to exist in the base repo.
  const spec = './identity.custom';
  const mod = (await import(/* @vite-ignore */ spec)) as {
    resolve: (req: Request, cfg: IdentityConfig) => Identity | Promise<Identity>;
  };
  return await mod.resolve(req, cfg);
}

/** Resolve the caller's identity from the request. Never throws → anonymous. */
export async function resolveIdentity(req: Request, cfg: IdentityConfig): Promise<Identity> {
  try {
    switch (cfg.mode) {
      case 'jwt':
        return jwtAdapter(req, cfg);
      case 'header':
        return headerAdapter(req, cfg);
      case 'introspect':
        return await introspectAdapter(req, cfg);
      case 'custom':
        return await customAdapter(req, cfg);
      case 'none':
      default:
        return ANON;
    }
  } catch {
    return ANON; // personalization must NEVER break the chat path
  }
}

/** Build the system-prompt addendum that personalizes the answer. Empty when anon. */
export function buildPersona(id: Identity, cfg: IdentityConfig): string {
  if (!id.authenticated) return '';
  const lines: string[] = [];
  const who = id.displayName ? `, ${id.displayName},` : '';
  const attrs = id.attributes ?? {};
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  lines.push(
    `The user is SIGNED IN${id.displayName ? ` as ${id.displayName}` : ''}${
      attrStr ? ` (${attrStr})` : ''
    }.`,
  );
  if (cfg.greet && id.displayName) {
    lines.push(`Greet them once by name (e.g. "Hello ${id.displayName}") at the start of your first reply, then answer.`);
  }
  if (id.links?.length) {
    lines.push(
      `When a link would help, prefer these account links over generic ones:\n` +
        id.links.map((l) => `  - ${l.label}: ${l.url}`).join('\n'),
    );
  }
  if (id.docAudiences && id.docAudiences.length > 1) {
    lines.push(
      `Tailor the answer to their entitlements (${id.docAudiences
        .filter((a) => a !== 'public')
        .join(', ')}); do not surface content meant for other tiers.`,
    );
  }
  void who; // (kept for readability of the greeting intent)
  return `\n\n[Personalization]\n${lines.join('\n')}`;
}
