import type { ReactNode } from 'react';

const AGENT_NAME = process.env.NEXT_PUBLIC_AGENT_NAME || 'Support Agent';

export const metadata = {
  title: AGENT_NAME,
  description: `${AGENT_NAME} — powered by Nemo Router.`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
