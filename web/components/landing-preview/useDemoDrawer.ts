'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';

type Panel = 'queue' | 'search' | 'lyrics';

export function useDemoDrawer() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [closing, setClosing] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const animation = useRef<Animation | null>(null);
  const entered = useRef(false);
  const gesture = useRef<{ id: number; start: number; offset: number } | null>(null);

  const animate = useCallback((close: boolean) => {
    const drawer = drawerRef.current, win = drawer?.ownerDocument.defaultView;
    if (!drawer || !win) return;
    // Read the presentation position before cancelling, including an interrupted drag.
    const offscreen = win.innerWidth <= 980 ? 'translateY(100%)' : 'translateX(100%)';
    const from = entered.current ? win.getComputedStyle(drawer).transform : offscreen;
    animation.current?.cancel();
    entered.current = true;
    const to = close ? offscreen : 'translate(0, 0)';
    drawer.style.transform = to;
    const finish = () => {
      if (close) {
        if (drawer.contains(drawer.ownerDocument.activeElement)) drawer.closest('main')?.querySelector<HTMLButtonElement>('.activity-panel-nav button.active')?.focus({ preventScroll: true });
        entered.current = false; setPanel(null); setClosing(false);
      }
    };
    if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    const motion = drawer.animate([{ transform: from }, { transform: to }], { duration: close ? 180 : 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    animation.current = motion;
    motion.onfinish = finish;
  }, []);

  useLayoutEffect(() => { if (panel) animate(closing); }, [panel, closing, animate]);
  useEffect(() => () => { animation.current?.cancel(); }, []);
  const closePanel = useCallback(() => { gesture.current = null; setClosing(true); }, []);
  const openPanel = useCallback((next: Panel) => { gesture.current = null; setClosing(false); setPanel(next); }, []);
  const togglePanel = (next: Panel) => { if (panel === next && !closing) closePanel(); else openPanel(next); };
  const finishGesture = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    gesture.current = null;
    if (!cancelled && start.offset > 80) closePanel(); else animate(false);
  };
  const gestureHandlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const drawer = drawerRef.current, win = drawer?.ownerDocument.defaultView;
      if (!event.isPrimary || closing || !drawer || !win || win.innerWidth > 980 || (event.target as Element).closest('button')) return;
      const offset = new DOMMatrixReadOnly(win.getComputedStyle(drawer).transform).m42;
      animation.current?.cancel();
      drawer.style.transform = `translateY(${offset}px)`;
      gesture.current = { id: event.pointerId, start: event.clientY - offset, offset };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId || !drawerRef.current) return;
      start.offset = Math.max(0, event.clientY - start.start);
      drawerRef.current.style.transform = `translateY(${start.offset}px)`;
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => finishGesture(event),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finishGesture(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => { if (event.target === event.currentTarget) finishGesture(event, true); },
  };
  return { panel, closing, drawerRef, closePanel, openPanel, togglePanel, gestureHandlers };
}
