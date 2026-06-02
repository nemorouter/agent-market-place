import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Supabase probe target so readiness tests exercise the report logic
// (and the 200/503 mapping) without a live database.
const headMock = vi.fn(async () => ({ error: null as unknown }));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        limit: headMock,
      }),
    }),
  }),
}));

const { GET } = await import('../app/api/health/route');

const req = (path = '/api/health') => new Request('http://localhost' + path);

beforeEach(() => {
  headMock.mockReset();
  headMock.mockResolvedValue({ error: null });
  process.env.NEMOROUTER_API_KEY = 'sk-nemo-test';
});
afterEach(() => {
  delete process.env.NEMOROUTER_API_KEY;
});

describe('GET /api/health', () => {
  it('liveness is always 200 and does not probe dependencies', async () => {
    const res = await GET(req('/api/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(headMock).not.toHaveBeenCalled();
  });

  it('readiness returns 200 when Supabase is reachable and the Nemo key is set', async () => {
    const res = await GET(req('/api/health?ready=1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ready: boolean; checks: Record<string, boolean>; rateLimiter: string };
    expect(body.ready).toBe(true);
    expect(body.checks.supabase).toBe(true);
    expect(body.checks.nemoKey).toBe(true);
    expect(body.rateLimiter).toBe('memory');
  });

  it('readiness returns 503 when Supabase is unreachable', async () => {
    headMock.mockResolvedValue({ error: { message: 'down' } });
    const res = await GET(req('/api/health?ready=1'));
    expect(res.status).toBe(503);
    expect((await res.json()).ready).toBe(false);
  });

  it('readiness returns 503 when the Nemo key is missing', async () => {
    delete process.env.NEMOROUTER_API_KEY;
    const res = await GET(req('/api/health?ready=1'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ready: boolean; checks: Record<string, boolean> };
    expect(body.ready).toBe(false);
    expect(body.checks.nemoKey).toBe(false);
  });
});
