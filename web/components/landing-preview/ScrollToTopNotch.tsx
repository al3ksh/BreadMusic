'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import styles from './preview.module.css';

export function ScrollToTopNotch({ hidden = false }: { hidden?: boolean }) {
  const notchRef = useRef<HTMLButtonElement>(null);
  const visibleRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const root = document.documentElement;
      const maxScroll = Math.max(1, root.scrollHeight - root.clientHeight);
      notchRef.current?.style.setProperty('--scroll-progress', String(Math.min(1, window.scrollY / maxScroll)));
      const hero = document.getElementById('main-content');
      const nextVisible = Boolean(hero && hero.getBoundingClientRect().bottom <= 0);
      if (visibleRef.current !== nextVisible) {
        visibleRef.current = nextVisible;
        setVisible(nextVisible);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const onFocusIn = (event: FocusEvent) => setEditing(event.target instanceof HTMLElement && event.target.matches('input, textarea, [contenteditable="true"]'));
    const onFocusOut = (event: FocusEvent) => setEditing(event.relatedTarget instanceof HTMLElement && event.relatedTarget.matches('input, textarea, [contenteditable="true"]'));
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const shown = visible && !hidden && !editing;
  return (
    <button
      ref={notchRef}
      type="button"
      className={styles.scrollNotch}
      data-visible={shown}
      aria-label="Back to top"
      aria-hidden={!shown}
      title="Back to top"
      tabIndex={shown ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
    >
      <ArrowUp size={16} aria-hidden="true" />
    </button>
  );
}
