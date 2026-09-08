import type { ReactNode } from 'react';

export const metadata = { title: 'rerender-lens Next.js example' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem', color: '#222' }}>{children}</body>
    </html>
  );
}
