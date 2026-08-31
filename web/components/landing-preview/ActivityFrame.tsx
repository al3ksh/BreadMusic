'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './preview.module.css';

const documentMarkup = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="min-h-screen"><div id="activity-preview-root"></div></body></html>';

// A separate CSS viewport preserves Activity's actual media queries and fonts.
// React owns both views, so no SDK mock, message bridge or duplicated state is needed.
export function ActivityFrame({ children }: { children: ReactNode }) {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const initialize = useCallback(() => {
    const frame = iframe.current?.contentDocument;
    const target = frame?.getElementById('activity-preview-root');
    if (!frame || !target) return;
    if (!frame.head.querySelector('[data-preview-style]')) document.querySelectorAll('link[rel="stylesheet"], style').forEach(style => {
      const copy = style.cloneNode(true) as HTMLElement; copy.setAttribute('data-preview-style', ''); frame.head.appendChild(copy);
    });
    setMount(target);
  }, []);
  // srcdoc can finish loading before Next hydrates the parent event handler.
  useEffect(() => { initialize(); }, [initialize]);
  return <><iframe ref={iframe} title="Bread Activity preview" className={styles.activityFrame} srcDoc={documentMarkup} onLoad={initialize} />{mount && createPortal(children, mount)}</>;
}
