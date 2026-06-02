'use client';

import { useCallback, useEffect, useState } from 'react';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * /admin — the operator config dashboard.
 *
 * Edit the agent's presentation + behavior WITHOUT a redeploy: name, system
 * prompt, model, suggestion chips, quick links, and contact methods (phone /
 * email / support). Saves to the operator's OWN Supabase via PUT /api/config;
 * the widget reads the result from GET /api/config on open.
 *
 * Auth: the same ADMIN_TOKEN that gates /api/ingest. Entered here, held in
 * sessionStorage only (cleared on tab close — mirrors the playground-key model,
 * Rule #15 ethos). Never read sessionStorage during render (Rule #24): the token
 * loads in an effect after mount.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

type ContactType = 'phone' | 'email' | 'url';
interface ContactMethod {
  type: ContactType;
  label: string;
  value: string;
}
interface QuickLink {
  label: string;
  href: string;
}
interface AgentSettings {
  agentName: string;
  systemPrompt: string;
  model: string;
  greet: boolean;
  suggestions: string[];
  quickLinks: QuickLink[];
  contactMethods: ContactMethod[];
  enabledTools: string[];
}
interface ToolSpec {
  id: string;
  title: string;
  description: string;
}

const TOKEN_KEY = '_amp_admin_token';

const EMPTY: AgentSettings = {
  agentName: '',
  systemPrompt: '',
  model: '',
  greet: true,
  suggestions: [],
  quickLinks: [],
  contactMethods: [],
  enabledTools: [],
};

const labelCls = 'block text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]';
const inputCls =
  'w-full rounded-lg border border-[var(--border-light)] bg-[var(--surface-primary)] px-3 py-2 text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--border-medium)]';
const btnPrimary =
  'inline-flex items-center justify-center rounded-lg bg-[var(--text-primary)] px-4 py-2 text-[13px] font-semibold text-[var(--surface-primary)] transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40';
const btnGhost =
  'inline-flex items-center justify-center rounded-lg border border-[var(--border-light)] bg-[var(--surface-primary)] px-3 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]';

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [settings, setSettings] = useState<AgentSettings>(EMPTY);
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [vault, setVault] = useState<{ vaultConfigured: boolean; toolIds: string[] }>({ vaultConfigured: false, toolIds: [] });
  const [credInput, setCredInput] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Restore a previously-entered token after mount (never during render — Rule #24).
  useEffect(() => {
    const t = sessionStorage.getItem(TOKEN_KEY);
    if (t) setToken(t);
  }, []);

  const load = useCallback(async (tok: string) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/config', { headers: { authorization: `Bearer ${tok}`, accept: 'application/json' } });
      if (!res.ok) {
        setNote({ kind: 'err', text: res.status === 401 ? 'Invalid admin token.' : `Load failed (${res.status}).` });
        setToken(null);
        sessionStorage.removeItem(TOKEN_KEY);
        return;
      }
      const d = (await res.json()) as Partial<AgentSettings>;
      setSettings({
        agentName: d.agentName ?? '',
        systemPrompt: d.systemPrompt ?? '',
        model: d.model ?? '',
        greet: d.greet ?? true,
        suggestions: Array.isArray(d.suggestions) ? d.suggestions : [],
        quickLinks: Array.isArray(d.quickLinks) ? d.quickLinks : [],
        contactMethods: Array.isArray(d.contactMethods) ? d.contactMethods : [],
        enabledTools: Array.isArray(d.enabledTools) ? d.enabledTools : [],
      });
      setLoaded(true);
      // Pull the gateway tool catalog (best-effort; empty if the gateway is down).
      fetch('/api/tools', { headers: { authorization: `Bearer ${tok}`, accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((t) => setTools(Array.isArray(t?.data) ? t.data : []))
        .catch(() => setTools([]));
      // Pull vault status (which tools have a stored credential + whether the vault is on).
      fetch('/api/tool-credentials', { headers: { authorization: `Bearer ${tok}`, accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => v && setVault({ vaultConfigured: Boolean(v.vaultConfigured), toolIds: Array.isArray(v.toolIds) ? v.toolIds : [] }))
        .catch(() => {});
    } catch {
      setNote({ kind: 'err', text: 'Network error loading settings.' });
    } finally {
      setBusy(false);
    }
  }, []);

  // Once we have a token, fetch the current settings to prefill the editor.
  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  const unlock = (e: React.FormEvent) => {
    e.preventDefault();
    const t = tokenInput.trim();
    if (!t) return;
    sessionStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  };

  const lock = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setTokenInput('');
    setLoaded(false);
    setSettings(EMPTY);
    setNote(null);
  };

  const save = async () => {
    if (!token) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(settings),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ kind: 'err', text: d?.message || d?.error || `Save failed (${res.status}).` });
        return;
      }
      if (d?.settings) setSettings(d.settings as AgentSettings);
      setNote({ kind: 'ok', text: 'Saved. The widget picks this up on its next open.' });
    } catch {
      setNote({ kind: 'err', text: 'Network error saving settings.' });
    } finally {
      setBusy(false);
    }
  };

  const setCred = async (toolId: string) => {
    if (!token) return;
    const secret = credInput[toolId];
    if (!secret) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/tool-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ toolId, secret }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ kind: 'err', text: d?.message || d?.error || `Save failed (${res.status}).` });
        return;
      }
      setCredInput((s) => ({ ...s, [toolId]: '' }));
      setVault((v) => ({ ...v, toolIds: v.toolIds.includes(toolId) ? v.toolIds : [...v.toolIds, toolId] }));
      setNote({ kind: 'ok', text: `Credential stored for ${toolId} (encrypted at rest).` });
    } catch {
      setNote({ kind: 'err', text: 'Network error saving credential.' });
    } finally {
      setBusy(false);
    }
  };

  const clearCred = async (toolId: string) => {
    if (!token) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/tool-credentials', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ toolId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setNote({ kind: 'err', text: d?.message || `Clear failed (${res.status}).` });
        return;
      }
      setVault((v) => ({ ...v, toolIds: v.toolIds.filter((id) => id !== toolId) }));
      setNote({ kind: 'ok', text: `Credential cleared for ${toolId}.` });
    } catch {
      setNote({ kind: 'err', text: 'Network error clearing credential.' });
    } finally {
      setBusy(false);
    }
  };

  const reindex = async () => {
    if (!token) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/ingest', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ kind: 'err', text: d?.message || d?.error || `Re-index failed (${res.status}).` });
        return;
      }
      setNote({ kind: 'ok', text: `Re-indexed ${d?.sources ?? 0} sources → ${d?.chunks ?? 0} chunks.` });
    } catch {
      setNote({ kind: 'err', text: 'Network error during re-index.' });
    } finally {
      setBusy(false);
    }
  };

  // ── token gate ────────────────────────────────────────────────────────────
  if (!token || !loaded) {
    return (
      <main className="min-h-screen bg-[var(--surface-secondary)] px-4 py-16">
        <div className="mx-auto max-w-sm rounded-2xl border border-[var(--border-light)] bg-[var(--surface-primary)] p-6 shadow-[0_8px_30px_-12px_rgba(9,9,11,0.2)]">
          <h1 className="text-[20px] font-semibold text-[var(--text-primary)]">Agent admin</h1>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Enter your <code className="rounded bg-[var(--surface-hover)] px-1 py-0.5 text-[12px]">ADMIN_TOKEN</code> to
            configure the agent.
          </p>
          <form onSubmit={unlock} className="mt-4 space-y-3">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Admin token"
              autoComplete="off"
              className={inputCls}
            />
            <button type="submit" disabled={busy || !tokenInput.trim()} className={`${btnPrimary} w-full`}>
              {busy ? 'Checking…' : 'Unlock'}
            </button>
          </form>
          {note && (
            <p className={`mt-3 text-[12px] ${note.kind === 'err' ? 'text-[var(--nemo-coral-dark)]' : 'text-[var(--nemo-indigo)]'}`}>
              {note.text}
            </p>
          )}
        </div>
      </main>
    );
  }

  // ── editor ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[var(--surface-secondary)] px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-semibold text-[var(--text-primary)]">Agent admin</h1>
            <p className="text-[13px] text-[var(--text-muted)]">Configure the widget — saved to your Supabase, live on next open.</p>
          </div>
          <button type="button" onClick={lock} className={btnGhost}>
            Lock
          </button>
        </header>

        {note && (
          <div
            role="status"
            className={`rounded-lg border px-3 py-2 text-[13px] ${
              note.kind === 'err'
                ? 'border-[var(--nemo-coral)]/40 bg-[var(--nemo-coral)]/8 text-[var(--nemo-coral-dark)]'
                : 'border-[var(--nemo-emerald)]/40 bg-[var(--nemo-emerald)]/8 text-[var(--nemo-indigo)]'
            }`}
          >
            {note.text}
          </div>
        )}

        {/* Identity + behavior */}
        <section className="space-y-4 rounded-2xl border border-[var(--border-light)] bg-[var(--surface-primary)] p-5">
          <div className="space-y-1.5">
            <label className={labelCls}>Agent name</label>
            <input className={inputCls} value={settings.agentName} onChange={(e) => setSettings((s) => ({ ...s, agentName: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Model</label>
            <input className={inputCls} value={settings.model} onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))} placeholder="gemini-2.5-flash-lite" />
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>System prompt</label>
            <textarea
              className={`${inputCls} min-h-[120px] resize-y leading-relaxed`}
              value={settings.systemPrompt}
              onChange={(e) => setSettings((s) => ({ ...s, systemPrompt: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={settings.greet}
              onChange={(e) => setSettings((s) => ({ ...s, greet: e.target.checked }))}
            />
            Greet signed-in visitors by name
          </label>
        </section>

        {/* Suggestions */}
        <ListEditor
          title="Suggestion chips"
          hint="Shown in the empty state. Tap-to-ask prompts."
          items={settings.suggestions}
          onAdd={() => setSettings((s) => ({ ...s, suggestions: [...s.suggestions, ''] }))}
          onRemove={(i) => setSettings((s) => ({ ...s, suggestions: s.suggestions.filter((_, j) => j !== i) }))}
          render={(value, i) => (
            <input
              className={inputCls}
              value={value}
              placeholder="How does pricing work?"
              onChange={(e) =>
                setSettings((s) => ({ ...s, suggestions: s.suggestions.map((v, j) => (j === i ? e.target.value : v)) }))
              }
            />
          )}
        />

        {/* Quick links */}
        <ListEditor
          title="Quick links"
          hint="Shown in the expanded rail. Use site-relative (/docs) or absolute https URLs."
          items={settings.quickLinks}
          onAdd={() => setSettings((s) => ({ ...s, quickLinks: [...s.quickLinks, { label: '', href: '' }] }))}
          onRemove={(i) => setSettings((s) => ({ ...s, quickLinks: s.quickLinks.filter((_, j) => j !== i) }))}
          render={(link, i) => (
            <div className="flex gap-2">
              <input
                className={`${inputCls} w-1/3`}
                value={link.label}
                placeholder="Docs"
                onChange={(e) =>
                  setSettings((s) => ({ ...s, quickLinks: s.quickLinks.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)) }))
                }
              />
              <input
                className={inputCls}
                value={link.href}
                placeholder="/docs"
                onChange={(e) =>
                  setSettings((s) => ({ ...s, quickLinks: s.quickLinks.map((l, j) => (j === i ? { ...l, href: e.target.value } : l)) }))
                }
              />
            </div>
          )}
        />

        {/* Contact methods */}
        <ListEditor
          title="Contact methods"
          hint="Phone, email, or a support URL. Phone → tel:, email → mailto:."
          items={settings.contactMethods}
          onAdd={() => setSettings((s) => ({ ...s, contactMethods: [...s.contactMethods, { type: 'phone', label: '', value: '' }] }))}
          onRemove={(i) => setSettings((s) => ({ ...s, contactMethods: s.contactMethods.filter((_, j) => j !== i) }))}
          render={(m, i) => (
            <div className="flex gap-2">
              <select
                className={`${inputCls} w-28`}
                value={m.type}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    contactMethods: s.contactMethods.map((c, j) => (j === i ? { ...c, type: e.target.value as ContactType } : c)),
                  }))
                }
              >
                <option value="phone">Phone</option>
                <option value="email">Email</option>
                <option value="url">URL</option>
              </select>
              <input
                className={`${inputCls} w-1/3`}
                value={m.label}
                placeholder="Call sales"
                onChange={(e) =>
                  setSettings((s) => ({ ...s, contactMethods: s.contactMethods.map((c, j) => (j === i ? { ...c, label: e.target.value } : c)) }))
                }
              />
              <input
                className={inputCls}
                value={m.value}
                placeholder={m.type === 'phone' ? '+1 (555) 010-2030' : m.type === 'email' ? 'support@acme.com' : 'https://acme.com/help'}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, contactMethods: s.contactMethods.map((c, j) => (j === i ? { ...c, value: e.target.value } : c)) }))
                }
              />
            </div>
          )}
        />

        {/* Tools (MCP gateway, Phase 2) */}
        <section className="space-y-3 rounded-2xl border border-[var(--border-light)] bg-[var(--surface-primary)] p-5">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Tools</h2>
            <p className="text-[12px] text-[var(--text-muted)]">
              Tools the agent may call (Nemo MCP gateway). Each call is guardrailed, credit-metered, and audited
              server-side. Off by default — the agent stays pure-RAG.
            </p>
          </div>
          {tools.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)]">
              No tools available — the gateway is unreachable from this agent key, or none are enabled for it.
            </p>
          ) : (
            <div className="space-y-2">
              {tools.map((t) => {
                const on = settings.enabledTools.includes(t.id);
                const hasCred = vault.toolIds.includes(t.id);
                return (
                  <div key={t.id} className="rounded-lg border border-[var(--border-light)] px-3 py-2.5">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            enabledTools: e.target.checked
                              ? [...s.enabledTools, t.id]
                              : s.enabledTools.filter((id) => id !== t.id),
                          }))
                        }
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-[var(--text-primary)]">{t.title || t.id}</span>
                        <span className="block text-[12px] text-[var(--text-muted)]">{t.description}</span>
                      </span>
                    </label>

                    {/* Credential (vault) — only meaningful when the tool is enabled. */}
                    {on && (
                      <div className="mt-2.5 border-t border-[var(--border-subtle)] pt-2.5 pl-7">
                        {!vault.vaultConfigured ? (
                          <p className="text-[11px] text-[var(--text-muted)]">
                            Set <code className="rounded bg-[var(--surface-hover)] px-1">TOOL_VAULT_KEY</code> in this
                            agent&apos;s env to store a credential for this tool.
                          </p>
                        ) : hasCred ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12px] text-[var(--nemo-indigo)]">🔒 Credential stored (encrypted)</span>
                            <button type="button" onClick={() => clearCred(t.id)} className={btnGhost}>
                              Clear
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              autoComplete="off"
                              placeholder="Paste tool credential (e.g. API token)"
                              value={credInput[t.id] ?? ''}
                              onChange={(e) => setCredInput((s) => ({ ...s, [t.id]: e.target.value }))}
                              className={`${inputCls} text-[12px]`}
                            />
                            <button
                              type="button"
                              onClick={() => setCred(t.id)}
                              disabled={busy || !(credInput[t.id] ?? '').trim()}
                              className={btnPrimary}
                            >
                              Set
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="flex items-center gap-3 pb-12">
          <button type="button" onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
          <button type="button" onClick={reindex} disabled={busy} className={btnGhost}>
            Re-index knowledge base
          </button>
        </div>
      </div>
    </main>
  );
}

/** Generic add/remove list editor used for suggestions, quick links, contacts. */
function ListEditor<T>({
  title,
  hint,
  items,
  onAdd,
  onRemove,
  render,
}: {
  title: string;
  hint: string;
  items: T[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  render: (item: T, index: number) => React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border-light)] bg-[var(--surface-primary)] p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</h2>
          <p className="text-[12px] text-[var(--text-muted)]">{hint}</p>
        </div>
        <button type="button" onClick={onAdd} className={btnGhost}>
          + Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-[var(--text-muted)]">None yet — add one, or leave empty to use the defaults.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">{render(item, i)}</div>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label="Remove"
                className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--nemo-coral-dark)]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
