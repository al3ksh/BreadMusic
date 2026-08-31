'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { ActivityPlayerControls } from '@/components/activity/ActivityPlayerControls';
import { ActivityQueuePanel } from '@/components/activity/ActivityQueuePanel';
import { ActivitySearchPanel } from '@/components/activity/ActivitySearchPanel';
import { ActivityPanelNav } from '@/components/activity/ActivityPanelNav';
import { ActivityHistoryPanel } from '@/components/activity/ActivityHistoryPanel';
import { ActivityLyricsPanel } from '@/components/activity/ActivityLyricsPanel';
import { ActivityArtwork, ActivitySpinner } from '@/components/activity/ActivityArtwork';
import type { HistoryPage, PlayerStatus, QueueTrack } from '@/lib/api';
import { artwork, type DemoTrack } from './demo';
import { duration, time, type DemoAction, type DemoState } from './demo-state';
import { usePreviewSearch, type SearchResult } from './usePreviewSearch';
import { usePreviewLyrics } from './usePreviewLyrics';

const asQueueTrack = (track: DemoTrack): QueueTrack => ({ title: track.title, author: track.artist, uri: track.uri || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.artist} ${track.title}`)}`, duration: duration(track) * 1000, artwork: artwork(track), requester: 'You', seekable: track.seekable !== false, source: track.source || 'youtube' });
type Panel = 'queue' | 'search' | 'lyrics' | null;

export function ActivityDemo({ state, dispatch, lyricsRequest = 0 }: { state: DemoState; dispatch: Dispatch<DemoAction>; reset: () => void; lyricsRequest?: number }) {
  const root = useRef<HTMLElement | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [queueView, setQueueView] = useState<'queue' | 'history'>('queue');
  const [query, setQuery] = useState('');
  const [completed, setCompleted] = useState('');
  const [result, setResult] = useState<SearchResult>({ tracks: [], playlist: null });
  const { search, searching, error, cancel } = usePreviewSearch();
  const [notice, setNotice] = useState('');
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [seekPreview, setSeekPreview] = useState<{ position: number; labelPercent: number; arrowOffset: number } | null>(null);
  const volumeControlRef = useRef<HTMLDivElement | null>(null);
  const volumeCommitTimerRef = useRef<number | null>(null);
  const volumeDraggingRef = useRef(false);
  const volumePendingRef = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(20);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const scrollSpeed = useRef(0);
  const gestureStart = useRef<number | null>(null);
  const [drawerY, setDrawerY] = useState<number | null>(null);
  const stopScroll = useCallback(() => { if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current); scrollFrame.current = null; scrollSpeed.current = 0; }, []);
  const closePanel = useCallback(() => { stopScroll(); setClosing(true); if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => { setPanel(null); setClosing(false); setDrawerY(null); }, 220); }, [stopScroll]);
  const togglePanel = (next: Exclude<Panel, null>) => { setVolumeOpen(false); if (panel === next) closePanel(); else { if (closeTimer.current) clearTimeout(closeTimer.current); setClosing(false); setDrawerY(null); setPanel(next); } };

  const [sync, setSync] = useState(false);
  const [karaoke, setKaraoke] = useState(false);
  const lyricsListRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLParagraphElement | null>(null);
  const { lyrics, loading: lyricsLoading, error: lyricsError, load: loadLyrics } = usePreviewLyrics(state.current, panel === 'lyrics' || karaoke);
  const lines = lyrics?.lines || [];
  const position = seekDraft ?? state.position;
  const activeLyricIndex = lines.reduce((active, line, index) => line.time <= position * 1000 ? index : active, -1);
  useEffect(() => { if (lyricsRequest) { setPanel('lyrics'); setClosing(false); } }, [lyricsRequest]);

  useEffect(() => () => { stopScroll(); if (closeTimer.current) clearTimeout(closeTimer.current); if (volumeCommitTimerRef.current) clearTimeout(volumeCommitTimerRef.current); }, [stopScroll]);
  useEffect(() => { setSeekDraft(null); setSeekPreview(null); }, [state.current]);
  useEffect(() => { if (dragIndex === null || panel !== 'queue') stopScroll(); }, [dragIndex, panel, stopScroll]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const document = root.current?.ownerDocument;
    if (!document) return;
    const outside = (event: Event) => { if (!volumeControlRef.current?.contains(event.target as Node)) setVolumeOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setVolumeOpen(false); if (panel) closePanel(); else setKaraoke(false); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', escape); };
  }, [panel, closePanel]);
  useEffect(() => {
    const container = lyricsListRef.current, line = activeLyricRef.current;
    if (!sync || panel !== 'lyrics' || !container || !line) return;
    container.scrollTo({ top: Math.max(0, line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2), behavior: root.current?.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [sync, panel, activeLyricIndex]);

  const hasTrack = !!state.current;
  const currentDuration = state.current ? duration(state.current) : 0;
  const canSeek = hasTrack && state.current?.seekable !== false && currentDuration > 0;
  const percent = currentDuration ? Math.min(100, position / currentDuration * 100) : 0;
  const command = (value: string) => dispatch({ type: 'command', value, random: Math.random() });
  const control = (action: string) => {
    if (action === 'autoplay') return;
    if (action === 'toggle') command(state.paused ? '/resume' : '/pause');
    else if (action === 'loop') command(`/loop ${state.loop === 'off' ? 'track' : state.loop === 'track' ? 'queue' : 'off'}`);
    else command(`/${action}`);
  };
  const status: PlayerStatus = { connected: hasTrack, playing: hasTrack && !state.paused, paused: state.paused, voiceChannelId: 'preview', voiceChannelName: 'listening room', currentTrack: state.current ? { ...asQueueTrack(state.current), position: state.position * 1000, seekable: state.current.seekable !== false } : null, queueLength: state.queue.length, repeatMode: state.loop, volume: state.volume, filters: null, autoplay: false, voteSkip: null, sessionHistory: state.previous.map(asQueueTrack) };
  const commitSeek = (value: number) => { if (canSeek) dispatch({ type: 'seek', position: value }); setSeekDraft(null); };
  const playResult = (tracks: DemoTrack[], mode: 'now' | 'queue' = 'queue') => {
    if (state.queue.length + tracks.length > 50) { setNotice('Preview queue is full (50 tracks).'); return; }
    dispatch({ type: 'resolved', tracks, mode }); setNotice(mode === 'now' || !hasTrack ? 'Playback started.' : `${tracks.length === 1 ? tracks[0].title : `${tracks.length} tracks`} added to queue.`);
  };
  const submitSearch = async () => { const value = query.trim(); if (!value || searching) return; setResult({ tracks: [], playlist: null }); setCompleted(''); const found = await search(value); if (found) { setResult(found); setCompleted(value); } };
  const history = useMemo(() => [...state.previous].reverse().map((track, index) => ({ id: String(index), playedAt: Date.now() - (index + 1) * 60000, autoplay: false, track: { ...asQueueTrack(track), artwork: artwork(track), source: track.source || 'youtube' }, requester: { userId: 'preview', username: 'You', displayName: 'You', avatar: null } })), [state.previous]);
  const fetchHistory = useCallback(async (page: number): Promise<HistoryPage> => ({ items: history.slice(page * 20, page * 20 + 20), total: history.length, page, limit: 20, totalPages: Math.max(1, Math.ceil(history.length / 20)) }), [history]);
  const replay = (uri: string, mode: 'now' | 'queue') => { const track = state.previous.find(item => asQueueTrack(item).uri === uri); if (track) playResult([track], mode); };
  const loopLabel = state.loop === 'track' ? 'Loop track' : 'Loop queue';
  const renderControls = () => <ActivityPlayerControls iconOnly autoplayDisabled status={status} queueTotal={state.queue.length} canDj hasTrack={hasTrack} actionBusy={null} controlFeedback={null} loopActive={state.loop !== 'off'} runControlAction={control} playerAction={control} volumeOpen={volumeOpen} setVolumeOpen={setVolumeOpen} volumeControlRef={volumeControlRef} displayedVolume={volumeDraft ?? state.volume} volumeLimit={100} volumeCommitTimerRef={volumeCommitTimerRef} volumeDraggingRef={volumeDraggingRef} volumePendingRef={volumePendingRef} volumeDraft={volumeDraft} setVolumeDraft={setVolumeDraft} commitVolume={value => { command(`/volume ${value}`); volumeDraggingRef.current = false; volumePendingRef.current = null; setVolumeDraft(null); }} />;
  const renderSeek = (variant = 'player') => !hasTrack ? null : <div className={`activity-seek-group activity-seek-group-${variant}`}>
    <div className="activity-seek" onPointerMove={event => {
      if (!canSeek) return; const rect = event.currentTarget.getBoundingClientRect();
      const pointer = Math.max(0, Math.min(rect.width, event.clientX - rect.left)); const half = Math.min(24, rect.width / 2); const label = Math.max(half, Math.min(rect.width - half, pointer));
      setSeekPreview({ position: rect.width ? pointer / rect.width * currentDuration : 0, labelPercent: rect.width ? label / rect.width * 100 : 0, arrowOffset: pointer - label });
    }} onPointerLeave={() => setSeekPreview(null)}>
      {seekPreview && canSeek && <output className="activity-seek-preview" style={{ '--seek-preview-label': `${seekPreview.labelPercent}%`, '--seek-preview-arrow-offset': `${seekPreview.arrowOffset}px` } as CSSProperties}>{time(seekPreview.position)}</output>}
      <input className="activity-range" type="range" min={0} max={currentDuration * 1000 || 1} value={Math.min(position * 1000, currentDuration * 1000 || 1)} disabled={!canSeek} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setSeekDraft(Number(event.currentTarget.value) / 1000); }} onChange={event => setSeekDraft(Number(event.target.value) / 1000)} onPointerUp={event => commitSeek(Number(event.currentTarget.value) / 1000)} onPointerCancel={() => setSeekDraft(null)} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commitSeek(Number(event.currentTarget.value) / 1000); }} onBlur={event => { if (seekDraft !== null) commitSeek(Number(event.currentTarget.value) / 1000); }} style={{ '--range-progress': `${percent}%` } as CSSProperties} aria-label={canSeek ? 'Track position' : 'Track position (not seekable)'} aria-valuetext={`${time(position)} of ${time(currentDuration)}`} />
    </div><div className="activity-time-row"><span>{time(position)}</span><span>{time(currentDuration)}</span></div>
  </div>;
  const trackTitle = status.currentTrack?.title || 'Nothing is playing';
  const titleLink = status.currentTrack?.uri;

  return <main ref={root} className="activity-shell activity-workspace-shell" data-testid="activity-demo">
    <header className="activity-header"><button type="button" className="activity-brand" onClick={() => window.open('https://breadmusic.aleksh.xyz', '_blank', 'noopener,noreferrer')} aria-label="Open Bread website"><img src="/assets/breadicon.png?v=3" alt="" /><div><strong>Bread</strong><span>Music Activity</span></div></button><div className="activity-context"><span className="activity-live-dot" /><span>listening room</span><span className="activity-context-divider" /><span>DJ controls</span></div></header>
    {(notice || error) && <div className={`activity-notice tone-${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error ? <AlertTriangle className="activity-notice-icon" size={17} /> : <CheckCircle2 className="activity-notice-icon" size={17} />}<span>{error || notice}</span><button type="button" aria-label="Dismiss message" onClick={() => { setNotice(''); cancel(); }}><X size={16} /></button></div>}
    <div className="activity-workspace">
      {karaoke ? <section className={`activity-karaoke-stage ${state.paused ? 'is-paused' : 'is-playing'}`}>
        <div className="activity-karaoke-track"><ActivityArtwork src={status.currentTrack?.artwork} /><div><div className="activity-mini-brand"><img src="/assets/breadicon.png?v=3" alt="" /><span>{state.paused ? 'Paused' : 'Playing'}</span></div><strong>{trackTitle}</strong><span className="activity-karaoke-author">{status.currentTrack?.author || 'Bread'}</span></div><button type="button" onClick={() => setKaraoke(false)} title="Exit karaoke" aria-label="Exit karaoke"><X size={16} /></button></div>
        <div className="activity-karaoke-lines" aria-live="polite" aria-atomic="true">{lyricsLoading ? <div className="activity-karaoke-empty"><ActivitySpinner /> Loading lyrics</div> : lyricsError ? <div className="activity-karaoke-empty">{lyricsError}</div> : <><p key={`previous-${activeLyricIndex}`} className="is-previous">{lines[activeLyricIndex - 1]?.text || ''}</p><strong key={`current-${activeLyricIndex}`} className="is-current">{lines[activeLyricIndex]?.text || 'Instrumental'}</strong><p key={`next-${activeLyricIndex}`} className="is-next">{lines[activeLyricIndex + 1]?.text || ''}</p></>}</div>
        <div className="activity-karaoke-player">{renderSeek('karaoke')}{renderControls()}</div>
      </section> : <>
        <section className={`activity-compact-player ${state.paused ? 'is-paused' : 'is-playing'}`}><div className="activity-compact-track"><div className="activity-compact-art"><ActivityArtwork src={status.currentTrack?.artwork} />{hasTrack && <span className={`activity-playing-indicator ${state.paused ? 'paused' : ''}`} />}</div><div className="activity-compact-copy"><div className="activity-compact-brand"><img src="/assets/breadicon.png?v=3" alt="" /><span>{state.paused ? 'Paused' : 'Playing'}</span></div><h1>{titleLink ? <a href={titleLink} target="_blank" rel="noreferrer">{trackTitle}</a> : trackTitle}</h1><p>{status.currentTrack?.author || 'Bread'}</p></div></div><div className="activity-compact-progress" aria-label={`${time(position)} of ${time(currentDuration)}`}><span><i style={{ transform: `scaleX(${percent / 100})` }} /></span></div><div className="activity-compact-badges" aria-label="Playback status"><span className={hasTrack && state.paused ? 'paused' : ''}>{hasTrack ? state.paused ? 'Paused' : 'Now playing' : 'Player offline'}</span><span>Autoplay off</span><span className={state.loop !== 'off' ? 'active' : ''}>{state.loop === 'off' ? 'Loop off' : loopLabel}</span></div></section>
        <section className={`activity-player-stage ${state.paused ? 'is-paused' : 'is-playing'}`}>
          <div className="activity-track-art"><ActivityArtwork src={status.currentTrack?.artwork} large />{hasTrack && <span className={`activity-playing-indicator ${state.paused ? 'paused' : ''}`} />}</div>
          <div className="activity-player-main"><div className="activity-track-copy"><div className="activity-mini-brand"><img src="/assets/breadicon.png?v=3" alt="" /><span>{state.paused ? 'Paused' : 'Playing'}</span></div><div className="activity-playback-state"><span className={hasTrack && state.paused ? 'paused' : ''}>{hasTrack ? state.paused ? 'Paused' : 'Now playing' : 'Player offline'}</span>{state.loop !== 'off' && <span className="loop">{loopLabel}</span>}</div><h1>{titleLink ? <a href={titleLink} target="_blank" rel="noreferrer">{trackTitle}</a> : trackTitle}</h1><p>{status.currentTrack?.author || 'Open Add music to start playback.'}</p>{hasTrack && <small className="activity-track-requester">Requested by <strong>You</strong></small>}{hasTrack && <div className="activity-mini-progress" aria-hidden="true"><span><i style={{ transform: `scaleX(${percent / 100})` }} /></span><time>{time(position)} / {time(currentDuration)}</time></div>}{renderSeek()}</div>{hasTrack && renderControls()}</div>
        </section>
      </>}
      <ActivityPanelNav activePanel={panel} queueTotal={state.queue.length} canQueue hasTrack={hasTrack} togglePanel={togglePanel} />
      {panel && <><button type="button" className={`activity-drawer-backdrop ${closing ? 'is-closing' : ''}`} onClick={closePanel} aria-label="Close panel" /><aside className={`activity-drawer ${closing ? 'is-closing' : ''}${drawerY !== null ? ' is-dragging' : ''}`} aria-label={`${panel} panel`} style={drawerY === null ? undefined : { transform: `translateY(${drawerY}px)`, transition: 'none' }}>
        <div className="activity-drawer-header" onPointerDown={event => { if ((event.target as Element).closest?.('button')) return; if ((root.current?.ownerDocument.defaultView?.innerWidth || 2000) > 980) return; gestureStart.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (gestureStart.current !== null) setDrawerY(Math.max(0, event.clientY - gestureStart.current)); }} onPointerUp={() => { if ((drawerY || 0) > 80) closePanel(); else setDrawerY(null); gestureStart.current = null; }} onPointerCancel={() => { gestureStart.current = null; setDrawerY(null); }}><div><strong>{panel === 'queue' ? 'Queue' : panel === 'search' ? 'Add music' : 'Live lyrics'}</strong><span>{panel === 'queue' ? `${state.queue.length} tracks` : panel === 'search' ? 'Search or upload audio' : trackTitle}</span></div><button type="button" onClick={closePanel} aria-label="Close panel"><X size={18} /></button></div>
        <div className="activity-drawer-body" ref={scrollRef} onDragOver={event => { if (dragIndex === null) return; event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); scrollSpeed.current = event.clientY < bounds.top + 55 ? -9 : event.clientY > bounds.bottom - 55 ? 9 : 0; if (scrollFrame.current === null) { const step = () => { if (scrollRef.current) scrollRef.current.scrollTop += scrollSpeed.current; scrollFrame.current = requestAnimationFrame(step); }; scrollFrame.current = requestAnimationFrame(step); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) stopScroll(); }}>
          {panel === 'queue' && <><div className="activity-queue-switch" role="tablist" aria-label="Queue panel view">{(['queue', 'history'] as const).map(view => <button type="button" key={view} role="tab" aria-selected={queueView === view} className={queueView === view ? 'active' : ''} onClick={() => setQueueView(view)}>{view === 'queue' ? 'Queue' : 'History'}</button>)}</div>{queueView === 'history' ? <ActivityHistoryPanel canDj actionBusy={null} fetchHistoryPage={fetchHistory} onRequeue={uri => replay(uri, 'queue')} onPlayNow={uri => replay(uri, 'now')} /> : <ActivityQueuePanel queue={{ tracks: state.queue.slice(0, loaded).map(asQueueTrack), total: state.queue.length }} canDj queueRestore={null} dragIndex={dragIndex} dropIndex={dropIndex} queueLoadingMore={false} setDragIndex={setDragIndex} setDropIndex={setDropIndex} stopQueueAutoScroll={stopScroll} handleQueueDrop={index => { if (dragIndex !== null) dispatch({ type: 'move', from: dragIndex, to: index }); setDragIndex(null); setDropIndex(null); stopScroll(); }} handleQueueRemove={index => dispatch({ type: 'remove', index })} loadMoreQueue={() => setLoaded(loaded + 20)} />}</>}
          {panel === 'search' && <ActivitySearchPanel canDj canQueue uploadDisabled hasTrack={hasTrack} actionBusy={null} searchQuery={query} searching={searching} searchPlaylist={result.playlist ? { key: completed, name: result.playlist.name, trackCount: result.tracks.length, totalDuration: result.tracks.reduce((total, track) => total + duration(track) * 1000, 0), artwork: result.tracks[0] ? artwork(result.tracks[0]) : null } : null} searchResults={result.tracks.map(asQueueTrack)} searchCompletedQuery={completed} uploadFile={null} uploading={false} onQueryChange={value => { cancel(); setQuery(value); setCompleted(''); setResult({ tracks: [], playlist: null }); }} submitSearch={submitSearch} handleUploadSelection={() => {}} handleUpload={() => {}} addSearchPlaylist={() => playResult(result.tracks)} playSearchResult={(track, mode) => { const found = result.tracks.find(item => asQueueTrack(item).uri === track.uri); if (found) playResult([found], mode); }} />}
          {panel === 'lyrics' && <ActivityLyricsPanel lyricsSyncEnabled={sync} karaokeEnabled={karaoke} lyricsLoading={lyricsLoading} syncedLyrics={lines} lyricsError={lyricsError} plainLyrics={lyrics?.instrumental ? 'Instrumental' : lyrics?.plainLyrics} activeLyricIndex={activeLyricIndex} lyricsListRef={lyricsListRef} activeLyricRef={activeLyricRef} onToggleSync={() => setSync(!sync)} onToggleKaraoke={() => { setKaraoke(!karaoke); setSync(!karaoke); closePanel(); }} loadLyrics={loadLyrics} />}
        </div>
      </aside></>}
    </div>
  </main>;
}
