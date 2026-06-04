import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentSettings } from '../lib/settings';

// Mock the settings layer so the route tests exercise the HANDLER contract
// (auth gate + public/admin projection + error mapping), not Supabase. publicSettings
// stays REAL (it's the projection under test), so a leak would fail here.
const FULL: AgentSettings = {
  agentName: 'Acme Support',
  systemPrompt: 'SECRET SYSTEM PROMPT',
  model: 'secret-model',
  greet: true,
  suggestions: ['How does pricing work?'],
  quickLinks: [{ label: 'Docs', href: '/docs' }],
  contactMethods: [{ type: 'phone', label: 'Call', value: '+1 (555) 010-2030' }],
  enabledTools: [],
  webSearchEnabled: true,
  webSearchSite: 'nemorouter.ai',
};

const loadSettings = vi.fn(async () => FULL);
const saveSettings = vi.fn(async (_cfg: unknown, patch: Partial<AgentSettings>) => ({ ...FULL, ...patch }));

vi.mock('@/lib/settings', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/settings')>();
  return { ...actual, loadSettings, saveSettings };
});

// Import AFTER the mock is registered (vi.mock is hoisted, but be explicit).
const { GET, PUT } = await import('../app/api/config/route');

const TOKEN = 'test-admin-token-123';
const req = (init: { method?: string; token?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new Request('http://localhost/api/config', {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)) : undefined,
  });
};

beforeEach(() => {
  process.env.ADMIN_TOKEN = TOKEN;
  loadSettings.mockClear();
  saveSettings.mockClear();
});
afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe('GET /api/config — projection by auth', () => {
  it('anonymous → public projection only (no systemPrompt / model / greet)', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({
      agentName: 'Acme Support',
      suggestions: ['How does pricing work?'],
      quickLinks: [{ label: 'Docs', href: '/docs' }],
      contactMethods: [{ type: 'phone', label: 'Call', value: '+1 (555) 010-2030' }],
    });
    const wire = JSON.stringify(body);
    expect(wire).not.toContain('SECRET SYSTEM PROMPT');
    expect(wire).not.toContain('secret-model');
  });

  it('valid admin token → full settings (incl. systemPrompt + model)', async () => {
    const res = await GET(req({ token: TOKEN }));
    const body = await res.json();
    expect(body.systemPrompt).toBe('SECRET SYSTEM PROMPT');
    expect(body.model).toBe('secret-model');
    expect(body.greet).toBe(true);
  });

  it('wrong token → still only the public projection (GET never leaks)', async () => {
    const res = await GET(req({ token: 'nope' }));
    const body = await res.json();
    expect(body.systemPrompt).toBeUndefined();
  });

  it('no ADMIN_TOKEN configured → even a bearer gets only public (admin surface disabled)', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await GET(req({ token: 'anything' }));
    expect((await res.json()).systemPrompt).toBeUndefined();
  });
});

describe('PUT /api/config — write gate', () => {
  it('rejects with 401 when no token', async () => {
    const res = await PUT(req({ method: 'PUT', body: { agentName: 'x' } }));
    expect(res.status).toBe(401);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('rejects with 401 on a wrong token', async () => {
    const res = await PUT(req({ method: 'PUT', token: 'wrong', body: { agentName: 'x' } }));
    expect(res.status).toBe(401);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('rejects with 401 when ADMIN_TOKEN is unset (no world-writable fallback)', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await PUT(req({ method: 'PUT', token: TOKEN, body: { agentName: 'x' } }));
    expect(res.status).toBe(401);
  });

  it('400 on malformed JSON body', async () => {
    const res = await PUT(req({ method: 'PUT', token: TOKEN, body: '{not json' }));
    expect(res.status).toBe(400);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('valid token + body → 200, persists, echoes merged settings', async () => {
    const res = await PUT(req({ method: 'PUT', token: TOKEN, body: { agentName: 'New Name' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.settings.agentName).toBe('New Name');
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it('maps a save failure to a clean 500 (no crash)', async () => {
    saveSettings.mockRejectedValueOnce(new Error('table missing'));
    const res = await PUT(req({ method: 'PUT', token: TOKEN, body: { agentName: 'x' } }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('save_failed');
    expect(body.message).toContain('table missing');
  });
});
