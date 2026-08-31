'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, AudioLines, Expand, Gamepad2, Github, Headphones, LayoutDashboard, ListMusic, Menu, Monitor, Plus, Radio, ShieldCheck, X } from 'lucide-react';
import { AddToDiscordModal } from '@/components/landing/AddToDiscordModal';
import { CommandDemo } from './CommandDemo';
import { ArcadeCarousel } from './ArcadeCarousel';
import { asset } from './demo';
import styles from './preview.module.css';

const views = [
  { id: 'activity', label: 'Activity', icon: Headphones, file: 'activity.png', mobile: 'activity-phone.png', title: 'Music, together in Discord.', description: 'Find tracks, follow live lyrics and control playback from your voice channel.' },
  { id: 'queue', label: 'Shared queue', icon: ListMusic, file: 'activity-queue.png', mobile: 'activity-queue-phone.png', title: 'A queue everyone can shape.', description: 'Add tracks together, drag them into order and vote to skip. DJ permissions stay in your hands.' },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, file: 'dashboard.png', mobile: 'dashboard-phone.png', title: 'Playback and server settings.', description: 'Manage your queue, listening history, DJ roles and volume limits from the web.' },
];
const faqs = [
  ['Do I need to know the commands?', 'No. Open Activity in your Discord voice channel or use the web dashboard to search, queue and control playback. Slash commands are there when you want them.'],
  ['What can I play?', 'Search for tracks, paste supported music links or upload an audio file. Bread supports YouTube and SoundCloud playback, with Spotify links resolved to a playable source. Availability depends on the source.'],
  ['Who can control the music?', 'You choose the control policy for your server. DJ roles, Activity permissions, vote skip and volume limits keep control with the right people.'],
  ['Is this a live connection to my server?', 'No. Search returns real YouTube and SoundCloud metadata, but the player is silent and its queue stays in this browser tab. The preview does not connect to Discord or change any server. Screenshots and Arcade rounds use sample data.'],
  ['Can I self-host Bread?', 'Yes. Bread is open source under AGPL-3.0. The GitHub repository includes the source code and setup documentation.'],
];

export function LandingPreview({ preview = false, liveSearch = false }: { preview?: boolean; liveSearch?: boolean }) {
  const [view, setView] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [modal, setModal] = useState<'screen' | 'invite' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selected = views[view];
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (modal === 'screen') dialog.showModal(); else dialog.close();
  }, [modal]);

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <header className={styles.nav}>
        <div className={styles.navInner}>
          <a href="#main-content" className={styles.brand}><img src="/assets/breadicon.png" width={34} height={34} alt="" /><span>Bread</span></a>
          <nav aria-label="Main navigation" className={`${styles.navLinks} ${mobileNav ? styles.navOpen : ''}`}>
            <a href="#inside-bread" onClick={() => setMobileNav(false)}>Experience</a>
            <a href="#playground" onClick={() => setMobileNav(false)}>Try Bread</a>
            <a href="#arcade" onClick={() => setMobileNav(false)}>Arcade</a>
            <a className={styles.mobileDashboard} href={preview ? 'https://breadmusic.aleksh.xyz/dashboard' : '/dashboard'} target={preview ? '_blank' : undefined} rel={preview ? 'noreferrer' : undefined}>Dashboard <ArrowUpRight size={12} /></a>
            <a href="https://github.com/al3ksh/BreadMusic" target="_blank" rel="noreferrer">Source <ArrowUpRight size={12} /></a>
          </nav>
          <div className={styles.navActions}><a className={styles.dashboardLink} href={preview ? 'https://breadmusic.aleksh.xyz/dashboard' : '/dashboard'} target={preview ? '_blank' : undefined} rel={preview ? 'noreferrer' : undefined}>Dashboard <ArrowUpRight size={14} /></a><button type="button" className={styles.navAdd} onClick={() => setModal('invite')}><Plus size={16} /><span>Add to Discord</span></button><button type="button" className={styles.mobileMenu} aria-label="Toggle navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={22} /> : <Menu size={22} />}</button></div>
        </div>
      </header>

      <section className={styles.hero} id="main-content">
        <div className={styles.heroText}>
          <h1>Bread<span className={styles.heroBars} aria-hidden="true"><i /><i /><i /><i /></span></h1>
          <p>Music for your Discord.</p>
          <span className={styles.heroDescription}>A shared player, live lyrics and a queue everyone can add to.</span>
          <div className={styles.heroActions}><button type="button" className={styles.primary} onClick={() => setModal('invite')}><Plus size={18} />Add to Discord</button><a className={styles.secondary} href="#playground">Try Bread <ArrowDown size={16} /></a></div>
        </div>
        <picture><source media="(max-width: 620px) and (max-height: 680px)" srcSet={asset('activity-compact.png')} /><source media="(max-width: 620px)" srcSet={asset('activity-mobile.png')} /><img className={styles.heroScreen} src={asset('activity-hero.png')} alt="Bread Activity playing Instant Crush with artwork and playback status" fetchPriority="high" /></picture>
        <button type="button" className={styles.heroCaption} onClick={() => { setView(0); setModal('screen'); }}><Headphones size={15} /> Bread Activity <span>Inside your voice channel</span><Expand size={14} /></button>
      </section>

      <div className={styles.sourceBand}><span>Bring your music.</span><div><b>YouTube</b><b>Spotify</b><b>SoundCloud</b><b>Local audio</b></div><span>Keep your people.</span></div>

      <section id="inside-bread" className={`${styles.section} ${styles.productSection}`}>
        <div className={styles.sectionTop}><h2>Activity and dashboard.</h2><p>Your voice channel or your browser.<br />The same music and shared queue.</p></div>
        <div className={styles.showcaseToolbar}>
          <div role="tablist" aria-label="Explore Bread" className={styles.tabs}>{views.map((item, index) => <button type="button" key={item.id} role="tab" id={`tab-${item.id}`} aria-controls="product-panel" aria-selected={index === view} tabIndex={index === view ? 0 : -1} onClick={() => setView(index)} onKeyDown={(event) => {
            if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : (view + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
            setView(next); document.getElementById(`tab-${views[next].id}`)?.focus();
          }}><item.icon size={16} /><span>{item.label}</span></button>)}</div>
          <span className={styles.exampleLabel}>Actual interface / sample session</span>
        </div>
        <div role="tabpanel" id="product-panel" aria-labelledby={`tab-${selected.id}`} className={styles.showcase}>
          <button type="button" className={styles.screenButton} onClick={() => setModal('screen')} aria-label={`Expand ${selected.label} screenshot`}><picture key={selected.file}><source media="(max-width: 620px)" srcSet={asset(selected.mobile)} /><img src={asset(selected.file)} alt={`Bread ${selected.label}: ${selected.description}`} loading="lazy" /></picture><span className={styles.expand}><Expand size={18} /></span></button>
          <div className={styles.screenCaption}><h3>{selected.title}</h3><p>{selected.description}</p></div>
        </div>
        <div className={styles.featureNotes}>
          <div><Radio size={20} /><h3>Autoplay with optional AI.</h3><p>Keep listening when the queue ends, with recommendations shaped by the tracks your room adds.</p></div>
          <div><AudioLines size={20} /><h3>Live lyrics and audio filters.</h3><p>Follow synced lyrics in karaoke view, adjust the volume or change the sound with filters.</p></div>
          <div><ShieldCheck size={20} /><h3>You choose who controls it.</h3><p>Set DJ roles, vote skip and volume limits separately for each server.</p></div>
        </div>
      </section>

      <section className={styles.playgroundBand} id="playground"><div className={styles.section}>
        <div className={styles.sectionTop}><h2>Try Bread.</h2><p>Slash commands or Activity.<br />{liveSearch ? 'Real search. Your own demo queue.' : 'Sample tracks. Your own demo queue.'}</p></div>
        <CommandDemo />
      </div></section>

      <section className={`${styles.section} ${styles.arcade}`} id="arcade">
        <ArcadeCarousel />
        <div className={styles.arcadeCopy}><h2>Bread Arcade</h2><p>Blackjack, slots, roulette and head-to-head RPS. Play with your server&apos;s Bread balance, or without a bet.</p><a href="#playground" className={styles.textLink}>Try /slots <ArrowUpRight size={17} /></a><div className={styles.gameNames}><span>Blackjack</span><span>Slots</span><span>Roulette</span><span>Coinflip</span><span>RPS</span></div></div>
      </section>

      <section className={`${styles.section} ${styles.faq}`} id="questions"><h2>Questions &amp; answers.</h2><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={18} /></summary><p>{question === 'Is this a live connection to my server?' ? `${liveSearch ? 'Search returns real YouTube and SoundCloud metadata.' : 'The demo uses a small sample catalogue.'} The player is silent and its queue stays in this browser tab. It does not connect to Discord or change any server. Screenshots and Arcade rounds use sample data.` : answer}</p></details>)}</div></section>

      <section className={styles.closing}><img src="/assets/breadicon.png" alt="" width={64} height={64} loading="lazy" /><h2>Bring Bread to your server.</h2><div><button type="button" className={styles.primary} onClick={() => setModal('invite')}><Plus size={18} />Add to Discord</button><a className={styles.textLink} href="https://github.com/al3ksh/BreadMusic" target="_blank" rel="noreferrer"><Github size={17} />Explore the source <ArrowUpRight size={14} /></a></div></section>

      <footer className={styles.footer}><div className={styles.brand}><img src="/assets/breadicon.png" alt="" width={26} height={26} /><span>Bread</span></div><span>Made by <a href="https://aleksh.xyz" target="_blank" rel="noreferrer">aleksh</a></span><nav aria-label="Footer"><a href="https://github.com/al3ksh/BreadMusic/blob/main/LICENSE">AGPL-3.0</a><a href="/privacy">Privacy</a><a href="/cookies">Cookies</a><a href="/terms">Terms</a></nav>{preview && <span className={styles.previewStamp}><Monitor size={13} /> Local preview</span>}</footer>

      <AddToDiscordModal open={modal === 'invite'} onClose={() => setModal(null)} />
      <dialog ref={dialogRef} className={styles.screenDialog} aria-label={`${selected.label} screenshot`} onCancel={() => setModal(null)} onClick={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <div className={styles.dialogHead}><strong>{`Bread / ${selected.label}`}</strong><button type="button" aria-label="Close dialog" title="Close" onClick={() => setModal(null)}><X size={22} /></button></div>
        <picture><source media="(max-width: 620px)" srcSet={asset(selected.mobile)} /><img src={asset(selected.file)} alt={`Full ${selected.label} screenshot with sample data`} /></picture>
      </dialog>
    </main>
  );
}
