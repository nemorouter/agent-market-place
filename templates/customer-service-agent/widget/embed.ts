// widget/embed.ts — the embeddable launcher. Build this to a single widget.js and
// host it; customers drop ONE <script> tag on their site:
//
//   <script src="https://YOUR-DEPLOY/widget.js"
//           data-endpoint="https://YOUR-DEPLOY/api/chat"
//           data-accent="#4f46e5"
//           data-title="Acme Support"></script>
//
// The widget talks ONLY to your /api/chat — the sk-nemo key never reaches the
// browser. Theme via the data-* attributes (extension point: add your own).
(function () {
  const script = document.currentScript as HTMLScriptElement | null;
  const endpoint = script?.dataset.endpoint || '/api/chat';
  const accent = script?.dataset.accent || '#4f46e5';
  const title = script?.dataset.title || 'Support';

  const sessionId =
    (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() || String(Date.now());
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;bottom:88px;right:24px;width:360px;max-height:520px;display:none;flex-direction:column;' +
    'background:#fff;border:1px solid #e5e5e5;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);overflow:hidden;font-family:system-ui,sans-serif;z-index:2147483647';
  panel.innerHTML =
    `<div style="padding:14px 16px;background:${accent};color:#fff;font-weight:600">${title}</div>` +
    `<div id="nemo-log" style="flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px"></div>` +
    `<div style="display:flex;gap:8px;padding:10px;border-top:1px solid #eee">` +
    `<input id="nemo-in" placeholder="Ask a question…" style="flex:1;padding:9px 11px;border:1px solid #ddd;border-radius:9px"/>` +
    `<button id="nemo-send" style="border:0;background:${accent};color:#fff;border-radius:9px;padding:0 14px">Send</button></div>`;

  const launcher = document.createElement('button');
  launcher.textContent = '💬';
  launcher.style.cssText =
    `position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;border:0;background:${accent};` +
    'color:#fff;font-size:22px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.22);z-index:2147483647';
  launcher.onclick = () => {
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  };

  document.body.appendChild(panel);
  document.body.appendChild(launcher);

  const log = panel.querySelector('#nemo-log') as HTMLDivElement;
  const input = panel.querySelector('#nemo-in') as HTMLInputElement;
  const sendBtn = panel.querySelector('#nemo-send') as HTMLButtonElement;

  function bubble(role: 'user' | 'assistant', text: string): HTMLDivElement {
    const b = document.createElement('div');
    b.style.cssText =
      `align-self:${role === 'user' ? 'flex-end' : 'flex-start'};max-width:80%;padding:8px 11px;border-radius:11px;` +
      `white-space:pre-wrap;background:${role === 'user' ? '#eef2ff' : '#f5f5f5'}`;
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    messages.push({ role: 'user', content: text });
    bubble('user', text);
    const out = bubble('assistant', '…');

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, sessionId }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: 'error' }));
      out.textContent = `⚠️ ${err.message || err.error}`;
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let acc = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of dec.decode(value).split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const p = t.slice(5).trim();
        if (p === '[DONE]') continue;
        try {
          const d = JSON.parse(p)?.choices?.[0]?.delta?.content;
          if (d) {
            acc += d;
            out.textContent = acc;
            log.scrollTop = log.scrollHeight;
          }
        } catch {
          /* keep-alive */
        }
      }
    }
    messages.push({ role: 'assistant', content: acc });
  }

  sendBtn.onclick = send;
  input.addEventListener('keydown', (e) => e.key === 'Enter' && send());
})();
