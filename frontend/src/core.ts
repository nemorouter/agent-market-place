/**
 * @nemorouter/agent-runtime — framework-agnostic agent chat client.
 *
 * Zero dependencies. Talks to the central Nemo MCP gateway
 * (`POST /v1/agents/{id}/respond`) using the customer's own `sk-nemo-…` virtual
 * key. The SAME endpoint serves every consumer — our first-party React widget,
 * this embeddable, a customer's bespoke UI, or a native MCP client. That stable
 * contract is what makes the runtime pluggable and separately deployable: this
 * file ships on a CDN / npm, the gateway stays inside nemo-backend.
 *
 * SSE event vocabulary (mirrors the backend):
 *   - content:   {"choices":[{"delta":{"content":"…"}}]}            (OpenAI-shaped)
 *   - tool step: {"nemo_event":"tool_call","tool":"…","title":"…","status":"running"|"done"}
 *   - citations: {"nemo_event":"citations","citations":[{"title":"…","url":"…"|null}]}
 *   - cost:      {"nemo_event":"cost","costUsd":0.0012,"partial":true}
 *   - error:     {"nemo_event":"error","message":"…","code":"…"}
 *   - terminator: [DONE]
 */

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolStep {
  tool: string;
  title: string;
  status: 'running' | 'done';
}

export interface Citation {
  title: string;
  url: string | null;
}

export interface AgentChatConfig {
  /** Base URL of the Nemo gateway. Default: https://api.nemorouter.ai */
  apiBase?: string;
  /** Agent id to run. Default: "nemo-support". */
  agentId?: string;
  /**
   * How to obtain the caller's virtual key. Either a static `sk-nemo-…` string,
   * a function returning one, or `proxyPath` instead (see below). For untrusted
   * surfaces (a public marketing page) prefer a same-origin proxy so the key is
   * never shipped to the browser — exactly how nemorouter.ai's own widget works.
   */
  apiKey?: string | (() => string | Promise<string>);
  /**
   * Same-origin proxy path to POST to instead of calling the gateway directly.
   * When set, `apiBase`/`apiKey`/`agentId` are ignored on the client and the
   * proxy injects them server-side. Default for the public embed.
   */
  proxyPath?: string;
}

export interface StreamHandlers {
  onContent?: (delta: string, full: string) => void;
  onToolStep?: (step: ToolStep) => void;
  /** Source documents the answer was grounded in (from the agent's KB). */
  onCitations?: (citations: Citation[]) => void;
  /** Cost in USD attributable to this turn. `partial` true = tool/pre-stream spend only
   *  (the streamed answer's cost rides in the provider's terminal usage chunk). */
  onCost?: (costUsd: number, partial: boolean) => void;
  onError?: (message: string, code?: string) => void;
  onDone?: (full: string) => void;
}

const DEFAULT_API_BASE = 'https://api.nemorouter.ai';
const DEFAULT_AGENT = 'nemo-support';

async function resolveKey(apiKey: AgentChatConfig['apiKey']): Promise<string> {
  if (typeof apiKey === 'function') return await apiKey();
  return apiKey ?? '';
}

/**
 * Stream one agent turn. Sends the full message history (stateless), parses the
 * SSE, and invokes handlers as content + tool steps arrive. Returns the final
 * assistant text. Pass an AbortSignal to cancel.
 */
export async function streamAgentTurn(
  config: AgentChatConfig,
  messages: AgentMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  const { url, headers, body } = await buildRequest(config, messages);

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    let msg = 'Ask AI is temporarily unavailable. Please try again shortly.';
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* keep default */
    }
    handlers.onError?.(msg);
    return '';
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const flush = (line: string) => {
    const t = line.trim();
    if (!t.startsWith('data: ')) return;
    const payload = t.slice(6);
    if (payload === '[DONE]') return;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload);
    } catch {
      return; // skip malformed line
    }
    if (evt.nemo_event === 'tool_call') {
      handlers.onToolStep?.({
        tool: String(evt.tool ?? ''),
        title: String(evt.title ?? evt.tool ?? 'Working'),
        status: evt.status === 'done' ? 'done' : 'running',
      });
      return;
    }
    if (evt.nemo_event === 'citations') {
      const list = Array.isArray(evt.citations) ? (evt.citations as Citation[]) : [];
      handlers.onCitations?.(list);
      return;
    }
    if (evt.nemo_event === 'cost') {
      handlers.onCost?.(Number(evt.costUsd) || 0, evt.partial === true);
      return;
    }
    if (evt.nemo_event === 'error') {
      handlers.onError?.(String(evt.message ?? 'Something went wrong.'), evt.code as string | undefined);
      return;
    }
    const choices = evt.choices as Array<{ delta?: { content?: string } }> | undefined;
    const delta = choices?.[0]?.delta?.content ?? '';
    if (delta) {
      full += delta;
      handlers.onContent?.(delta, full);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) flush(line);
  }
  if (buffer) buffer.split('\n').forEach(flush);

  handlers.onDone?.(full);
  return full;
}

async function buildRequest(config: AgentChatConfig, messages: AgentMessage[]) {
  if (config.proxyPath) {
    return {
      url: config.proxyPath,
      headers: { 'Content-Type': 'application/json' } as Record<string, string>,
      body: { messages },
    };
  }
  const apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const agentId = config.agentId ?? DEFAULT_AGENT;
  const key = await resolveKey(config.apiKey);
  return {
    url: `${apiBase}/v1/agents/${agentId}/respond`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    } as Record<string, string>,
    body: { messages, stream: true },
  };
}
