'use client';
import { useEffect, useRef, useState } from 'react';
import { Gamepad2, Pause, Play } from 'lucide-react';
import { asset } from './demo';
import styles from './preview.module.css';
const games = [{ name: 'RPS', file: 'carousel-rps.png' }, { name: 'Blackjack', file: 'carousel-blackjack.png' }, { name: 'Slots', file: 'slots-0.png' }, { name: 'Roulette', file: 'carousel-roulette.png' }];
export function ArcadeCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(motion.matches); update(); motion.addEventListener('change', update);
    const visibility = () => setHidden(document.hidden); visibility(); document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { threshold: .4 });
    if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); motion.removeEventListener('change', update); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (paused || !visible || hidden || reduced) return;
    const timer = setInterval(() => {
      // Read live interaction state: rapid resume/blur can batch React events.
      if (!ref.current || ref.current.matches(':hover, :focus-within')) return;
      setIndex(value => (value + 1) % games.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [paused, visible, hidden, reduced]);
  return <div ref={ref} className={styles.arcadeImage} role="region" aria-label="Bread Arcade gallery" aria-roledescription="carousel">
    <div className={styles.arcadeSlides}>{games.map((game, item) => <img key={game.name} src={asset(game.file)} alt={`Bread Arcade ${game.name} sample round`} aria-hidden={item !== index} data-active={item === index} loading="lazy" />)}</div>
    <div className={styles.arcadeCarouselControls}><Gamepad2 size={16} /><div>{games.map((game, item) => <button type="button" key={game.name} aria-pressed={index === item} onClick={() => { setIndex(item); setPaused(true); }}>{game.name}</button>)}</div><button type="button" title={paused ? 'Resume slideshow' : 'Pause slideshow'} aria-label={paused ? 'Resume slideshow' : 'Pause slideshow'} disabled={reduced} onClick={() => setPaused(!paused)}>{paused ? <Play size={15} /> : <Pause size={15} />}</button></div>
  </div>;
}
