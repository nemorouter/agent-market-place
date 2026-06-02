// lib/tools.ts — client for the Nemo MCP tool gateway (Phase 2 consumer side).
//
// The gateway already exists in nemo-backend (GET /v1/mcp/tools, POST
// /v1/mcp/tools/{id}/call). It enforces, server-side and per-call, the FULL safety
// contract: tool RBAC → guardrails(args) → reserve_credits → execute → guardrails(out)
// → settle_credits → audit. This client only LISTS and CALLS — it never reimplements
// any of that (mirrors lib/nemo.ts for chat). Every call rides the agent's own
// sk-nemo virtual key (server-side), so spend + limits are tracked per key (Rule #15).
//
// Everything degrades gracefully: gateway unreachable / key invalid / tool error →
// the agent simply answers without tools. Tools AUGMENT the RAG answer; they never
// gate it.

import type { ChatMessage, ToolCall, ToolFunctionSpec } from './nemo';

const BASE = (process.env.NEMO_BASE_URL || 'https://api.nemorouter.ai').replace(/\/$/, '');
const KEY = () => process.env.NEMOROUTER_API_KEY || '';

/** Catalog entry as returned by the gateway's `tool.describe()`. */
export interface ToolSpec {
  id: string;
  title: string;
  description: string;
  tier?: string;
  input_schema?: Record<string, unknown>;
}

/** Result of one tool execution (gateway `execute_tool` shape, normalized). */
export interface ToolResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
  costUsd?: number;
}

const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${KEY()}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

/** GET /v1/mcp/tools — the catalog this key can see. [] on ANY failure. */
export async function listTools(signal?: AbortSignal): Promise<ToolSpec[]> {
  try {
    const res = await fetch(`${BASE}/v1/mcp/tools`, { headers: authHeaders(), signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: unknown };
    const data = Array.isArray(json?.data) ? json.data : [];
    return data
      .filter((t): t is ToolSpec => Boolean(t) && typeof (t as ToolSpec).id === 'string')
      .map((t) => ({
        id: t.id,
        title: typeof t.title === 'string' ? t.title : t.id,
        description: typeof t.description === 'string' ? t.description : '',
        tier: typeof t.tier === 'string' ? t.tier : undefined,
        input_schema: (t.input_schema as Record<string, unknown>) ?? {},
      }));
  } catch {
    return [];
  }
}

/** POST /v1/mcp/tools/{id}/call — execute one tool. Never throws → {ok:false}.
 *  `opts.credential` is a TRANSIENT per-call secret (opened from the agent vault):
 *  it rides in the body for this one call, the gateway uses it and never stores it. */
export async function callTool(
  toolId: string,
  args: Record<string, unknown>,
  opts?: { credential?: string; signal?: AbortSignal },
): Promise<ToolResult> {
  try {
    const res = await fetch(`${BASE}/v1/mcp/tools/${encodeURIComponent(toolId)}/call`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ arguments: args, ...(opts?.credential ? { credential: opts.credential } : {}) }),
      signal: opts?.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && json.ok === true) {
      return { ok: true, result: json.result, costUsd: typeof json.cost_usd === 'number' ? json.cost_usd : undefined };
    }
    return {
      ok: false,
      error: typeof json.error === 'string' ? json.error : `tool call failed (${res.status})`,
      code: typeof json.code === 'string' ? json.code : 'tool_failed',
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error', code: 'network_error' };
  }
}

/** Build the OpenAI function-calling spec the LLM needs from a catalog entry. */
export function toOpenAISpec(tool: ToolSpec): ToolFunctionSpec {
  return {
    type: 'function',
    function: {
      name: tool.id,
      description: tool.description || tool.title,
      parameters:
        tool.input_schema && Object.keys(tool.input_schema).length
          ? tool.input_schema
          : { type: 'object', properties: {} },
    },
  };
}

export interface ToolStepEvent {
  tool: string;
  title: string;
  status: 'running' | 'done';
}

/** Bounded tool-use loop. PURE except for the injected `chat` + `call` (so it's
 *  fully unit-testable). Runs up to `maxSteps` decision rounds: ask the model which
 *  tool(s) to call → execute the allowed ones via the gateway → feed results back.
 *  Returns a `toolContext` string the caller folds into the FINAL (streamed) answer's
 *  context — we inject tool output as grounded context (same shape as RAG) rather
 *  than threading fragile provider-specific tool messages. */
export async function runToolLoop(params: {
  messages: ChatMessage[];
  enabled: ToolSpec[];
  maxSteps: number;
  chat: (messages: ChatMessage[], tools: ToolFunctionSpec[]) => Promise<{ content: string; toolCalls: ToolCall[] }>;
  call: (toolId: string, args: Record<string, unknown>) => Promise<ToolResult>;
  onStep?: (e: ToolStepEvent) => void;
}): Promise<{ toolContext: string; ran: boolean }> {
  const { messages, enabled, maxSteps, chat, call, onStep } = params;
  if (!enabled.length) return { toolContext: '', ran: false };

  const byId = new Map(enabled.map((t) => [t.id, t]));
  const specs = enabled.map(toOpenAISpec);
  const convo: ChatMessage[] = [...messages];
  const lines: string[] = [];

  for (let step = 0; step < Math.max(1, maxSteps); step++) {
    let round: { content: string; toolCalls: ToolCall[] };
    try {
      round = await chat(convo, specs);
    } catch {
      break; // a failed decision round must not break the answer — stop tool use
    }
    if (!round.toolCalls.length) break;

    for (const tc of round.toolCalls) {
      const spec = byId.get(tc.name);
      if (!spec) continue; // never call a tool that isn't enabled (defense in depth)
      onStep?.({ tool: tc.name, title: `Using ${spec.title}`, status: 'running' });
      const r = await call(tc.name, tc.arguments);
      onStep?.({ tool: tc.name, title: `Using ${spec.title}`, status: 'done' });
      lines.push(
        `- ${tc.name}(${JSON.stringify(tc.arguments)}) → ${
          r.ok ? JSON.stringify(r.result) : `error: ${r.error ?? 'failed'}`
        }`,
      );
    }
    // Record what ran so the next round doesn't repeat the same call.
    convo.push({ role: 'assistant', content: `(called tools: ${round.toolCalls.map((t) => t.name).join(', ')})` });
    convo.push({ role: 'system', content: `Tool results so far:\n${lines.join('\n')}` });
  }

  return {
    toolContext: lines.length ? `\n\nTool results (use these to ground your answer):\n${lines.join('\n')}` : '',
    ran: lines.length > 0,
  };
}
