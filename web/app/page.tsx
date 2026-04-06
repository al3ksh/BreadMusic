import { LandingNav } from '@/components/landing/LandingNav';
import { Hero } from '@/components/landing/Hero';
import { Features } from '@/components/landing/Features';
import { Stats } from '@/components/landing/Stats';
import { Footer } from '@/components/landing/Footer';

export default function Home() {
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
