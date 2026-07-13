import '@gatelm/ui/theme.css';
import './globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'GateLM Chat', template: '%s · GateLM Chat' },
  description: '조직에서 안전하게 사용하는 GateLM Chat',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
