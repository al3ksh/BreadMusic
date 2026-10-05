import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Bread Activity preview',
  robots: { index: false, follow: false },
};

export default function ActivityDemoLayout({ children }: { children: ReactNode }) {
  return children;
}
