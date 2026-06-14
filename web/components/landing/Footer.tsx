'use client';

import { useState } from 'react';
import { AddToDiscordModal } from '@/components/landing/AddToDiscordModal';

export function Footer() {
  const name = 'Bread';
  const [showInviteModal, setShowInviteModal] = useState(false);

  return (
    <footer className="w-full border-t border-border py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="flex items-center gap-2.5 text-text-secondary">
            <div className="w-6 h-6 rounded-md shadow-sm shrink-0 flex items-center justify-center relative overflow-hidden">
              <img src="/assets/breadicon.png?v=3" alt="" className="w-full h-full object-cover" />
            </div>
            <span className="text-base font-bold">{name}</span>
          </div>
          
          <div className="hidden sm:block w-px h-4 bg-border"></div>

          <div className="flex items-center gap-4 text-sm text-text-muted">
            <span className="transition-colors">
              Made by <a href="https://aleksh.xyz" target="_blank" rel="noreferrer" className="font-semibold hover:text-text-primary transition-colors">aleksh</a>
            </span>
            <span>•</span>
            <a href="https://github.com/al3ksh/BreadMusic" target="_blank" rel="noreferrer" className="hover:text-text-primary transition-colors">
              Source
            </a>
            <span>•</span>
            <a href="https://github.com/al3ksh/BreadMusic/blob/main/LICENSE" target="_blank" rel="noreferrer" className="hover:text-text-primary transition-colors">
              AGPL-3.0
            </a>
            <span>•</span>
            <a href="/privacy" className="hover:text-text-primary transition-colors">
              Privacy
            </a>
            <span>•</span>
            <a href="/cookies" className="hover:text-text-primary transition-colors">
              Cookies
            </a>
            <span>•</span>
            <a href="/terms" className="hover:text-text-primary transition-colors">
              Terms
            </a>
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm text-text-muted">
          <button
            type="button"
            onClick={() => setShowInviteModal(true)}
            className="hover:text-text-secondary transition-colors"
          >
            Add to Discord
          </button>
          <a href="/dashboard" className="hover:text-text-secondary transition-colors">
            Dashboard
          </a>
        </div>

        <AddToDiscordModal open={showInviteModal} onClose={() => setShowInviteModal(false)} />
      </div>
    </footer>
  );
}
