import { notFound } from 'next/navigation';
import { LandingPreview } from '@/components/landing-preview/LandingPreview';
import { landingDemoConfig } from '@/lib/landing-demo-server';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Bread / Landing preview',
  robots: { index: false, follow: false },
};

export default function PreviewPage() {
  if (process.env.BREAD_LANDING_PREVIEW !== '1') notFound();
  return <LandingPreview preview liveSearch={landingDemoConfig().liveSearch} />;
}
