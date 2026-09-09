'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Check, Copy, Github, X } from 'lucide-react';
import styles from './invite.module.css';

interface AddToDiscordModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddToDiscordModal({ open, onClose }: AddToDiscordModalProps) {
  const [copied, setCopied] = useState(false);
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }

    if (!rendered) return;

    setClosing(true);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeout = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, reducedMotion ? 0 : 180);

    return () => window.clearTimeout(timeout);
  }, [open, rendered]);

  useEffect(() => {
    if (!rendered) return;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    if (scrollbarWidth > 0) {
      const bodyPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`;
    }

    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      previousFocus?.focus();
      setCopied(false);
    };
  }, [rendered]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText('aleksh8');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (!rendered) return null;

  return createPortal(
    <div className={`${styles.overlay} ${closing ? styles.closing : ''}`}>
      <button
        type="button"
        aria-label="Close popup"
        onClick={onClose}
        className={styles.backdrop}
        tabIndex={-1}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        onKeyDown={event => {
          if (event.key !== 'Tab') return;
          const elements = event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]');
          const first = elements[0];
          const last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={styles.close}
        >
          <X size={16} />
        </button>

        <img className={styles.logo} src="/assets/breadicon.png" width={52} height={52} alt="" />

        <h2 id={titleId}>
          Add to Discord
        </h2>
        <p className={styles.description}>
          Bread is private right now. If you want access, message me directly on Discord.
        </p>

        <div className={styles.actions}>
          <button type="button" className={styles.contact} onClick={handleCopy} aria-label="Copy Discord username">
            {copied ? <Check size={21} /> : <Copy size={21} />}
            <span><small>Discord contact</small><strong>aleksh8</strong></span>
            <span className={styles.copyState} aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <a
            href="https://github.com/al3ksh/BreadMusic"
            target="_blank"
            rel="noreferrer"
            className={styles.source}
          >
            <Github size={21} /><span>View source on GitHub</span><ArrowUpRight size={18} />
          </a>
        </div>
        <footer className={styles.footer}><span>Private access</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
      </div>
    </div>,
    document.body,
  );
}
