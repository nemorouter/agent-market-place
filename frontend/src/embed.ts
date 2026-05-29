/**
 * @nemorouter/agent-widget — standalone, embeddable "Ask AI" chat widget.
 *
 * ZERO dependencies, ZERO framework. Renders a floating chat button + panel in
 * a Shadow DOM (so host-page CSS can't leak in or out) and streams answers from
 * the central Nemo MCP gateway via the shared `core.ts` client. Deploy this
 * separately (CDN bundle or npm) — the gateway stays inside nemo-backend.
 *
 * Usage (script embed):
 *   <script src="https://cdn.nemorouter.ai/agent-widget.js"></script>
 *   <script>
 *     NemoAgentWidget.mount({
 *       // EITHER a same-origin proxy (recommended for public sites — key stays server-side):
 *       proxyPath: '/api/public/ask',
 *       // OR direct to the gateway with the visitor's own key:
 *       // apiBase: 'https://api.nemorouter.ai', agentId: 'nemo-support', apiKey: 'sk-nemo-…',
 *       title: 'Ask AI about Acme',
 *     });
 *   </script>
 *
 * Usage (npm):
 *   import { mount } from '@nemorouter/agent-widget';
 *   mount({ apiKey: () => getMyKey(), agentId: 'my-agent' });
 */

import { streamAgentTurn, type AgentChatConfig, type AgentMessage } from './core';

export interface WidgetOptions extends AgentChatConfig {
  /** Panel header title. Default "Ask AI". */
  title?: string;
  /** Accent color for the launcher + send button. Default Nemo mint. */
  accent?: string;
  /** Seed suggestion chips. */
  suggestions?: string[];
  /** Element to mount into. Default: document.body. */
  target?: HTMLElement;
}

const ACCENT = '#10b981';

const STYLE = `
:host { all: initial; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
* { box-sizing: border-box; }
.launcher { position: fixed; bottom: 20px; right: 20px; z-index: 2147483000; display: inline-flex;
  align-items: center; gap: 8px; padding: 10px 16px 10px 12px; border: 1px solid rgba(9,9,11,.1);
  border-radius: 999px; background: #fff; color: #09090b; font-size: 14px; font-weight: 600;
  box-shadow: 0 8px 30px -8px rgba(9,9,11,.28); cursor: pointer; }
.launcher:hover { transform: translateY(-1px); }
.dot { display: inline-flex; height: 26px; width: 26px; align-items: center; justify-content: center;
  border-radius: 999px; background: var(--accent); color: #fff; font-size: 14px; }
.panel { position: fixed; bottom: 20px; right: 20px; z-index: 2147483000; display: flex; flex-direction: column;
  width: min(384px, calc(100vw - 32px)); max-height: min(70vh, 560px); background: #fff;
  border: 1px solid rgba(9,9,11,.08); border-radius: 16px; overflow: hidden;
  box-shadow: 0 24px 64px -16px rgba(9,9,11,.34); }
.hd { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid rgba(9,9,11,.06); }
.hd b { font-size: 14px; color: #09090b; font-weight: 600; }
.x { border: 0; background: none; cursor: pointer; color: #71717a; font-size: 18px; line-height: 1; padding: 4px 8px; }
.body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.intro { font-size: 13px; color: #52525b; line-height: 1.5; }
.sugg { display: flex; flex-direction: column; gap: 8px; }
.sugg button { border: 1px solid rgba(9,9,11,.1); background: #fff; border-radius: 8px; padding: 8px 12px;
  text-align: left; font-size: 13px; color: #52525b; cursor: pointer; }
.sugg button:hover { background: #f4f4f5; color: #09090b; }
.row { display: flex; }
.row.user { justify-content: flex-end; }
.bubble { max-width: 85%; padding: 8px 14px; border-radius: 16px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
.user .bubble { background: #09090b; color: #fff; border-bottom-right-radius: 4px; }
.bot .bubble { background: #f4f4f5; color: #3f3f46; border-bottom-left-radius: 4px; }
.steps { display: flex; flex-direction: column; gap: 4px; margin: 2px 0; }
.step { font-size: 11px; color: #71717a; display: flex; align-items: center; gap: 6px; }
.step .spin { width: 10px; height: 10px; border: 2px solid rgba(9,9,11,.15); border-top-color: var(--accent);
  border-radius: 999px; animation: nspin .7s linear infinite; }
.step.done .spin { border: 0; }
.step.done::before { content: '✓'; color: var(--accent); }
@keyframes nspin { to { transform: rotate(360deg); } }
.err { font-size: 12px; color: #52525b; background: #f4f4f5; border: 1px solid rgba(9,9,11,.1);
  border-radius: 8px; padding: 8px 12px; }
.composer { border-top: 1px solid rgba(9,9,11,.06); padding: 12px; display: flex; gap: 8px; }
.composer textarea { flex: 1; resize: none; border: 1px solid rgba(9,9,11,.1); border-radius: 10px;
  padding: 8px 12px; font-size: 13px; font-family: inherit; max-height: 96px; outline: none; }
.composer button { width: 36px; border: 0; border-radius: 10px; background: var(--accent); color: #fff;
  font-size: 16px; cursor: pointer; }
.composer button:disabled { opacity: .4; cursor: not-allowed; }
.foot { font-size: 10px; color: #a1a1aa; padding: 0 12px 10px; }
`;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Mount the widget. Returns an unmount function. */
export function mount(opts: WidgetOptions = {}): () => void {
  const host = el('div');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.appendChild(style);
  (root.host as HTMLElement).style.setProperty('--accent', opts.accent ?? ACCENT);

  const title = opts.title ?? 'Ask AI';
  const config: AgentChatConfig = {
    apiBase: opts.apiBase,
    agentId: opts.agentId,
    apiKey: opts.apiKey,
    proxyPath: opts.proxyPath,
  };
  const history: AgentMessage[] = [];
  let streaming = false;
  let aborter: AbortController | null = null;

  // Launcher
  const launcher = el('button', 'launcher');
  launcher.innerHTML = `<span class="dot">✦</span> ${title}`;
  root.appendChild(launcher);

  // Panel
  const panel = el('div', 'panel');
  panel.style.display = 'none';
  const hd = el('div', 'hd');
  hd.appendChild(el('b', undefined, title));
  const closeBtn = el('button', 'x', '×');
  hd.appendChild(closeBtn);
  const body = el('div', 'body');
  const composer = el('div', 'composer');
  const ta = el('textarea') as HTMLTextAreaElement;
  ta.rows = 1;
  ta.placeholder = 'Ask a question…';
  const sendBtn = el('button', undefined, '↑') as HTMLButtonElement;
  composer.append(ta, sendBtn);
  const foot = el('div', 'foot', 'AI-generated · may be imperfect.');
  panel.append(hd, body, composer, foot);
  root.appendChild(panel);

  const renderIntro = () => {
    body.innerHTML = '';
    const intro = el('div', 'intro', `Ask anything — answered live by the ${opts.agentId ?? 'nemo-support'} agent.`);
    body.appendChild(intro);
    const sugg = el('div', 'sugg');
    for (const q of opts.suggestions ?? ['How does pricing work?', 'Is it OpenAI-compatible?']) {
      const b = el('button', undefined, q);
      b.addEventListener('click', () => void send(q));
      sugg.appendChild(b);
    }
    body.appendChild(sugg);
  };

  const addRow = (role: 'user' | 'bot'): HTMLElement => {
    const row = el('div', `row ${role}`);
    const bubble = el('div', 'bubble');
    row.appendChild(bubble);
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
    return bubble;
  };

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    if (history.length === 0) body.innerHTML = '';
    history.push({ role: 'user', content: trimmed });
    addRow('user').textContent = trimmed;
    ta.value = '';

    const steps = el('div', 'steps');
    body.appendChild(steps);
    const bubble = addRow('bot');
    bubble.textContent = '…';
    streaming = true;
    sendBtn.disabled = true;
    aborter = new AbortController();
    let acc = '';

    await streamAgentTurn(
      config,
      history,
      {
        onToolStep: (s) => {
          let node = steps.querySelector<HTMLElement>(`[data-tool="${s.tool}"]`);
          if (!node) {
            node = el('div', 'step');
            node.dataset.tool = s.tool;
            node.innerHTML = `<span class="spin"></span><span>${s.title}…</span>`;
            steps.appendChild(node);
          }
          if (s.status === 'done') node.className = 'step done';
          body.scrollTop = body.scrollHeight;
        },
        onContent: (_d, full) => {
          acc = full;
          bubble.textContent = full;
          body.scrollTop = body.scrollHeight;
        },
        onError: (msg) => {
          bubble.remove();
          const e = el('div', 'err', msg);
          body.appendChild(e);
        },
        onDone: (full) => {
          if (full) history.push({ role: 'assistant', content: full });
        },
      },
      aborter.signal,
    );

    if (!acc) bubble.remove();
    streaming = false;
    sendBtn.disabled = false;
    aborter = null;
  }

  // Wiring
  launcher.addEventListener('click', () => {
    panel.style.display = 'flex';
    launcher.style.display = 'none';
    if (history.length === 0) renderIntro();
    ta.focus();
  });
  closeBtn.addEventListener('click', () => {
    panel.style.display = 'none';
    launcher.style.display = 'inline-flex';
  });
  sendBtn.addEventListener('click', () => void send(ta.value));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(ta.value);
    }
  });

  (opts.target ?? document.body).appendChild(host);
  return () => {
    aborter?.abort();
    host.remove();
  };
}

// UMD-ish global for the <script> embed.
declare global {
  interface Window {
    NemoAgentWidget?: { mount: typeof mount };
  }
}
if (typeof window !== 'undefined') {
  window.NemoAgentWidget = { mount };
}
