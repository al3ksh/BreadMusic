'use client';

import { useEffect, useState } from 'react';

const CONSENT_KEY = 'bread_cookie_notice_v1';

export function CookieNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const consent = window.localStorage.getItem(CONSENT_KEY);
      setOpen(!consent);
    } catch {
      setOpen(true);
    }
  }, []);

  const accept = () => {
    try {
      window.localStorage.setItem(CONSENT_KEY, 'accepted');
    } catch {
      // Ignore storage failures and just hide the banner in memory.
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed left-4 bottom-4 z-[210] w-[min(92vw,360px)] rounded-lg border border-border bg-bg-card/95 backdrop-blur-md p-3 shadow-2xl animate-slide-up">
      <p className="text-xs font-semibold text-text-primary">Cookie notice</p>
      <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">
        We use essential cookies for Discord login and dashboard session (`bread.sid`).
        See our privacy, cookies, and terms pages for details.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <button
          type="button"
          onClick={accept}
          className="inline-flex items-center justify-center rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover transition-colors cursor-pointer"
        >
          Got it
        </button>

        <a href="/cookies" className="underline text-text-secondary hover:text-text-primary transition-colors">
          Cookies policy
        </a>
        <a href="/privacy" className="underline text-text-secondary hover:text-text-primary transition-colors">
          Privacy policy
        </a>
        <a href="/terms" className="underline text-text-secondary hover:text-text-primary transition-colors">
          Terms of use
        </a>
      </div>
    </div>
  );
}
