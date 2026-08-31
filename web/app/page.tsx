import type { Metadata } from 'next';
import { LandingPreview } from '@/components/landing-preview/LandingPreview';
import { landingDemoConfig } from '@/lib/landing-demo-server';
import ActivityPage from './activity/page';

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: HomeProps): Promise<Metadata> {
  const params = await searchParams;
  if (params.frame_id && params.instance_id && params.platform) return { title: 'Bread Activity', robots: { index: false, follow: false } };
  const { origin } = landingDemoConfig();
  const title = 'Bread - Music for your Discord';
  const description = 'A shared player, live lyrics and a queue everyone can add to. Try Bread Activity, slash commands and Arcade.';
  return {
    title, description, alternates: { canonical: origin || '/' },
    openGraph: { title, description, type: 'website', url: origin || undefined, images: [{ url: `${origin}/assets/landing-preview/activity.png`, width: 1000, height: 560, alt: 'Bread Activity music player' }] },
    twitter: { card: 'summary_large_image', title, description, images: [`${origin}/assets/landing-preview/activity.png`] },
  };
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const isActivityRequest = Boolean(params.frame_id && params.instance_id && params.platform);

  if (isActivityRequest) return <ActivityPage />;

  return <LandingPreview liveSearch={landingDemoConfig().liveSearch} />;
}
