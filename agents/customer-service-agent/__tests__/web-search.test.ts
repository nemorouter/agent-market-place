import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the gateway tool client — webSearch must never call the network in tests.
vi.mock('../lib/tools', () => ({ callTool: vi.fn() }));
import { callTool } from '../lib/tools';
import { webSearch, WEB_SEARCH_TOOL_ID } from '../lib/web-search';

const mockCall = callTool as unknown as ReturnType<typeof vi.fn>;

describe('webSearch', () => {
  beforeEach(() => mockCall.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('empty query → EMPTY, no tool call', async () => {
    const out = await webSearch('   ');
    expect(out.ran).toBe(false);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('successful search → folded context + sources + cost', async () => {
    mockCall.mockResolvedValueOnce({
      ok: true,
      result: {
        answer: 'The capital is Paris.',
        sources: [{ url: 'https://en.wikipedia.org/Paris', title: 'Paris' }],
      },
      costUsd: 0.05,
    });
    const out = await webSearch('capital of France');
    expect(out.ran).toBe(true);
    expect(mockCall).toHaveBeenCalledWith(WEB_SEARCH_TOOL_ID, { query: 'capital of France' }, undefined);
    expect(out.answer).toBe('The capital is Paris.');
    expect(out.sources).toEqual([{ url: 'https://en.wikipedia.org/Paris', title: 'Paris' }]);
    expect(out.costUsd).toBe(0.05);
    expect(out.context).toContain('WEB_SEARCH');
    expect(out.context).toContain('The capital is Paris.');
    expect(out.context).toContain('https://en.wikipedia.org/Paris');
  });

  it('tool returns ok:false → EMPTY (graceful, never throws)', async () => {
    mockCall.mockResolvedValueOnce({ ok: false, error: 'not found', code: 'tool_failed' });
    const out = await webSearch('anything');
    expect(out.ran).toBe(false);
    expect(out.context).toBe('');
  });

  it('ok but empty answer → EMPTY', async () => {
    mockCall.mockResolvedValueOnce({ ok: true, result: { answer: '   ', sources: [] }, costUsd: 0.05 });
    expect((await webSearch('x')).ran).toBe(false);
  });

  it('drops non-http sources and caps the list', async () => {
    mockCall.mockResolvedValueOnce({
      ok: true,
      result: {
        answer: 'ok',
        sources: [
          { url: 'javascript:alert(1)', title: 'evil' },
          { url: 'https://a.com', title: 'A' },
          { url: 'ftp://b.com', title: 'B' },
        ],
      },
    });
    const out = await webSearch('x');
    expect(out.sources).toEqual([{ url: 'https://a.com', title: 'A' }]);
  });

  it('callTool throwing is swallowed → EMPTY', async () => {
    mockCall.mockRejectedValueOnce(new Error('boom'));
    expect((await webSearch('x')).ran).toBe(false);
  });

  it('site option scopes the query with the Google site: operator', async () => {
    mockCall.mockResolvedValueOnce({ ok: true, result: { answer: 'a', sources: [] } });
    await webSearch('refund policy', { site: 'nemorouter.ai' });
    expect(mockCall).toHaveBeenCalledWith(WEB_SEARCH_TOOL_ID, { query: 'site:nemorouter.ai refund policy' }, undefined);
  });

  it('does not double-prefix when the query already has site:', async () => {
    mockCall.mockResolvedValueOnce({ ok: true, result: { answer: 'a', sources: [] } });
    await webSearch('site:foo.com hi', { site: 'nemorouter.ai' });
    expect(mockCall).toHaveBeenCalledWith(WEB_SEARCH_TOOL_ID, { query: 'site:foo.com hi' }, undefined);
  });
});
