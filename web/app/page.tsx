import { LandingNav } from '@/components/landing/LandingNav';
import { Hero } from '@/components/landing/Hero';
import { Features } from '@/components/landing/Features';
import { Stats } from '@/components/landing/Stats';
import { Footer } from '@/components/landing/Footer';
import ActivityPage from './activity/page';

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const isActivityRequest = Boolean(params.frame_id && params.instance_id && params.platform);

  if (isActivityRequest) return <ActivityPage />;

  return (
    <main>
      <LandingNav />
      <Hero />
      <Features />
      <Stats />
      <Footer />
    </main>
  );
}
