'use client';

import { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { AddToDiscordModal } from '@/components/landing/AddToDiscordModal';

export function Hero() {
  const name = 'Bread';
  const [showInviteModal, setShowInviteModal] = useState(false);

  return (
    <section className="relative w-full overflow-hidden pt-16">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
      <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-accent/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-40 right-1/4 w-[300px] h-[300px] bg-accent/5 rounded-full blur-[80px] pointer-events-none" />

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-accent/30 rounded-full animate-float"
            style={{
              left: `${15 + i * 15}%`,
              top: `${20 + (i % 3) * 25}%`,
              animationDelay: `${i * 0.8}s`,
              animationDuration: `${4 + i * 0.5}s`,
            }}
          />
        ))}
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-36 pb-24 text-center">
        {/* Icon */}
        <div className="animate-fade-up delay-100 mb-8 flex justify-center">
          <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-3xl shadow-2xl shadow-accent/20 overflow-hidden shrink-0 animate-float">
            <img
              src="/assets/breadicon.png?v=3"
              alt={name}
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 animate-fade-up delay-200">
          <span className="gradient-text">{name}</span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-up delay-300">
          Music playback, audio filters, games, and economy — all in one bot.
          Manage everything from your dashboard.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-up delay-400 max-w-md mx-auto sm:max-w-none">
          <button
            type="button"
            onClick={() => setShowInviteModal(true)}
            className="group w-full sm:w-60 h-14 inline-flex items-center justify-center gap-2.5 px-6 rounded-xl bg-accent border border-transparent text-white font-semibold text-base whitespace-nowrap hover:bg-accent-hover transition-all shadow-lg shadow-accent/25 hover:shadow-accent/40 hover:-translate-y-0.5 active:translate-y-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286z"/>
            </svg>
            Add to Discord
          </button>
          <a
            href="/api/auth/discord"
            className="group w-full sm:w-60 h-14 inline-flex items-center justify-center gap-2.5 px-6 rounded-xl bg-bg-card border border-border text-text-primary font-semibold text-base whitespace-nowrap hover:bg-bg-hover hover:border-accent/30 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
          >
            Open Dashboard
          </a>
        </div>

        <AddToDiscordModal open={showInviteModal} onClose={() => setShowInviteModal(false)} />
      </div>
    </section>
  );
}
