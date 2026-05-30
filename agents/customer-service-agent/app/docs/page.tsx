import { AskGuruWidget } from '@/components/AskGuruWidget';

// Docs page — the Ask AI Guru agent is OPEN on it (so you can ask while you read).
export const metadata = { title: 'Docs' };

const C = { ink: '#0f0e0c', body: '#1c1b18', muted: '#76716a', teal: '#0d9488', mint: '#90fca6', line: 'rgba(15,14,12,.1)' };
const pre: React.CSSProperties = { background: C.ink, color: '#eef7f0', padding: '16px 18px', borderRadius: 12, fontSize: 13, overflowX: 'auto' };
const h2: React.CSSProperties = { fontSize: 22, margin: '40px 0 10px', borderTop: `1px solid ${C.line}`, paddingTop: 28 };
const h3: React.CSSProperties = { fontSize: 16, margin: '22px 0 6px' };

export default function DocsPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg,#faf7f2,#eef7f0)',
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        color: C.body,
        lineHeight: 1.55,
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px 140px' }}>
        <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', color: C.teal, margin: 0 }}>
          NEMO ROUTER · ENTERPRISE MARKETPLACE
        </p>
        <h1 style={{ fontSize: 32, margin: '6px 0 4px', color: C.ink }}>Embed an AI Agent</h1>
        <p style={{ color: C.muted, fontSize: 17 }}>
          Add a pluggable AI support agent to any site — it answers from your docs, grounded, on the
          NemoRouter gateway. Try it: the agent is open on the right.
        </p>

        <h2 style={h2}>
          Embed the widget{' '}
          <span style={{ background: C.mint, color: '#000', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>
            30 seconds
          </span>
        </h2>
        <p>Drop one line before <code>&lt;/body&gt;</code>. The launcher appears bottom-right; the key never reaches the browser.</p>
        <pre style={pre}><code>{`<script src="https://api.nemorouter.ai/agents/widget.js"></script>`}</code></pre>

        <h2 style={h2}>Run your own agent</h2>
        <p>Fork one open-source app. You own the frontend, backend, and vector DB; NemoRouter is the brain (chat + embeddings).</p>
        <h3 style={h3}>1. Fork &amp; install</h3>
        <pre style={pre}><code>{`git clone <your-fork> my-agent && cd my-agent
npm install`}</code></pre>
        <h3 style={h3}>2. Create a virtual key</h3>
        <p>In your dashboard, open the <strong>API Keys</strong> page and create a key with a per-day budget — your hard cap, covering chat and embeddings.</p>
        <h3 style={h3}>3. Configure</h3>
        <pre style={pre}><code>{`NEMOROUTER_API_KEY=sk-nemo-your-key
MODEL=gemini-2.5-flash-lite
EMBEDDING_MODEL=text-embedding-005
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_SCHEMA=public
SYSTEM_PROMPT=You are MyCo's assistant. Answer only from the provided context.
ALLOWED_ORIGINS=https://myco.com,http://localhost:3000
ADMIN_TOKEN=a-long-random-string`}</code></pre>
        <h3 style={h3}>4. Seed the knowledge base &amp; run</h3>
        <pre style={pre}><code>{`psql "$DATABASE_URL" -f supabase/migration.sql
npm run dev        # http://localhost:3000
npm run ingest     # your docs -> embeddings -> KB`}</code></pre>
        <h3 style={h3}>5. Deploy</h3>
        <pre style={pre}><code>{`npm run deploy:prod   # Cloud Run today; Azure/AWS tomorrow`}</code></pre>

        <h2 style={h2}>How it works</h2>
        <pre style={pre}><code>{`You own                      NemoRouter provides
- the chat widget            - the chat model
- the backend (RAG)          - the embedding model
- the vector database        - guardrails, routing, cost tracking`}</code></pre>

        <h2 style={h2}>Tracking costs</h2>
        <p>Every chat <strong>and embedding</strong> call is metered on your key — header <code>x-nemo-request-cost</code>, a per-request ledger, and the key&apos;s aggregate <code>spend</code> (which enforces the budget). Cost split by model:</p>
        <pre style={pre}><code>{`select model, count(*) as calls, round(sum(spend)::numeric, 6) as usd
from "LiteLLM_SpendLogs"
where "startTime" > now() - interval '24 hours'
group by model order by usd desc;
-- gemini-2.5-flash-lite | 8  | 0.001271   (chat)
-- text-embedding-005    | 99 | 0.000637   (embeddings, captured)`}</code></pre>
        <p style={{ color: C.muted }}>Embeddings are micro-cent line items that draw on the same budget as chat — nothing free or hidden.</p>
      </div>

      {/* Agent open (full two-pane view) on the docs page so you can ask while you read. */}
      <AskGuruWidget defaultOpen defaultExpanded />
    </main>
  );
}
