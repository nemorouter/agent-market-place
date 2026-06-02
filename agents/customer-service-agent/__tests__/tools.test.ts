import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toOpenAISpec, runToolLoop, listTools, callTool, type ToolSpec } from '../lib/tools';
import type { ToolCall } from '../lib/nemo';

const TOOL: ToolSpec = {
  id: 'nemo_docs_search',
  title: 'Search Nemo docs',
  description: 'Search the official docs.',
  input_schema: { type: 'object', properties: { query: { type: 'string' } } },
};

describe('toOpenAISpec', () => {
  it('maps a catalog entry to an OpenAI function spec (name = tool id)', () => {
    expect(toOpenAISpec(TOOL)).toEqual({
      type: 'function',
      function: {
        name: 'nemo_docs_search',
        description: 'Search the official docs.',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    });
  });
  it('falls back to an empty object schema when none provided', () => {
    const spec = toOpenAISpec({ id: 't', title: 'T', description: '' });
    expect(spec.function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

describe('runToolLoop', () => {
  const chatNoTools = async () => ({ content: 'done', toolCalls: [] as ToolCall[] });

  it('no enabled tools → no-op', async () => {
    const chat = vi.fn(chatNoTools);
    const call = vi.fn(async () => ({ ok: true, result: 'x' }));
    const out = await runToolLoop({ messages: [], enabled: [], maxSteps: 3, chat, call });
    expect(out).toEqual({ toolContext: '', ran: false });
    expect(chat).not.toHaveBeenCalled();
  });

  it('model asks for no tools → runs one round, calls nothing', async () => {
    const chat = vi.fn(chatNoTools);
    const call = vi.fn(async () => ({ ok: true, result: 'x' }));
    const out = await runToolLoop({ messages: [], enabled: [TOOL], maxSteps: 3, chat, call });
    expect(out.ran).toBe(false);
    expect(call).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('executes a requested tool, emits running+done steps, grounds the answer', async () => {
    const calls: ToolCall[] = [{ id: 'c1', name: 'nemo_docs_search', arguments: { query: 'pricing' } }];
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: '', toolCalls: calls })
      .mockResolvedValue({ content: 'final', toolCalls: [] });
    const call = vi.fn(async () => ({ ok: true, result: { hits: ['$5 platform fee'] } }));
    const steps: string[] = [];
    const out = await runToolLoop({
      messages: [{ role: 'user', content: 'fee?' }],
      enabled: [TOOL],
      maxSteps: 3,
      chat,
      call,
      onStep: (e) => steps.push(`${e.status}:${e.tool}`),
    });
    expect(call).toHaveBeenCalledWith('nemo_docs_search', { query: 'pricing' });
    expect(out.ran).toBe(true);
    expect(out.toolContext).toContain('nemo_docs_search');
    expect(out.toolContext).toContain('$5 platform fee');
    expect(steps).toEqual(['running:nemo_docs_search', 'done:nemo_docs_search']);
  });

  it('never calls a tool that is not in the enabled set', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'c1', name: 'rogue_tool', arguments: {} }] })
      .mockResolvedValue({ content: 'final', toolCalls: [] });
    const call = vi.fn(async () => ({ ok: true, result: 'x' }));
    const out = await runToolLoop({ messages: [], enabled: [TOOL], maxSteps: 3, chat, call });
    expect(call).not.toHaveBeenCalled();
    expect(out.ran).toBe(false);
  });

  it('records a tool error into the context but keeps going', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'c1', name: 'nemo_docs_search', arguments: {} }] })
      .mockResolvedValue({ content: 'final', toolCalls: [] });
    const call = vi.fn(async () => ({ ok: false, error: 'insufficient credits', code: 'insufficient_credits' }));
    const out = await runToolLoop({ messages: [], enabled: [TOOL], maxSteps: 3, chat, call });
    expect(out.ran).toBe(true);
    expect(out.toolContext).toContain('error: insufficient credits');
  });

  it('a thrown decision round degrades to no tools (answer still happens)', async () => {
    const chat = vi.fn(async () => {
      throw new Error('model down');
    });
    const call = vi.fn(async () => ({ ok: true, result: 'x' }));
    const out = await runToolLoop({ messages: [], enabled: [TOOL], maxSteps: 3, chat, call });
    expect(out).toEqual({ toolContext: '', ran: false });
  });

  it('respects maxSteps when the model keeps requesting tools', async () => {
    const chat = vi.fn(async () => ({ content: '', toolCalls: [{ id: 'c', name: 'nemo_docs_search', arguments: {} }] }));
    const call = vi.fn(async () => ({ ok: true, result: 'again' }));
    await runToolLoop({ messages: [], enabled: [TOOL], maxSteps: 2, chat, call });
    expect(chat).toHaveBeenCalledTimes(2); // capped
  });
});

describe('listTools / callTool (gateway HTTP)', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.NEMO_BASE_URL = 'http://gw.local';
    process.env.NEMOROUTER_API_KEY = 'sk-nemo-test';
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('listTools parses + normalizes the catalog', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ object: 'list', data: [{ id: 'a', title: 'A', description: 'd', tier: 'free', input_schema: {} }, { bogus: true }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const tools = await listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ id: 'a', title: 'A', description: 'd', tier: 'free' });
  });

  it('listTools → [] on a non-200', async () => {
    global.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    expect(await listTools()).toEqual([]);
  });

  it('listTools → [] when fetch throws', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await listTools()).toEqual([]);
  });

  it('callTool maps a success body', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { a: 1 }, cost_usd: 0.002 }), { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await callTool('a', { q: 'x' })).toEqual({ ok: true, result: { a: 1 }, costUsd: 0.002 });
  });

  it('callTool maps a failure body', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: 'blocked', code: 'guardrail_blocked' }), { status: 400 }),
    ) as unknown as typeof fetch;
    expect(await callTool('a', {})).toEqual({ ok: false, error: 'blocked', code: 'guardrail_blocked' });
  });

  it('callTool never throws on a network error', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const r = await callTool('a', {});
    expect(r.ok).toBe(false);
    expect(r.code).toBe('network_error');
  });
});
