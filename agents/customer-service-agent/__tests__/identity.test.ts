import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  resolveIdentity,
  publicIdentity,
  buildPersona,
  verifyJwtHS256,
  type Identity,
} from '../lib/identity';
import type { IdentityConfig } from '../lib/config';

// A baseline config; each test overrides the bits it cares about.
function cfg(over: Partial<IdentityConfig> = {}): IdentityConfig {
  return {
    mode: 'none',
    cookieName: 'session',
    jwtSecret: undefined,
    claims: { name: 'name', id: 'sub', email: 'email', attributes: ['org', 'plan'] },
    header: { name: 'x-forwarded-user', attributes: [] },
    introspectUrl: undefined,
    greet: true,
    linksTemplate: [],
    docAudienceAttr: undefined,
    ...over,
  };
}

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeJwt(claims: Record<string, unknown>, secret: string): string {
  const h = b64url({ alg: 'HS256', typ: 'JWT' });
  const p = b64url(claims);
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${h}.${p}.${sig}`;
}

const reqWith = (headers: Record<string, string>) => new Request('https://acme.com/api/chat', { headers });

describe('verifyJwtHS256', () => {
  it('verifies a well-signed token', () => {
    const t = makeJwt({ name: 'Guru', sub: 'u1' }, 'shh');
    expect(verifyJwtHS256(t, 'shh')).toMatchObject({ name: 'Guru', sub: 'u1' });
  });
  it('rejects a wrong secret', () => {
    const t = makeJwt({ name: 'Guru' }, 'shh');
    expect(verifyJwtHS256(t, 'nope')).toBeNull();
  });
  it('rejects an expired token', () => {
    const t = makeJwt({ name: 'Guru', exp: Math.floor(Date.now() / 1000) - 10 }, 'shh');
    expect(verifyJwtHS256(t, 'shh')).toBeNull();
  });
  it('rejects a non-HS256 alg (no alg confusion)', () => {
    const h = b64url({ alg: 'none', typ: 'JWT' });
    const p = b64url({ name: 'Guru' });
    expect(verifyJwtHS256(`${h}.${p}.`, 'shh')).toBeNull();
  });
});

describe('resolveIdentity — none (default)', () => {
  it('is anonymous and never throws', async () => {
    const id = await resolveIdentity(reqWith({}), cfg());
    expect(id.authenticated).toBe(false);
  });
});

describe('resolveIdentity — jwt', () => {
  const c = cfg({ mode: 'jwt', jwtSecret: 'shh', cookieName: 'session' });

  it('reads name + attributes from a valid cookie JWT', async () => {
    const t = makeJwt({ name: 'Guru', sub: 'u1', org: 'Acme', plan: 'pro' }, 'shh');
    const id = await resolveIdentity(reqWith({ cookie: `other=x; session=${t}` }), c);
    expect(id.authenticated).toBe(true);
    expect(id.displayName).toBe('Guru');
    expect(id.attributes).toEqual({ org: 'Acme', plan: 'pro' });
  });
  it('is anonymous with no cookie', async () => {
    expect((await resolveIdentity(reqWith({}), c)).authenticated).toBe(false);
  });
  it('is anonymous with a tampered token', async () => {
    const t = makeJwt({ name: 'Guru' }, 'wrong-secret');
    expect((await resolveIdentity(reqWith({ cookie: `session=${t}` }), c)).authenticated).toBe(false);
  });
  it('accepts a forwarded bearer token (cross-origin embed, no cookie)', async () => {
    const t = makeJwt({ name: 'Guru', org: 'Acme' }, 'shh');
    const id = await resolveIdentity(reqWith({ authorization: `Bearer ${t}` }), c);
    expect(id.authenticated).toBe(true);
    expect(id.displayName).toBe('Guru');
  });
  it('rejects a tampered bearer token', async () => {
    const t = makeJwt({ name: 'Guru' }, 'wrong-secret');
    expect((await resolveIdentity(reqWith({ authorization: `Bearer ${t}` }), c)).authenticated).toBe(false);
  });
  it('derives doc audiences from the configured attribute', async () => {
    const cc = cfg({ mode: 'jwt', jwtSecret: 'shh', docAudienceAttr: 'plan' });
    const t = makeJwt({ name: 'Guru', plan: 'pro' }, 'shh');
    const id = await resolveIdentity(reqWith({ cookie: `session=${t}` }), cc);
    expect(id.docAudiences).toEqual(['public', 'pro']);
  });
  it('templates personalized links from attributes', async () => {
    const cc = cfg({
      mode: 'jwt',
      jwtSecret: 'shh',
      linksTemplate: [
        { label: 'Your dashboard', url: 'https://acme.com/app/{org}' },
        { label: 'Billing', url: 'https://acme.com/app/{org}/billing' },
        { label: 'Broken', url: 'https://acme.com/{missing}' },
      ],
    });
    const t = makeJwt({ name: 'Guru', org: 'acme', plan: 'pro' }, 'shh');
    const id = await resolveIdentity(reqWith({ cookie: `session=${t}` }), cc);
    // {missing} has no attribute → that link is dropped.
    expect(id.links).toEqual([
      { label: 'Your dashboard', url: 'https://acme.com/app/acme' },
      { label: 'Billing', url: 'https://acme.com/app/acme/billing' },
    ]);
  });
});

describe('resolveIdentity — header (trusted proxy)', () => {
  it('reads name + mapped attribute headers', async () => {
    const c = cfg({
      mode: 'header',
      header: { name: 'x-forwarded-user', attributes: ['org:x-forwarded-org', 'plan:x-plan'] },
      docAudienceAttr: 'plan',
    });
    const id = await resolveIdentity(
      reqWith({ 'x-forwarded-user': 'Guru', 'x-forwarded-org': 'Acme', 'x-plan': 'enterprise' }),
      c,
    );
    expect(id.authenticated).toBe(true);
    expect(id.displayName).toBe('Guru');
    expect(id.attributes).toEqual({ org: 'Acme', plan: 'enterprise' });
    expect(id.docAudiences).toEqual(['public', 'enterprise']);
  });
  it('is anonymous when the trusted header is absent', async () => {
    const c = cfg({ mode: 'header' });
    expect((await resolveIdentity(reqWith({}), c)).authenticated).toBe(false);
  });
});

describe('publicIdentity — leak guard', () => {
  it('exposes only authenticated/displayName/links (never email, id, attributes, audiences)', () => {
    const full: Identity = {
      authenticated: true,
      id: 'u1',
      displayName: 'Guru',
      email: 'guru@acme.com',
      attributes: { org: 'Acme', plan: 'pro' },
      links: [{ label: 'Dashboard', url: 'https://acme.com/app' }],
      docAudiences: ['public', 'pro'],
    };
    const pub = publicIdentity(full);
    expect(pub).toEqual({
      authenticated: true,
      displayName: 'Guru',
      links: [{ label: 'Dashboard', url: 'https://acme.com/app' }],
    });
    expect(JSON.stringify(pub)).not.toContain('guru@acme.com');
    expect(JSON.stringify(pub)).not.toContain('Acme');
  });
  it('blanks name + links for anonymous', () => {
    expect(publicIdentity({ authenticated: false })).toEqual({
      authenticated: false,
      displayName: null,
      links: [],
    });
  });
});

describe('buildPersona', () => {
  it('is empty for anonymous (no prompt cost when logged out)', () => {
    expect(buildPersona({ authenticated: false }, cfg())).toBe('');
  });
  it('adds a greet-by-name instruction + account links + tier steer', () => {
    const id: Identity = {
      authenticated: true,
      displayName: 'Guru',
      attributes: { org: 'Acme', plan: 'pro' },
      links: [{ label: 'Dashboard', url: 'https://acme.com/app' }],
      docAudiences: ['public', 'pro'],
    };
    const out = buildPersona(id, cfg({ greet: true }));
    expect(out).toContain('SIGNED IN as Guru');
    expect(out).toContain('Hello Guru');
    expect(out).toContain('https://acme.com/app');
    expect(out).toContain('pro');
  });
  it('omits the greeting when greet=false', () => {
    const id: Identity = { authenticated: true, displayName: 'Guru' };
    expect(buildPersona(id, cfg({ greet: false }))).not.toContain('Hello Guru');
  });
});
