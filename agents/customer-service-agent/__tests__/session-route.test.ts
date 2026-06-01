import { describe, it, expect, afterEach } from 'vitest';

// Real wiring (no mocks): config + identity resolved through the actual handler.
const { GET } = await import('../app/api/session/route');

const req = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/session', { headers });

afterEach(() => {
  delete process.env.IDENTITY_MODE;
  delete process.env.IDENTITY_JWT_SECRET;
});

describe('GET /api/session', () => {
  it('default (IDENTITY_MODE unset) → anonymous, browser-safe shape only', async () => {
    delete process.env.IDENTITY_MODE;
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({ authenticated: false, displayName: null, links: [] });
  });

  it('never returns server-only identity fields (email / id / attributes)', async () => {
    const res = await GET(req({ cookie: 'session=whatever' }));
    const wire = JSON.stringify(await res.json());
    expect(wire).not.toContain('email');
    expect(wire).not.toContain('attributes');
  });

  it('an unverifiable cookie in jwt mode stays anonymous (never throws)', async () => {
    process.env.IDENTITY_MODE = 'jwt';
    process.env.IDENTITY_JWT_SECRET = 'shh';
    const res = await GET(req({ cookie: 'session=not.a.validjwt' }));
    expect(res.status).toBe(200);
    expect((await res.json()).authenticated).toBe(false);
  });
});
