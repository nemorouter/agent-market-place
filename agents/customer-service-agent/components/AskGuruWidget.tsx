'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Sparkles,
  X,
  Send,
  Mic,
  Plus,
  Bot,
  Check,
  Loader2,
  Square,
  RotateCcw,
  Maximize2,
  Minimize2,
  Boxes,
  Tag,
  BookOpen,
  Terminal,
  LifeBuoy,
  ChevronRight,
  Phone,
  Mail,
  Link2,
  ThumbsUp,
  ThumbsDown,
  Globe,
  type LucideIcon,
} from 'lucide-react';

/** Lightweight, dependency-free markdown renderer for assistant answers:
 *  paragraphs, bullet / numbered lists, **bold**, `code`, and clickable links.
 *  Builds React nodes (never dangerouslySetInnerHTML) so it's injection-safe.
 *  The support agent cites docs URLs — rendering them as links cuts eye-travel. */
const _INLINE = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g;

function renderInline(text: string, kp: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  _INLINE.lastIndex = 0;
  while ((m = _INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={`${kp}-${i++}`}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    if (tok.startsWith('**')) {
      out.push(
        <strong key={`${kp}-${i++}`} className="font-semibold text-[var(--text-primary)]">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith('`')) {
      out.push(
        <code
          key={`${kp}-${i++}`}
          className="rounded bg-[var(--surface-secondary)] px-1 py-0.5 font-mono text-[12px] [overflow-wrap:anywhere]"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(
        <a
          key={`${kp}-${i++}`}
          href={tok}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[var(--nemo-indigo)] underline underline-offset-2 [overflow-wrap:anywhere] hover:text-[var(--nemo-indigo-dark)]"
        >
          {tok.replace(/^https?:\/\//, '')}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<span key={`${kp}-${i++}`}>{text.slice(last)}</span>);
  return out;
}

const _BULLET = /^\s*[-*•]\s+/;
const _NUMBERED = /^\s*\d+[.)]\s+/;
const _HEADING = /^\s*#{1,4}\s+(.*)$/;

/** Line-based renderer: groups consecutive bullet / numbered lines into real
 *  lists even when they share a block with an intro line (single newlines).
 *  Handles headings, bullet/numbered lists, paragraphs, **bold**, `code`, links. */
function renderMarkdownLite(text: string): ReactNode[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  let k = 0;

  const flushPara = () => {
    if (para.length) {
      const key = `p${k++}`;
      out.push(
        <p key={key} className="leading-relaxed">
          {renderInline(para.join(' '), key)}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const key = `l${k++}`;
      const items = list.map((l, li) => (
        <li key={li} className="pl-0.5 leading-relaxed marker:text-[var(--text-muted)]">
          {renderInline(l, `${key}i${li}`)}
        </li>
      ));
      out.push(
        listKind === 'ol' ? (
          <ol key={key} className="list-decimal space-y-1.5 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={key} className="list-disc space-y-1.5 pl-5">
            {items}
          </ul>
        ),
      );
      list = [];
      listKind = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const heading = line.match(_HEADING);
    if (heading) {
      flushPara();
      flushList();
      const key = `h${k++}`;
      out.push(
        <p key={key} className="font-semibold text-[var(--text-primary)]">
          {renderInline(heading[1], key)}
        </p>,
      );
      continue;
    }
    if (_BULLET.test(line)) {
      flushPara();
      if (listKind === 'ol') flushList();
      listKind = 'ul';
      list.push(line.replace(_BULLET, ''));
      continue;
    }
    if (_NUMBERED.test(line)) {
      flushPara();
      if (listKind === 'ul') flushList();
      listKind = 'ol';
      list.push(line.replace(_NUMBERED, ''));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * AskNemoWidget — "Ask AI Guru about NemoRouter" chat. Streams answers from our
 * OWN gateway via /api/chat. Mounted once in the (landingPages) layout.
 *
 * Layout: a warm-gradient sheet (Verizon-style). On mobile it's a tall bottom
 * sheet (its own layout — no desktop-popup bleed); on >=sm it's a floating
 * card that can expand to a two-pane (quick-links rail + chat). The empty state
 * is a centered hero (headline + big input + suggestion grid); once a thread
 * starts it switches to messages + a pinned composer.
 *
 * Voice mode: the mic uses the Web Speech API (SpeechRecognition) to transcribe
 * speech into the composer live, then auto-sends. Feature-detected in an effect
 * (never reads `window` during render — Rule #24). Graceful: the mic only shows
 * where the API exists.
 *
 * Flat-icon discipline (Rule #27): bare line icons, strokeWidth 1.5. The send /
 * mic are interactive controls (filled affordances), not feature glyphs.
 * No Date.now()/Math.random()/localStorage in render (Rule #24).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

interface ToolStep {
  tool: string;
  title: string;
  status: 'running' | 'done';
}

interface Citation {
  title: string;
  url: string | null;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  steps?: ToolStep[];
  citations?: Citation[];
  /** Answer confidence the KB matched ('high'|'medium'|'low'), surfaced by the server. */
  confidence?: 'high' | 'medium' | 'low';
  /** True when this answer was grounded by a live web search. */
  webSearched?: boolean;
  /** The user question this answer responded to (for feedback + web re-ask). */
  question?: string;
  /** The visitor's rating once given (locks the buttons). */
  feedback?: 'up' | 'down';
  /** For a 👎: the reason the visitor picked for why it wasn't helpful. */
  feedbackReason?: string;
}

/** The "what was wrong?" options shown after a 👎 — captured for journey analytics. */
const DOWN_REASONS = ['Incorrect', 'Incomplete', "Not what I asked", "Couldn't find it"] as const;

/* Minimal Web Speech API surface — the DOM lib ships these as `any`/absent
 * across browsers, so we type only what we touch. */
interface SpeechResultAlt {
  transcript: string;
}
interface SpeechResult {
  0: SpeechResultAlt;
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const SUGGESTIONS = [
  'How does the platform fee work?',
  'Which models are live today?',
  'Is it OpenAI-compatible?',
  'How is this different from OpenRouter?',
] as const;

/** Fallback quick links — used only if /api/config returns none. The operator
 *  edits the live list (and contact methods) from the /admin dashboard. */
const FALLBACK_QUICK_LINKS: Array<{ label: string; href: string }> = [
  { label: 'Models', href: '/models' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Docs', href: '/docs' },
  { label: 'Playground', href: '/playground' },
];

type ContactMethod = { type: 'phone' | 'email' | 'url'; label: string; value: string };

/** Browser-safe agent settings the widget pulls from /api/config on open. */
interface WidgetConfig {
  agentName: string | null;
  suggestions: string[];
  quickLinks: Array<{ label: string; href: string }>;
  contactMethods: ContactMethod[];
}

/** Map a quick-link label to a flat line icon (best-effort; falls back to Link2).
 *  Flat icon, no chip behind the glyph (Rule #27). */
function linkIcon(label: string): LucideIcon {
  const l = label.toLowerCase();
  if (l.includes('model')) return Boxes;
  if (l.includes('pric') || l.includes('plan')) return Tag;
  if (l.includes('doc')) return BookOpen;
  if (l.includes('play') || l.includes('console')) return Terminal;
  if (l.includes('support') || l.includes('contact') || l.includes('help')) return LifeBuoy;
  return Link2;
}

/** Client-side href builder for a contact method. The server (lib/settings.ts)
 *  has already sanitized these, so we only translate type → scheme. */
function contactToHref(m: ContactMethod): string {
  if (m.type === 'phone') {
    const lead = m.value.trim().startsWith('+') ? '+' : '';
    return `tel:${lead}${m.value.replace(/[^\d]/g, '')}`;
  }
  if (m.type === 'email') return `mailto:${m.value.trim()}`;
  return m.value;
}

function contactIcon(type: ContactMethod['type']): LucideIcon {
  if (type === 'phone') return Phone;
  if (type === 'email') return Mail;
  return LifeBuoy;
}

/** Warm peach→cream→mint gradient (Verizon-style warmth, on-brand mint foot).
 *  Light only; dark mode falls back to the warm dashboard-sidebar surface. */
const WARM_SHEET =
  'bg-[linear-gradient(176deg,#fdeee6_0%,#faf3ec_26%,#f6f4ef_58%,#eef7f0_100%)] dark:bg-[var(--surface-secondary)]';

export function AskGuruWidget({
  defaultOpen = false,
  defaultExpanded = false,
}: { defaultOpen?: boolean; defaultExpanded?: boolean } = {}) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // Pluggable login layer: resolved server-side via /api/session (cookie / proxy
  // header / introspection). Anonymous by default; personalizes the greeting +
  // quick-links when the visitor is signed in. See lib/identity.ts.
  const [identity, setIdentity] = useState<{
    authenticated: boolean;
    displayName: string | null;
    links: Array<{ label: string; url: string }>;
  }>({ authenticated: false, displayName: null, links: [] });
  // Operator-editable presentation, pulled from /api/config on open. Suggestions,
  // quick links, and contact methods (phone/email/support) are all configured from
  // the /admin dashboard — no redeploy. Falls back to built-in defaults on failure.
  const [config, setConfig] = useState<WidgetConfig>({
    agentName: null,
    suggestions: [],
    quickLinks: [],
    contactMethods: [],
  });
  // Optional forwarded identity token (cross-origin embed only — same-site uses
  // the cookie and never sets this). Held in a ref so send() always reads the
  // latest without re-binding; mirrored in state to retrigger the session fetch.
  const [identityToken, setIdentityToken] = useState<string | null>(null);
  const identityTokenRef = useRef<string | null>(null);

  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Stable per-conversation id — ties chat turns + feedback together server-side.
  // Lazy init is fine here (ref, not render output) and must not read crypto at module load.
  const sessionIdRef = useRef<string>('');
  if (!sessionIdRef.current) {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `s-${idRef.current}-${Math.floor(Math.random() * 1e9)}`;
  }
  const lastQueryRef = useRef('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseRef = useRef('');
  const nextId = () => ++idRef.current;
  const hasThread = messages.length > 0;

  // Config-driven UI with built-in fallbacks (operator edits these in /admin).
  const suggestions = config.suggestions.length ? config.suggestions : [...SUGGESTIONS];
  const quickLinks = config.quickLinks.length ? config.quickLinks : FALLBACK_QUICK_LINKS;
  const contactMethods = config.contactMethods;
  // Header title reflects the operator-configured agent name once /api/config loads.
  const agentTitle = config.agentName || 'Ask AI Guru about Nemo Router';

  // Feature-detect voice support once mounted (never read `window` in render).
  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    setVoiceSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  // Auto-scroll to the latest message as it streams in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  // Focus the input when the panel opens; Esc closes.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Stop voice capture whenever the panel closes.
  useEffect(() => {
    if (!open) recognitionRef.current?.abort();
  }, [open]);

  // Receive an optional host-forwarded identity token (cross-origin embed only).
  // Same-site deploys authenticate via the cookie and never get this message. The
  // token is a signed JWT the server verifies — the page just forwards it.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __askguru_identity?: unknown } | undefined;
      if (!d || !('__askguru_identity' in d)) return;
      const tok = typeof d.__askguru_identity === 'string' ? d.__askguru_identity : null;
      identityTokenRef.current = tok;
      setIdentityToken(tok);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Resolve the signed-in visitor when the panel opens (and again if a token
  // arrives). Server-side via /api/session (never in render — Rule #24);
  // failures are swallowed → stays anonymous. Cookie is sent automatically
  // (same-origin); a forwarded token rides as a bearer header when present.
  useEffect(() => {
    if (!open) return;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (identityToken) headers.authorization = `Bearer ${identityToken}`;
    let cancelled = false;
    fetch('/api/session', { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || !d.authenticated) return;
        setIdentity({
          authenticated: true,
          displayName: typeof d.displayName === 'string' ? d.displayName : null,
          links: Array.isArray(d.links) ? d.links : [],
        });
      })
      .catch(() => {
        /* anonymous fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [open, identityToken]);

  // Pull the operator-configured presentation (suggestions / quick links / contact
  // methods) once the panel opens. Best-effort — failures keep the built-in defaults.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/config', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setConfig({
          agentName: typeof d.agentName === 'string' ? d.agentName : null,
          suggestions: Array.isArray(d.suggestions) ? d.suggestions.filter((s: unknown) => typeof s === 'string') : [],
          quickLinks: Array.isArray(d.quickLinks)
            ? d.quickLinks.filter((l: { label?: unknown; href?: unknown }) => typeof l?.label === 'string' && typeof l?.href === 'string')
            : [],
          contactMethods: Array.isArray(d.contactMethods)
            ? d.contactMethods.filter(
                (c: { type?: unknown; label?: unknown; value?: unknown }) =>
                  (c?.type === 'phone' || c?.type === 'email' || c?.type === 'url') &&
                  typeof c?.label === 'string' &&
                  typeof c?.value === 'string',
              )
            : [],
        });
      })
      .catch(() => {
        /* keep built-in defaults */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Lock body scroll while the mobile sheet is open (no background scroll bleed).
  useEffect(() => {
    if (!open) return;
    if (!window.matchMedia('(max-width: 639px)').matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Abort any in-flight stream + voice capture on unmount.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      recognitionRef.current?.abort();
    },
    [],
  );

  const send = useCallback(
    async (text: string, opts?: { mode?: 'websearch'; reuseHistory?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      lastQueryRef.current = trimmed;

      setError(null);
      const assistantId = nextId();
      // A "search the web" retry re-asks the SAME question without adding a new user
      // bubble; a normal send appends the user turn.
      const history = opts?.reuseHistory
        ? messages.filter((m) => m.role !== 'assistant' || m.content)
        : [...messages, { id: nextId(), role: 'user' as const, content: trimmed }];
      setMessages([...history, { id: assistantId, role: 'assistant', content: '', question: trimmed }]);
      setInput('');
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const chatHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        // Forward the identity token on the chat call too (cross-origin embed);
        // same-site relies on the cookie. Server verifies + personalizes.
        if (identityTokenRef.current) chatHeaders.authorization = `Bearer ${identityTokenRef.current}`;
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: chatHeaders,
          body: JSON.stringify({
            messages: history.map(({ role, content }) => ({ role, content })),
            sessionId: sessionIdRef.current,
            ...(opts?.mode ? { mode: opts.mode } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let msg = 'Ask AI Guru is temporarily unavailable. Please try again shortly.';
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {
            /* keep default */
          }
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          setError(msg);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let acc = '';

        const flushLine = (line: string) => {
          const t = line.trim();
          if (!t.startsWith('data: ')) return;
          const payload = t.slice(6);
          if (payload === '[DONE]') return;
          try {
            const json = JSON.parse(payload);
            // Nemo agent step events — surfaced as live "Searching docs…" lines.
            if (json?.nemo_event === 'tool_call') {
              const step: ToolStep = {
                tool: String(json.tool ?? ''),
                title: String(json.title ?? json.tool ?? 'Working'),
                status: json.status === 'done' ? 'done' : 'running',
              };
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const steps = [...(m.steps ?? [])];
                  const i = steps.findIndex((s) => s.tool === step.tool);
                  if (i >= 0) steps[i] = step;
                  else steps.push(step);
                  return { ...m, steps };
                }),
              );
              return;
            }
            if (json?.nemo_event === 'citations') {
              const list: Citation[] = Array.isArray(json.citations) ? json.citations : [];
              if (list.length)
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, citations: list } : m)),
                );
              return;
            }
            if (json?.nemo_event === 'confidence') {
              const level = json.level === 'high' || json.level === 'medium' || json.level === 'low' ? json.level : undefined;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, confidence: level, webSearched: json.webSearched === true } : m,
                ),
              );
              return;
            }
            if (json?.nemo_event === 'cost') {
              // Cost is surfaced for observability; not rendered to end-users today.
              return;
            }
            if (json?.nemo_event === 'error') {
              setError(String(json.message ?? 'Something went wrong.'));
              return;
            }
            const delta: string = json?.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              acc += delta;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)),
              );
            }
          } catch {
            /* skip malformed SSE line */
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) flushLine(line);
        }
        if (buffer) buffer.split('\n').forEach(flushLine);

        if (!acc) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          setError('No response — please try rephrasing your question.');
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // User stopped: keep any partial answer; drop an empty placeholder.
          setMessages((prev) =>
            prev.filter((m) => m.id !== assistantId || (m.content?.length ?? 0) > 0),
          );
          return;
        }
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        setError('Something went wrong. Please try again.');
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, streaming],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  // Fire-and-forget POST to /api/feedback — never surfaces an error to the visitor.
  const postFeedback = useCallback(
    (m: ChatMessage, rating: 'up' | 'down', reason?: string) => {
      void fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          sessionId: sessionIdRef.current,
          messageId: String(m.id),
          question: m.question ?? '',
          confidence: m.confidence ?? '',
          webSearched: m.webSearched === true,
          ...(reason ? { reason } : {}),
        }),
      }).catch(() => {});
    },
    [],
  );

  // Record a 👍/👎. 👍 posts immediately (signal: was this answer helpful?). 👎 locks
  // the buttons and reveals the "what was wrong?" follow-up — we only post the 👎 once
  // a reason is chosen, so every negative carries a structured reason for the journey
  // analytics (chat_feedback.reason). A 👎 with no reason picked still isn't lost: the
  // escalation/"close" both post it.
  const submitFeedback = useCallback(
    (m: ChatMessage, rating: 'up' | 'down') => {
      if (m.feedback) return; // already rated
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, feedback: rating } : x)));
      if (rating === 'up') postFeedback(m, 'up');
      // 'down' waits for a reason (submitReason) — chips render below.
    },
    [postFeedback],
  );

  // The visitor picked WHY the 👎 answer wasn't helpful. Post it + lock the chips.
  const submitReason = useCallback(
    (m: ChatMessage, reason: string) => {
      if (m.feedbackReason) return;
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, feedbackReason: reason } : x)));
      postFeedback(m, 'down', reason);
    },
    [postFeedback],
  );

  // "Search the web" escalation — re-ask the same question through the web-search path.
  const searchWeb = useCallback(
    (m: ChatMessage) => {
      const q = m.question || lastQueryRef.current;
      if (!q || streaming) return;
      void send(q, { mode: 'websearch', reuseHistory: true });
    },
    [send, streaming],
  );

  // Interruptible (skill: `interruptible`) — let the user stop a streaming answer.
  const stop = () => abortRef.current?.abort();
  // Error recovery (skill: `error-recovery`) — one-tap retry of the last question.
  const retry = () => void send(lastQueryRef.current);
  // New chat — clear the thread, abort any stream, focus the composer.
  const reset = () => {
    abortRef.current?.abort();
    recognitionRef.current?.abort();
    setMessages([]);
    setInput('');
    setError(null);
    setVoiceError(null);
    setStreaming(false);
    inputRef.current?.focus();
  };

  // ── Voice mode (Web Speech API) ──────────────────────────────────────────
  const stopVoice = () => recognitionRef.current?.stop();
  const startVoice = () => {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor || streaming) return;

    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    voiceBaseRef.current = input.trim() ? `${input.trim()} ` : '';
    let finalText = '';
    setVoiceError(null);

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput(`${voiceBaseRef.current}${finalText}${interim}`);
    };
    rec.onerror = (ev) => {
      setListening(false);
      recognitionRef.current = null;
      const code = ev?.error ?? '';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setVoiceError('Microphone access is blocked — enable it in your browser settings.');
      } else if (code === 'no-speech') {
        setVoiceError("Didn't catch that — tap the mic and try again.");
      } else if (code !== 'aborted') {
        setVoiceError('Voice input had a hiccup — please try again.');
      }
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      const text = `${voiceBaseRef.current}${finalText}`.trim();
      if (text) void send(text); // voice mode auto-sends once you stop talking
    };

    recognitionRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      // start() throws synchronously if a session is already live or the
      // browser blocks it — recover instead of leaving the UI stuck listening.
      setListening(false);
      recognitionRef.current = null;
      setVoiceError('Couldn’t start voice — check microphone permissions and try again.');
    }
  };
  const toggleVoice = () => (listening ? stopVoice() : startVoice());

  /* Shared mic control — listening shows a coral pulse ring. */
  const micButton = (size: 'sm' | 'lg') =>
    voiceSupported ? (
      <button
        type="button"
        onClick={toggleVoice}
        disabled={streaming}
        aria-label={listening ? 'Stop voice input' : 'Speak your question'}
        aria-pressed={listening}
        className={`inline-flex shrink-0 items-center justify-center rounded-full border transition active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 ${
          size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'
        } ${
          listening
            ? 'animate-pulse border-[var(--nemo-coral)] bg-[var(--nemo-coral)]/12 text-[var(--nemo-coral-dark)] motion-reduce:animate-none'
            : 'border-[var(--border-light)] bg-[var(--surface-primary)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
        }`}
      >
        <Mic className={size === 'lg' ? 'h-[18px] w-[18px]' : 'h-4 w-4'} strokeWidth={1.5} aria-hidden="true" />
      </button>
    ) : null;

  /* Shared send / stop control — Verizon-style filled dark circle. */
  const sendButton = (size: 'sm' | 'lg') => {
    const dim = size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';
    return streaming ? (
      <button
        type="button"
        onClick={stop}
        aria-label="Stop generating"
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--surface-primary)] transition active:scale-95 motion-reduce:active:scale-100 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] focus-visible:ring-offset-2 ${dim}`}
      >
        <Square className="h-3.5 w-3.5" strokeWidth={1.5} fill="currentColor" aria-hidden="true" />
      </button>
    ) : (
      <button
        type="submit"
        disabled={!input.trim()}
        aria-label="Send"
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--surface-primary)] transition active:scale-95 motion-reduce:active:scale-100 hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] focus-visible:ring-offset-2 ${dim}`}
      >
        <Send className={size === 'lg' ? 'h-[18px] w-[18px]' : 'h-4 w-4'} strokeWidth={1.5} aria-hidden="true" />
      </button>
    );
  };

  /* Shared voice status line — animated equalizer while listening, else error. */
  const voiceNote = (cls: string) =>
    listening || voiceError ? (
      <div className={`flex items-center gap-2 ${cls}`} aria-live="polite">
        {listening ? (
          <>
            <span className="flex h-3.5 items-end gap-[3px]" aria-hidden="true">
              <span className="ask-eq h-2.5 w-[3px] rounded-full bg-[var(--nemo-coral-dark)] [animation-delay:0ms]" />
              <span className="ask-eq h-3.5 w-[3px] rounded-full bg-[var(--nemo-coral-dark)] [animation-delay:150ms]" />
              <span className="ask-eq h-2 w-[3px] rounded-full bg-[var(--nemo-coral-dark)] [animation-delay:300ms]" />
            </span>
            <span className="text-[12px] font-medium text-[var(--nemo-coral-dark)]">
              Listening… speak now, then pause to send.
            </span>
          </>
        ) : (
          <span className="text-[12px] font-medium text-[var(--text-muted)]">{voiceError}</span>
        )}
      </div>
    ) : null;

  // Base font is 16px so iOS Safari never auto-zooms on focus; callers can
  // shrink it back on >=sm via `extra` (e.g. `sm:text-[13px]`).
  const textarea = (rows: number, placeholder: string, extra: string) => (
    <textarea
      ref={inputRef}
      rows={rows}
      value={input}
      onChange={(e) => {
        setInput(e.target.value);
        if (voiceError) setVoiceError(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void send(input);
        }
      }}
      placeholder={placeholder}
      enterKeyHint="send"
      autoCapitalize="sentences"
      autoCorrect="on"
      spellCheck
      className={`w-full resize-none bg-transparent text-[16px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] ${extra}`}
    />
  );

  return (
    <>
      {/* Launcher — hidden while the panel is open */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask AI Guru about Nemo Router"
          className="group fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-[var(--text-primary)]/10 bg-[var(--surface-primary)] py-2.5 pl-3 pr-4 text-sm font-semibold text-[var(--text-primary)] shadow-[0_8px_30px_-8px_rgba(9,9,11,0.28)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_36px_-8px_rgba(9,9,11,0.34)] active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] focus-visible:ring-offset-2"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--nemo-mint)] text-[var(--on-mint)]">
            <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </span>
          Ask AI Guru
        </button>
      )}

      {/* Backdrop scrim — mobile only (desktop stays a non-intrusive corner card) */}
      {open && (
        <button
          type="button"
          aria-label="Close"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="ask-fade fixed inset-0 z-40 bg-[rgba(9,9,11,0.36)] sm:hidden"
        />
      )}

      {/* Panel — mobile = tall warm bottom sheet; >=sm = floating card */}
      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Ask AI Guru about Nemo Router"
          className={`fade-up fixed z-50 flex flex-col overflow-hidden border border-[var(--border-light)] shadow-[0_24px_64px_-16px_rgba(9,9,11,0.34)] ${WARM_SHEET} inset-0 rounded-none border-0 pt-[env(safe-area-inset-top)] sm:border sm:pt-0 ${
            expanded
              ? // Maximize → TRUE full screen on desktop (edge-to-edge). Header keeps
                // Minimize (back to the corner card) + Close, so it's never a trap.
                'sm:inset-0 sm:rounded-none sm:border-0'
              : 'sm:inset-x-auto sm:left-auto sm:right-5 sm:top-auto sm:bottom-5 sm:rounded-2xl sm:h-auto sm:max-h-[min(78vh,640px)] sm:w-[min(424px,calc(100vw-2rem))]'
          }`}
        >

          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-[18px] w-[18px] text-[var(--text-primary)]" strokeWidth={1.5} aria-hidden="true" />
              <div className="leading-tight">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{agentTitle}</p>
                <p className="text-[11px] text-[var(--text-muted)]">Answered live by our own gateway</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasThread && (
                <button
                  type="button"
                  onClick={reset}
                  aria-label="New chat"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] sm:h-8 sm:w-8"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                </button>
              )}
              {/* Expand / minimize — desktop only */}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Minimize' : 'Expand'}
                className="hidden h-11 w-11 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] sm:h-8 sm:w-8 sm:inline-flex"
              >
                {expanded ? (
                  <Minimize2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <Maximize2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                )}
              </button>
              {/* Close → back to the website. On mobile the panel is full-screen,
                  so the X carries a persistent chip + label (no hover on touch) to
                  make "exit" unmistakable; on desktop it's the quiet corner button. */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close and return to the website"
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-[var(--border-light)] bg-[var(--surface-primary)] px-3 text-[13px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] sm:h-8 sm:w-8 sm:gap-0 sm:rounded-lg sm:border-0 sm:bg-transparent sm:px-0 sm:text-[var(--text-muted)] sm:hover:text-[var(--text-primary)]"
              >
                <X className="h-[18px] w-[18px] sm:h-4 sm:w-4" strokeWidth={1.5} aria-hidden="true" />
                <span className="sm:hidden">Close</span>
              </button>
            </div>
          </div>

          {/* Body: optional quick-links rail (expanded + desktop only) + chat column */}
          <div className="flex min-h-0 flex-1">
            {expanded && (
              <aside className="hidden w-[32%] min-w-[168px] max-w-[220px] shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain border-r border-[var(--border-subtle)] bg-[var(--surface-primary)]/45 px-3 py-4 sm:flex">
                {/* Personalized account links — only present when signed in (lib/identity.ts). */}
                {identity.authenticated && identity.links.length > 0 && (
                  <div>
                    <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Your account
                    </p>
                    <nav className="flex flex-col gap-0.5">
                      {identity.links.map(({ label, url }) => (
                        <a
                          key={`${label}-${url}`}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                        >
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                          {label}
                        </a>
                      ))}
                    </nav>
                  </div>
                )}
                <div>
                  <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Quick links
                  </p>
                  <nav className="flex flex-col gap-0.5">
                    {quickLinks.map(({ label, href }) => {
                      const Icon = linkIcon(label);
                      return (
                        <a
                          key={`${label}-${href}`}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                        >
                          <Icon
                            className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                          {label}
                        </a>
                      );
                    })}
                  </nav>
                </div>
                {/* Contact methods — phone / email / support, configured in /admin. */}
                {contactMethods.length > 0 && (
                  <div>
                    <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Contact
                    </p>
                    <nav className="flex flex-col gap-0.5">
                      {contactMethods.map((m) => {
                        const Icon = contactIcon(m.type);
                        const isExternal = m.type === 'url' && /^https?:/i.test(m.value);
                        return (
                          <a
                            key={`${m.type}-${m.label}-${m.value}`}
                            href={contactToHref(m)}
                            {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                            className="group inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                          >
                            <Icon
                              className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
                              strokeWidth={1.5}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 leading-tight">
                              <span className="block truncate">{m.label}</span>
                              <span className="block truncate text-[11px] text-[var(--text-muted)]">{m.value}</span>
                            </span>
                          </a>
                        );
                      })}
                    </nav>
                  </div>
                )}
              </aside>
            )}

            {/* Chat column */}
            <div className="flex min-w-0 flex-1 flex-col">
              {!hasThread ? (
                /* ── Empty state: warm Verizon-style hero ── */
                <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-1">
                  <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-5 py-2">
                    <div className="space-y-2">
                      <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text-primary)]">
                        {identity.authenticated && identity.displayName
                          ? `Hello ${identity.displayName}`
                          : 'Ask Nemo Router anything'}
                      </h2>
                      <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
                        Pricing, models, the API, or how we compare — answered live by our own gateway.
                        Type it, or tap the mic and just talk.
                      </p>
                    </div>

                    {/* Big input card */}
                    <div className="rounded-2xl border border-[var(--border-light)] bg-[var(--surface-primary)] px-4 pb-2.5 pt-3 shadow-[0_2px_10px_-4px_rgba(9,9,11,0.12)] focus-within:border-[var(--border-medium)]">
                      <form onSubmit={onSubmit}>
                        {textarea(2, 'Message Nemo Router…', 'min-h-[52px] max-h-40')}
                        <div className="mt-1.5 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">{micButton('lg')}</div>
                          {sendButton('lg')}
                        </div>
                      </form>
                    </div>
                    {voiceNote('-mt-2.5 px-1')}

                    {/* Suggestion chips — revealed one-by-one (staggered) */}
                    <div className="flex flex-col gap-2.5">
                      {suggestions.map((q, i) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => void send(q)}
                          className={`fade-up fade-up-d${Math.min(i + 1, 4)} group flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-light)] bg-[var(--surface-primary)]/70 px-4 py-3 text-left text-[14px] font-medium text-[var(--text-primary)] transition active:scale-[0.99] motion-reduce:active:scale-100 hover:border-[var(--border-medium)] hover:bg-[var(--surface-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]`}
                        >
                          <span className="min-w-0">{q}</span>
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-primary)]"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Footer: disclaimer + support pill */}
                  <div className="mx-auto mt-4 w-full max-w-2xl space-y-3 pt-1 text-center">
                    <p className="px-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                      AI-generated and may be imperfect. Verify pricing on the{' '}
                      <a
                        href="/pricing"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-[var(--text-secondary)]"
                      >
                        pricing page
                      </a>
                      .
                    </p>
                    <a
                      href="/contact"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--border-light)] bg-[var(--surface-primary)]/80 px-5 py-2.5 text-[13px] font-medium text-[var(--text-primary)] transition active:scale-95 motion-reduce:active:scale-100 hover:bg-[var(--surface-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                    >
                      <LifeBuoy className="h-4 w-4 text-[var(--text-secondary)]" strokeWidth={1.5} aria-hidden="true" />
                      Talk to support
                    </a>
                  </div>
                </div>
              ) : (
                /* ── Thread state: messages + pinned composer ── */
                <>
                  <div ref={scrollRef} className="mx-auto w-full max-w-3xl flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
                    {messages.map((m) =>
                      m.role === 'user' ? (
                        <div key={m.id} className="flex justify-end">
                          <div className="max-w-[85%] [overflow-wrap:anywhere] rounded-2xl rounded-br-sm bg-[var(--text-primary)] px-3.5 py-2 text-[13px] leading-relaxed text-[var(--surface-primary)]">
                            {m.content}
                          </div>
                        </div>
                      ) : (
                        <div key={m.id} className="flex items-start gap-2">
                          <Bot
                            className="mt-1 h-4 w-4 shrink-0 text-[var(--text-muted)]"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                          <div className="flex min-w-0 max-w-[85%] flex-col gap-1.5">
                            {m.steps && m.steps.length > 0 && (
                              <div className="flex flex-col gap-1">
                                {m.steps.map((s) => (
                                  <span
                                    key={s.tool}
                                    className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"
                                  >
                                    {s.status === 'done' ? (
                                      <Check className="h-3 w-3 text-[var(--nemo-emerald)]" strokeWidth={2} aria-hidden="true" />
                                    ) : (
                                      <Loader2
                                        className="h-3 w-3 animate-spin motion-reduce:animate-none"
                                        strokeWidth={2}
                                        aria-hidden="true"
                                      />
                                    )}
                                    {s.title}
                                    {s.status === 'done' ? '' : '…'}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div
                              aria-live="polite"
                              className="space-y-2 [overflow-wrap:anywhere] rounded-2xl rounded-bl-sm border border-[var(--border-light)] bg-[var(--surface-primary)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--text-secondary)] shadow-[0_1px_2px_rgba(9,9,11,0.04)]"
                            >
                              {m.content ? (
                                renderMarkdownLite(m.content)
                              ) : (
                                <span className="inline-flex gap-1" aria-label="Thinking">
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text-muted)] motion-reduce:animate-none" />
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text-muted)] [animation-delay:150ms] motion-reduce:animate-none" />
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text-muted)] [animation-delay:300ms] motion-reduce:animate-none" />
                                </span>
                              )}
                            </div>
                            {/* Sources/citations + confidence badge intentionally NOT rendered
                                (operator preference — keep the answer clean). Confidence + web
                                search still run under the hood to drive the escalation below. */}
                            {/* Feedback row — only on a finished assistant answer. */}
                            {m.role === 'assistant' &&
                              m.content &&
                              !(streaming && m.id === messages[messages.length - 1]?.id) && (
                                <div className="flex flex-col gap-1.5 pt-1">
                                  {/* Thumbs row — "was this helpful?" signal */}
                                  <div className="flex items-center gap-2">
                                    {!m.feedback && (
                                      <span className="text-[10px] text-[var(--text-muted)]">Was this helpful?</span>
                                    )}
                                    <div className="ml-auto inline-flex items-center gap-0.5">
                                      {m.feedback === 'up' ? (
                                        <span className="text-[10px] text-[var(--text-muted)]">Thanks for the feedback</span>
                                      ) : m.feedback === 'down' && m.feedbackReason ? (
                                        <span className="text-[10px] text-[var(--text-muted)]">Thanks — that helps us improve</span>
                                      ) : m.feedback === 'down' ? (
                                        <span className="text-[10px] font-medium text-[var(--text-secondary)]">What was off?</span>
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            aria-label="Helpful"
                                            onClick={() => submitFeedback(m, 'up')}
                                            className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                                          >
                                            <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                                          </button>
                                          <button
                                            type="button"
                                            aria-label="Not helpful"
                                            onClick={() => submitFeedback(m, 'down')}
                                            className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                                          >
                                            <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {/* 👎 follow-up: specific question chips → captured as the feedback reason. */}
                                  {m.feedback === 'down' && !m.feedbackReason && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {DOWN_REASONS.map((r) => (
                                        <button
                                          key={r}
                                          type="button"
                                          onClick={() => submitReason(m, r)}
                                          className="rounded-full border border-[var(--border-light)] bg-[var(--surface-secondary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                                        >
                                          {r}
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  {/* Escalate to web search when the answer was weak or marked unhelpful. */}
                                  {!m.webSearched &&
                                    (m.confidence === 'low' || m.feedback === 'down') && (
                                      <button
                                        type="button"
                                        onClick={() => searchWeb(m)}
                                        disabled={streaming}
                                        className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-[var(--border-light)] bg-[var(--surface-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                                      >
                                        <Globe className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                                        Still not resolved? Search the web
                                      </button>
                                    )}
                                </div>
                              )}
                          </div>
                        </div>
                      ),
                    )}

                    {error && (
                      <div
                        role="alert"
                        className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-light)] bg-[var(--surface-primary)]/70 px-3 py-2 text-[12px] text-[var(--text-secondary)]"
                      >
                        <span>{error}</span>
                        {lastQueryRef.current && (
                          <button
                            type="button"
                            onClick={retry}
                            className="inline-flex shrink-0 items-center gap-1 font-semibold text-[var(--text-primary)] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                          >
                            <RotateCcw className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                            Try again
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Composer */}
                  <form
                    onSubmit={onSubmit}
                    className="mx-auto w-full max-w-3xl p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
                  >
                    {voiceNote('px-1 pb-1.5')}
                    <div className="flex items-end gap-2 rounded-2xl border border-[var(--border-light)] bg-[var(--surface-primary)] px-3 py-2 focus-within:border-[var(--border-medium)]">
                      <div className="flex items-center gap-1 pb-0.5">{micButton('sm')}</div>
                      {textarea(1, 'Ask a follow-up…', 'max-h-28 sm:text-[13px]')}
                      {sendButton('sm')}
                    </div>
                    <p className="mt-2 px-1 text-[10px] text-[var(--text-muted)]">
                      AI-generated · may be imperfect. Verify pricing on the pricing page.
                    </p>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AskGuruWidget;
