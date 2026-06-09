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
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        <button
          onClick={() => router.push('/')}
          className="flex min-w-0 items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl relative overflow-hidden flex items-center justify-center shrink-0">
            <img src="/assets/breadicon.png?v=3" alt="" className="w-full h-full object-cover" />
          </div>
          <span className="truncate font-bold text-base sm:text-lg text-text-primary">{botName}</span>
        </button>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary sm:border-0 sm:px-4 sm:text-sm"
          >
            Dashboard
          </a>
          <button
            type="button"
            onClick={() => setShowInviteModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover sm:px-5 sm:py-2.5 sm:text-sm"
          >
            <span className="sm:hidden">Add</span>
            <span className="hidden sm:inline">Add to Discord</span>
          </button>
        </div>

        <AddToDiscordModal open={showInviteModal} onClose={() => setShowInviteModal(false)} />
      </div>
    </nav>
  );
}
