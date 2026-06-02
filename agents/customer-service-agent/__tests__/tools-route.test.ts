import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const listTools = vi.fn(async () => [{ id: 'nemo_docs_search', title: 'Search docs', description: 'd', input_schema: {} }]);
vi.mock('@/lib/tools', () => ({ listTools }));

const { GET } = await import('../app/api/tools/route');

const TOKEN = 'admin-tok';
const req = (token?: string) =>
  new Request('http://localhost/api/tools', { headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  process.env.ADMIN_TOKEN = TOKEN;
  listTools.mockClear();
});
afterEach(() => delete process.env.ADMIN_TOKEN);

describe('GET /api/tools', () => {
  it('401 without the admin token (never lists the key\'s tools to the public)', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(listTools).not.toHaveBeenCalled();
  });

  it('401 with a wrong token', async () => {
    expect((await GET(req('nope'))).status).toBe(401);
  });

  it('admin → returns the gateway catalog', async () => {
    const res = await GET(req(TOKEN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].id).toBe('nemo_docs_search');
  });
});
