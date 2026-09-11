'use client';

import { useRef, type PointerEvent, type MouseEvent } from 'react';

export function useGallerySwipe(step: (direction: number) => void) {
  const gesture = useRef<{ id: number; x: number; y: number; horizontal: boolean } | null>(null);
  const swiped = useRef(false);
  const reset = (element: HTMLElement) => {
    gesture.current = null;
    element.style.removeProperty('--swipe-x');
    element.removeAttribute('data-swiping');
  };
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!event.isPrimary) { reset(event.currentTarget); return; }
      if (event.button !== 0) return;
      swiped.current = false;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId) return;
      const x = event.clientX - start.x, y = event.clientY - start.y;
      if (!start.horizontal) {
        if (Math.abs(y) > 12 && Math.abs(y) > Math.abs(x)) { reset(event.currentTarget); return; }
        if (Math.abs(x) < 12 || Math.abs(x) < Math.abs(y) * 1.3) return;
        start.horizontal = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.setAttribute('data-swiping', 'true');
      }
      swiped.current = true;
      event.currentTarget.style.setProperty('--swipe-x', `${Math.max(-100, Math.min(100, x))}px`);
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const start = gesture.current;
      if (start?.id === event.pointerId && start.horizontal && Math.abs(event.clientX - start.x) > 48) step(event.clientX < start.x ? 1 : -1);
      reset(event.currentTarget);
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) { reset(event.currentTarget); },
    onLostPointerCapture(event: PointerEvent<HTMLElement>) {
      if (event.target === event.currentTarget) reset(event.currentTarget);
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (swiped.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); swiped.current = false; }
    },
  };
}
