'use client';

// A minimal, themable chat tester. The same /api/chat endpoint backs the embeddable
// widget (widget/embed.ts). Theme via CSS variables — override --agent-* to rebrand.
//
// EXTENSION POINT (frontend): swap this component, add slots (header, bubble,
// launcher), or wire events (onMessage, onCitation) — it's your app.
import { useState, useRef } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };

const theme: React.CSSProperties = {
  // @ts-expect-error — CSS custom properties
  '--agent-accent': '#4f46e5',
  '--agent-bg': '#ffffff',
  '--agent-user': '#eef2ff',
  '--agent-ink': '#0a0a0a',
};

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const sessionId = useRef<string>('');
  if (!sessionId.current && typeof crypto !== 'undefined') sessionId.current = crypto.randomUUID();

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: next, sessionId: sessionId.current }),
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: 'error' }));
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${err.message || err.error}` }]);
      setBusy(false);
      return;
    }

    // Stream the SSE response from /api/chat (which proxies Nemo).
    setMessages((m) => [...m, { role: 'assistant', content: '' }]);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (delta) {
            acc += delta;
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: 'assistant', content: acc };
              return copy;
            });
          }
        } catch {
          /* keep-alive / non-JSON line */
        }
      }
    }
    setBusy(false);
  }

  return (
    <main style={{ ...theme, maxWidth: 640, margin: '40px auto', padding: 16, color: 'var(--agent-ink)' }}>
      <h1 style={{ fontSize: 20 }}>{process.env.NEXT_PUBLIC_AGENT_NAME || 'Support Agent'}</h1>
      <div style={{ minHeight: 320, display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0' }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              background: m.role === 'user' ? 'var(--agent-user)' : '#f6f6f6',
              padding: '8px 12px',
              borderRadius: 12,
              maxWidth: '80%',
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.content}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Ask a question…"
          style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd' }}
        />
        <button
          onClick={send}
          disabled={busy}
          style={{ padding: '10px 16px', borderRadius: 10, border: 0, background: 'var(--agent-accent)', color: '#fff' }}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </main>
  );
}
