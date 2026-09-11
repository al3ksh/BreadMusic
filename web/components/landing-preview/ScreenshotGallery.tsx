'use client';

import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { asset } from './demo';
import { useGallerySwipe } from './useGallerySwipe';
import styles from './preview.module.css';

type View = { label: string; file: string; mobile: string };
export function ScreenshotGallery({ open, views, index, step, onClose }: {
  open: boolean; views: View[]; index: number; step: (direction: number) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const animation = useRef<Animation | null>(null);
  const restoreScroll = useRef<(() => void) | null>(null);
  const swipe = useGallerySwipe(step);
  const view = views[index];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || (!open && !dialog.open)) return;
    const wasOpen = dialog.open;
    const current = getComputedStyle(dialog);
    const from = wasOpen ? { opacity: current.opacity, transform: current.transform } : { opacity: '0', transform: 'translateY(12px) scale(.985)' };
    animation.current?.cancel();
    if (open && !wasOpen) {
      const body = document.body;
      const overflow = body.style.overflow, padding = body.style.paddingRight;
      const gutter = innerWidth - document.documentElement.clientWidth;
      if (gutter > 0) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gutter}px`;
      body.style.overflow = 'hidden';
      restoreScroll.current = () => { body.style.overflow = overflow; body.style.paddingRight = padding; };
      dialog.showModal();
    }
    const finish = () => {
      if (!open) { dialog.close(); restoreScroll.current?.(); restoreScroll.current = null; }
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    const motion = dialog.animate([from, { opacity: open ? '1' : '0', transform: open ? 'none' : 'translateY(8px) scale(.99)' }], { duration: open ? 240 : 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
    animation.current = motion;
    motion.onfinish = finish;
    return () => { motion.onfinish = null; };
  }, [open]);
  useEffect(() => () => { animation.current?.cancel(); restoreScroll.current?.(); }, []);

  return <dialog ref={ref} className={styles.screenDialog} data-closing={!open} aria-label={`${view.label} screenshot`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (!open || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1);
    }}>
    <div className={styles.dialogHead}><strong aria-live="polite">Bread / {view.label}</strong><div className={styles.galleryControls}>
      <span className={styles.galleryCount}>{index + 1} / {views.length}</span>
      <button type="button" aria-label="Previous screenshot" title="Previous screenshot" onClick={() => step(-1)}><ChevronLeft size={22} /></button>
      <button type="button" aria-label="Next screenshot" title="Next screenshot" onClick={() => step(1)}><ChevronRight size={22} /></button>
      <button type="button" autoFocus aria-label="Close dialog" title="Close" onClick={onClose}><X size={22} /></button>
    </div></div>
    <div className={styles.galleryViewport} {...swipe}>
      <picture key={view.file}><source media="(max-width: 620px)" srcSet={asset(view.mobile)} /><img draggable={false} src={asset(view.file)} alt={`Full ${view.label} screenshot with sample data`} /></picture>
    </div>
  </dialog>;
}
