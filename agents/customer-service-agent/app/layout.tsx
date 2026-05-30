import type { ReactNode } from 'react';

export const metadata = {
  title: 'Support Agent',
  description: 'Open-source support agent powered by Nemo Router.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
