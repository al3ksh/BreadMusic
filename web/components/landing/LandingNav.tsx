'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AddToDiscordModal } from '@/components/landing/AddToDiscordModal';

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const router = useRouter();
  const botName = 'Bread';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 border-b border-transparent transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 ${
        scrolled
          ? 'bg-bg-primary/80 backdrop-blur-xl border-border/40 shadow-lg shadow-black/20'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer"
        >
          <div className="w-10 h-10 rounded-xl relative overflow-hidden flex items-center justify-center shrink-0">
            <img src="/assets/breadicon.png?v=3" alt="" className="w-full h-full object-cover" />
          </div>
          <span className="font-bold text-lg text-text-primary">{botName}</span>
        </button>

        <div className="flex items-center gap-3">
          <a
            href="/dashboard"
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Dashboard
          </a>
          <button
            type="button"
            onClick={() => setShowInviteModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all shadow-lg shadow-accent/20"
          >
            Add to Discord
          </button>
        </div>

        <AddToDiscordModal open={showInviteModal} onClose={() => setShowInviteModal(false)} />
      </div>
    </nav>
  );
}
