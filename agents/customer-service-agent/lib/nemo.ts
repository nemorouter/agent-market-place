// lib/nemo.ts — the ONLY place this app talks to a model.
//
// Every call goes through the Nemo gateway, so NEMO enforces (server-side):
//   • guardrails        — content safety / PII / prompt-injection (on the request + response)
//   • routing strategy  — model_group aliases, fallback chains, load-balancing
//   • credits           — reserve + settle on the virtual key (incl. platform fee)
//   • rate limits       — RPM/TPM on the virtual key
//
// This client MUST NOT reimplement or bypass any of that. It only:
//   1. sends the request with the customer's sk-nemo key (server-side only), and
//   2. surfaces Nemo's responses cleanly — including guardrail blocks, 402
//      (out of credits) and 429 (rate-limited) — so the UI can react.

const BASE = (process.env.NEMO_BASE_URL || 'https://api.nemorouter.ai').replace(/\/$/, '');
const KEY = process.env.NEMOROUTER_API_KEY; // sk-nemo-xxx — SERVER-SIDE ONLY, never sent to the browser.

if (!KEY && process.env.NODE_ENV !== 'test') {
  // Fail loudly: without a virtual key nothing works, and we NEVER fall back to a master key (Rule #15).
  console.warn('[nemo] NEMOROUTER_API_KEY is not set — chat and ingest will fail.');
}

const authHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  ...extra,
});

export class NemoError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: unknown) {
    super(message);
    this.name = 'NemoError';
  }
}

/** Map gateway failures to typed errors the UI can surface. */
async function toNemoError(res: Response): Promise<NemoError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const b = body as { error?: { message?: string }; detail?: string } | undefined;
  const detail = b?.error?.message || b?.detail || res.statusText;
  if (res.status === 402) return new NemoError(402, 'insufficient_credits', 'Out of credits for this key.', body);
  if (res.status === 429) return new NemoError(429, 'rate_limited', 'Rate limit reached. Try again shortly.', body);
  if (res.status === 400 && /guardrail|blocked|violat|flagged/i.test(JSON.stringify(body || ''))) {
    return new NemoError(400, 'guardrail_blocked', detail || 'Request blocked by a content guardrail.', body);
  }
  return new NemoError(res.status, 'upstream_error', detail || 'Upstream error', body);
}

// A message's content is a string, or OpenAI-style multimodal parts (text + image_url for vision).
export type MessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
}

/** OpenAI-style function tool spec (what the gateway's tool.openai_spec() returns). */
export interface ToolFunctionSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** A tool call the model asked us to make (OpenAI function-calling shape). */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatOptions {
  model: string; // model OR model_group alias — Nemo applies routing/fallback.
  messages: ChatMessage[];
  guardrails?: string[]; // optional per-request guardrails ON TOP of the key's defaults.
  temperature?: number;
  maxTokens?: number;
  sessionId?: string; // forwarded as metadata for per-session observability.
  tools?: ToolFunctionSpec[]; // function-calling specs (tool-decision rounds only).
}

/** One NON-streaming completion. Used for the tool-decision rounds of the agent
 *  loop (we need the structured tool_calls back before streaming a final answer).
 *  Returns the assistant text + any tool calls the model requested. */
export async function chatComplete(
  opts: ChatOptions,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: false,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1024,
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
      ...(opts.guardrails?.length ? { guardrails: opts.guardrails } : {}),
      metadata: { source: 'agent-market-place', session_id: opts.sessionId },
    }),
  });
  if (!res.ok) throw await toNemoError(res);
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      };
    }>;
  };
  const msg = json.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc, i) => {
    let args: Record<string, unknown> = {};
    try {
      args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      args = {};
    }
    return { id: tc.id || `call_${i}`, name: tc.function?.name || '', arguments: args };
  });
  return { content: typeof msg.content === 'string' ? msg.content : '', toolCalls };
}

/** Streaming chat completion. Returns the raw SSE Response from Nemo so the route
 *  can pipe it straight to the browser. Guardrails/routing/credits already applied. */
export async function chatStream(opts: ChatOptions): Promise<Response> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1024,
      // Nemo/LiteLLM read guardrails + metadata from the request body. We pass them
      // through but NEVER set cost or bypass flags — Nemo owns cost tracking (Rule #4).
      ...(opts.guardrails?.length ? { guardrails: opts.guardrails } : {}),
      metadata: { source: 'agent-market-place', session_id: opts.sessionId },
    }),
  });
  if (!res.ok || !res.body) throw await toNemoError(res);
  return res;
}

/** Embed texts via Nemo. Used for ingestion + query embeddings (one provider, one bill). */
export async function embed(model: string, input: string[]): Promise<number[][]> {
  const res = await fetch(`${BASE}/v1/embeddings`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ model, input }),
  });
  if (!res.ok) throw await toNemoError(res);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}
