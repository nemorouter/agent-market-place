import { AskGuruWidget } from '@/components/AskGuruWidget';

// Hosted demo page — renders the EXACT ported AskGuruWidget (the Nemo "Ask AI"
// agent, 1:1) as a floating launcher bottom-right.
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
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '72px 24px' }}>
        <h1 style={{ fontSize: 30, margin: 0 }}>Ask AI Guru</h1>
        <p style={{ color: '#76716a', fontSize: 16 }}>
          The launcher is bottom-right — click it to chat. This is a 1:1 replica of the Nemo Router
          “Ask AI” agent, wired to Ask AI Guru’s own knowledge base.
        </p>
      </div>
      <AskGuruWidget />
    </main>
  );
}
