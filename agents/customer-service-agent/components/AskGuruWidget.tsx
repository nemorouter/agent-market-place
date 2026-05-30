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

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  steps?: ToolStep[];
}

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

/** Quick links shown in the expanded two-pane rail + hero footer. Relative
 *  hrefs resolve against nemorouter.ai (where the widget is mounted); Support
 *  is a mailto. Flat line icons, no chip behind the glyph (Rule #27). */
const QUICK_LINKS = [
  { label: 'Models', href: '/models', Icon: Boxes },
  { label: 'Pricing', href: '/pricing', Icon: Tag },
  { label: 'Docs', href: '/docs', Icon: BookOpen },
  { label: 'Playground', href: '/playground', Icon: Terminal },
  { label: 'Contact us', href: '/contact', Icon: LifeBuoy },
] as const;

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

  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseRef = useRef('');
  const nextId = () => ++idRef.current;
  const hasThread = messages.length > 0;

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
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      lastQueryRef.current = trimmed;

      setError(null);
      const userMsg: ChatMessage = { id: nextId(), role: 'user', content: trimmed };
      const assistantId = nextId();
      const history = [...messages, userMsg];
      setMessages([...history, { id: assistantId, role: 'assistant', content: '' }]);
      setInput('');
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history.map(({ role, content }) => ({ role, content })),
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
          className={`fade-up fixed z-50 flex flex-col overflow-hidden border border-[var(--border-light)] shadow-[0_24px_64px_-16px_rgba(9,9,11,0.34)] ${WARM_SHEET} inset-x-0 bottom-0 top-[7dvh] rounded-t-[28px] sm:inset-x-auto sm:left-auto sm:right-5 sm:top-auto sm:bottom-5 sm:rounded-2xl ${
            expanded
              ? 'sm:h-[min(82vh,720px)] sm:w-[min(700px,calc(100vw-2.5rem))]'
              : 'sm:h-auto sm:max-h-[min(78vh,640px)] sm:w-[min(424px,calc(100vw-2rem))]'
          }`}
        >
          {/* Mobile drag handle */}
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-[var(--text-primary)]/15 sm:hidden" />

          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-[18px] w-[18px] text-[var(--text-primary)]" strokeWidth={1.5} aria-hidden="true" />
              <div className="leading-tight">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Ask AI Guru about Nemo Router</p>
                <p className="text-[11px] text-[var(--text-muted)]">Answered live by our own gateway</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasThread && (
                <button
                  type="button"
                  onClick={reset}
                  aria-label="New chat"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                </button>
              )}
              {/* Expand / minimize — desktop only */}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Minimize' : 'Expand'}
                className="hidden h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)] sm:inline-flex"
              >
                {expanded ? (
                  <Minimize2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <Maximize2 className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Body: optional quick-links rail (expanded + desktop only) + chat column */}
          <div className="flex min-h-0 flex-1">
            {expanded && (
              <aside className="hidden w-[32%] min-w-[168px] max-w-[220px] shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain border-r border-[var(--border-subtle)] bg-[var(--surface-primary)]/45 px-3 py-4 sm:flex">
                <div>
                  <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Quick links
                  </p>
                  <nav className="flex flex-col gap-0.5">
                    {QUICK_LINKS.map(({ label, href, Icon }) => (
                      <a
                        key={label}
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
                    ))}
                  </nav>
                </div>
                <div>
                  <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Try
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {SUGGESTIONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => void send(q)}
                        className="rounded-lg border border-[var(--border-light)] bg-[var(--surface-primary)] px-2.5 py-1.5 text-left text-[12px] leading-snug text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </aside>
            )}

            {/* Chat column */}
            <div className="flex min-w-0 flex-1 flex-col">
              {!hasThread ? (
                /* ── Empty state: warm Verizon-style hero ── */
                <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-1">
                  <div className="flex flex-1 flex-col justify-center gap-5 py-2">
                    <div className="space-y-2">
                      <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text-primary)]">
                        Ask Nemo Router anything
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
                      {SUGGESTIONS.map((q, i) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => void send(q)}
                          className={`fade-up fade-up-d${i + 1} group flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-light)] bg-[var(--surface-primary)]/70 px-4 py-3 text-left text-[14px] font-medium text-[var(--text-primary)] transition active:scale-[0.99] motion-reduce:active:scale-100 hover:border-[var(--border-medium)] hover:bg-[var(--surface-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-primary)]`}
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
                  <div className="mt-4 space-y-3 pt-1 text-center">
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
                  <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
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
                    className="p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
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
