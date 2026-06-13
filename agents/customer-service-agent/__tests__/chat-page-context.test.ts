import { describe, it, expect, vi, beforeEach } from 'vitest';

// Verifies the chat route folds the visitor's current page (pageContext) into the
// system prompt so the agent can give page-aware help — and omits it when absent.

// Capture the system message handed to the model.
const chatStream = vi.fn();
class NemoError extends Error {
  constructor(public code: string, public status: number, msg: string) {
    super(msg);
  }
}
vi.mock('@/lib/nemo', () => ({
  chatStream,
  chatComplete: vi.fn(),
  NemoError,
}));

vi.mock('@/lib/config', () => ({
  loadConfig: () => ({
    id: 'guru',
    embeddingModel: 'e',
    topK: 4,
    maxSteps: 3,
    guardrails: [],
    webSearch: { confidenceHigh: 0.8, confidenceLow: 0.3, autoOnLowConfidence: false, site: '', provider: '' },
    security: {
      allowedOrigins: ['http://localhost:3000'],
      rateLimit: { perIpPerMin: 100, perSessionPerMin: 100 },
      captcha: { enabled: false, provider: 'turnstile', trigger: 'always' },
      limits: { maxMessages: 50, maxMessageChars: 10000, maxTotalChars: 50000 },
    },
    identity: { mode: 'none', greet: false, links: [] },
  }),
}));
vi.mock('@/lib/settings', () => ({
  loadSettings: async () => ({ systemPrompt: 'You are Guru.', model: 'm', enabledTools: [], webSearchEnabled: false, webSearchSite: '', webSearchProvider: '' }),
}));
vi.mock('@/lib/retrieval', () => ({ retrieve: async () => [] }));
vi.mock('@/lib/tools', () => ({ listTools: vi.fn(), callTool: vi.fn(), runToolLoop: vi.fn() }));
vi.mock('@/lib/credentials', () => ({ getCredential: vi.fn(), listCredentialedToolIds: async () => [] }));
vi.mock('@/lib/confidence', () => ({ scoreConfidence: () => ({ level: 'high', score: 0.9 }) }));
vi.mock('@/lib/web-search', () => ({ webSearch: vi.fn() }));
vi.mock('@/lib/gaps', () => ({ logGap: vi.fn() }));
vi.mock('@/lib/identity', () => ({ resolveIdentity: async () => ({ docAudiences: ['public'] }), buildPersona: () => '' }));
// Keep the REAL sanitizePageContext; stub only the abuse gates so the path runs.
vi.mock('@/lib/security', async () => {
  const actual = await vi.importActual<typeof import('../lib/security')>('../lib/security');
  return {
    ...actual,
    originAllowed: () => true,
    rateLimitAsync: async () => true,
    verifyCaptcha: async () => true,
    clientIp: () => '1.2.3.4',
    captchaTriggerCount: () => 99,
    validateChatPayload: () => ({ ok: true }),
  };
});

const { POST } = await import('../app/api/chat/route');

function streamResponse() {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
      c.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

function req(body: unknown) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  chatStream.mockReset();
  chatStream.mockResolvedValue(streamResponse());
});

function systemContent() {
  const msgs = chatStream.mock.calls[0][0].messages as Array<{ role: string; content: string }>;
  return msgs.find((m) => m.role === 'system')!.content;
}

describe('chat route — page context', () => {
  it('folds the visitor page into the system prompt', async () => {
    await POST(req({ messages: [{ role: 'user', content: 'help' }], pageContext: '/onboarding?token=secret' }));
    const sys = systemContent();
    expect(sys).toContain('The visitor is currently on the page "/onboarding"');
    expect(sys).not.toContain('secret'); // query string is dropped
  });

  it('omits the page hint when no pageContext is sent', async () => {
    await POST(req({ messages: [{ role: 'user', content: 'help' }] }));
    expect(systemContent()).not.toContain('currently on the page');
  });
});
