import { AskGuruWidget } from '@/components/AskGuruWidget';

// Demo page — the widget opens by default so visitors see it immediately, and the
// page shows the one-line embed snippet + a link to the docs.
const EMBED = `<script src="https://guru-cs-agent-suz5ioxcsq-uc.a.run.app/widget.js"></script>`;

export default function Page() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg,#faf7f2,#eef7f0)',
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        color: '#0f0e0c',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '72px 24px' }}>
        <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', color: '#0d9488', margin: 0 }}>
          NEMO ROUTER · AGENT MARKETPLACE
        </p>
        <h1 style={{ fontSize: 34, margin: '8px 0 4px' }}>Ask AI Guru</h1>
        <p style={{ color: '#76716a', fontSize: 17, lineHeight: 1.5, maxWidth: 560 }}>
          A pluggable AI support agent — answers from your docs, grounded, on your site. The widget
          is open on the right. Drop it on any website with one line:
        </p>

        <pre
          style={{
            background: '#0f0e0c',
            color: '#eef7f0',
            padding: '16px 18px',
            borderRadius: 12,
            fontSize: 13,
            overflowX: 'auto',
            margin: '20px 0',
          }}
        >
          <code>{EMBED}</code>
        </pre>

        <p style={{ color: '#76716a', fontSize: 15 }}>
          Full setup, customization, and cost tracking:{' '}
          <a href="/docs.html" style={{ color: '#0d9488', fontWeight: 600 }}>
            read the docs →
          </a>
        </p>
      </div>

      {/* Open by default on the demo page so the agent is visible immediately. */}
      <AskGuruWidget defaultOpen />
    </main>
  );
}
