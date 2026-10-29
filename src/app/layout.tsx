import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'UltraTrading360 — Deriv Trading Automation',
  description:
    'Strategy builder, statistical analysis and automated trading for the Deriv API, with a deterministic simulation engine and enforced risk limits.',
  applicationName: 'UltraTrading360',
};

export const viewport: Viewport = {
  themeColor: '#07080b',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root layout.
 *
 * `suppressHydrationWarning` is set because the shell reads persisted settings from IndexedDB
 * on mount; that is a deliberate client-only step and must not be attempted during SSR.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
