// widget/embed.ts — embeddable chat widget styled to match the Nemo Router "Ask AI"
// agent (AskNemoWidget): pill launcher with a mint Sparkles badge, a warm-sheet
// floating card, live subtitle, and a dark round send button. Self-contained vanilla
// JS (no deps), iframe-free, one <script> tag:
//
//   <script src=".../widget.js"
//           data-endpoint=".../api/chat"
//           data-title="Ask AI Guru"
//           data-subtitle="Answered live by Nemo Router"></script>
//
// Talks ONLY to data-endpoint — the sk-nemo key never reaches the browser.
(function () {
  const script = document.currentScript as HTMLScriptElement | null;
  const endpoint = script?.dataset.endpoint || '/api/chat';
  const title = script?.dataset.title || 'Ask AI Guru';
  const subtitle = script?.dataset.subtitle || 'Answered live by Nemo Router';

  // Nemo palette (light) — copied from globals.css tokens for an exact match.
  const C = {
    ink: '#0f0e0c',
    ink2: '#1c1b18',
    muted: '#76716a',
    surface: '#ffffff',
    hover: '#f1efe9',
    border: 'rgba(15,14,12,0.10)',
    mint: '#90fca6',
    onMint: '#000000',
    sheet: 'linear-gradient(176deg,#fdeee6 0%,#faf3ec 26%,#f6f4ef 58%,#eef7f0 100%)',
  };
  const SPARKLES =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';
  const SEND =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>';
  const FONT =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const sessionId =
    (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() || String(Date.now());
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // ── Launcher pill ──────────────────────────────────────────────────────────
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', title);
  launcher.style.cssText =
    `position:fixed;bottom:20px;right:20px;z-index:2147483646;display:inline-flex;align-items:center;gap:8px;` +
    `border:1px solid ${C.border};background:${C.surface};border-radius:999px;padding:10px 16px 10px 10px;` +
    `font:600 14px ${FONT};color:${C.ink};cursor:pointer;box-shadow:0 8px 30px -8px rgba(9,9,11,.28);` +
    `transition:transform .15s ease,box-shadow .15s ease`;
  launcher.innerHTML =
    `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;` +
    `border-radius:999px;background:${C.mint};color:${C.onMint};padding:6px;box-sizing:border-box">${SPARKLES}</span>` +
    `<span>${title}</span>`;
  launcher.onmouseenter = () => (launcher.style.transform = 'translateY(-2px)');
  launcher.onmouseleave = () => (launcher.style.transform = 'none');

  // ── Panel ──────────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.style.cssText =
    `position:fixed;right:20px;bottom:20px;z-index:2147483647;display:none;flex-direction:column;overflow:hidden;` +
    `width:min(424px,calc(100vw - 32px));height:min(78vh,640px);border:1px solid ${C.border};border-radius:16px;` +
    `background:${C.sheet};box-shadow:0 24px 64px -16px rgba(9,9,11,.34);font:400 14px ${FONT};color:${C.ink2}`;
  panel.innerHTML =
    // header
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px">` +
    `  <div style="display:flex;align-items:center;gap:10px">` +
    `    <span style="display:inline-flex;width:18px;height:18px;color:${C.ink}">${SPARKLES}</span>` +
    `    <div style="line-height:1.2">` +
    `      <div style="font:600 14px ${FONT};color:${C.ink}">${title}</div>` +
    `      <div style="font:400 11px ${FONT};color:${C.muted}">${subtitle}</div>` +
    `    </div>` +
    `  </div>` +
    `  <button id="ag-close" aria-label="Close" style="display:inline-flex;align-items:center;justify-content:center;` +
    `    width:32px;height:32px;border:0;background:transparent;border-radius:8px;color:${C.muted};cursor:pointer;font-size:18px">✕</button>` +
    `</div>` +
    // messages
    `<div id="ag-log" style="flex:1;overflow:auto;padding:8px 16px 16px;display:flex;flex-direction:column;gap:12px"></div>` +
    // composer
    `<div style="padding:12px 16px 16px">` +
    `  <div style="display:flex;align-items:flex-end;gap:8px;border:1px solid ${C.border};background:${C.surface};` +
    `    border-radius:16px;padding:8px 8px 8px 14px;box-shadow:0 2px 10px -4px rgba(9,9,11,.12)">` +
    `    <textarea id="ag-in" rows="1" placeholder="Ask a question…" style="flex:1;resize:none;border:0;outline:none;` +
    `      background:transparent;font:400 15px ${FONT};color:${C.ink};max-height:120px;line-height:1.5"></textarea>` +
    `    <button id="ag-send" aria-label="Send" style="display:inline-flex;align-items:center;justify-content:center;` +
    `      width:36px;height:36px;flex:0 0 auto;border:0;background:${C.ink};color:${C.surface};border-radius:999px;cursor:pointer">${SEND}</button>` +
    `  </div>` +
    `</div>`;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  const log = panel.querySelector('#ag-log') as HTMLDivElement;
  const input = panel.querySelector('#ag-in') as HTMLTextAreaElement;
  const sendBtn = panel.querySelector('#ag-send') as HTMLButtonElement;

  function setOpen(v: boolean) {
    panel.style.display = v ? 'flex' : 'none';
    launcher.style.display = v ? 'none' : 'inline-flex';
    if (v) {
      if (!messages.length) greet();
      input.focus();
    }
  }
  launcher.onclick = () => setOpen(true);
  (panel.querySelector('#ag-close') as HTMLButtonElement).onclick = () => setOpen(false);

  function bubble(role: 'user' | 'assistant', text: string): HTMLDivElement {
    const b = document.createElement('div');
    if (role === 'user') {
      b.style.cssText =
        `align-self:flex-end;max-width:85%;padding:9px 13px;border-radius:16px 16px 4px 16px;` +
        `background:${C.ink};color:${C.surface};font:400 14px ${FONT};white-space:pre-wrap;line-height:1.5`;
    } else {
      b.style.cssText =
        `align-self:flex-start;max-width:92%;color:${C.ink2};font:400 14px ${FONT};white-space:pre-wrap;line-height:1.55`;
    }
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }
  function greet() {
    bubble('assistant', `Hi! I'm ${title}. Ask me anything about Nemo Router.`);
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    messages.push({ role: 'user', content: text });
    bubble('user', text);
    const out = bubble('assistant', '…');

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, sessionId }),
      });
    } catch {
      out.textContent = '⚠️ Network error. Please try again.';
      return;
    }
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
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
})();
