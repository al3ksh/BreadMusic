'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';

interface AddToDiscordModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddToDiscordModal({ open, onClose }: AddToDiscordModalProps) {
  const [copied, setCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      setCopied(false);
    };
  }, [open, onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText('aleksh8');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close popup"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-2xl border border-border bg-bg-card p-6 shadow-2xl"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-primary"
        >
          <X size={16} />
        </button>

        <div className="mb-5 inline-flex rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
          Private access
        </div>

        <h2 id={titleId} className="text-2xl font-bold text-text-primary">
          Add to Discord
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Bread is private right now. If you want access, message me directly or deploy it yourself.
        </p>

        <div className="mt-6 space-y-3">
          <div className="rounded-xl border border-border bg-bg-secondary p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Discord contact
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="font-mono text-lg text-text-primary">aleksh8</span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <a
            href="https://github.com/al3ksh/BreadMusic"
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 font-semibold text-white transition-all hover:bg-accent-hover"
          >
            Deploy it yourself
            <ExternalLink size={16} />
          </a>
        </div>
      </div>
    </div>
  );
}
