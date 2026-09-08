'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './preview.module.css';

const trails = [
  { x: '8%', y: '6%', size: 60, delay: -8 },
  { x: '92%', y: '10%', size: 68, delay: -22 },
  { x: '14%', y: '28%', size: 56, delay: -16 },
  { x: '96%', y: '37%', size: 64, delay: -3 },
  { x: '7%', y: '53%', size: 66, delay: -25 },
  { x: '89%', y: '61%', size: 58, delay: -11 },
  { x: '12%', y: '79%', size: 60, delay: -1 },
  { x: '94%', y: '86%', size: 54, delay: -19 },
];

export function BreadSky() {
  const ref = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    let visible = false;
    const update = () => setRunning(visible && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(field);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return <div ref={ref} className={styles.breadSky} data-running={running} aria-hidden="true">
    {trails.map((trail, index) => <span key={index} className={styles.breadMeteor} style={{ left: trail.x, top: trail.y, '--size': `${trail.size}px`, '--delay': `${trail.delay}s` } as CSSProperties}>
      <span className={styles.breadGlyph} />
    </span>)}
  </div>;
}
