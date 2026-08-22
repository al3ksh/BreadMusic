'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, type LyricsResult, type PlayerStatus, formatDuration } from '@/lib/api';
import { BookOpenText, Search } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { Spinner } from '@/components/dashboard/DashboardPrimitives';

const inputClass = 'w-48 rounded-md border border-border bg-bg-input text-text-primary px-3 py-2 text-sm outline-none focus:border-accent transition-colors placeholder:text-text-muted font-[inherit]';

type SyncedLyricLine = {
  time: number;
  text: string;
};

function parseSyncedLyrics(value: string): SyncedLyricLine[] {
  const lines: SyncedLyricLine[] = [];
  const pattern = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]\s*(.*)$/;

  for (const rawLine of value.split(/\r?\n/)) {
    const match = rawLine.match(pattern);
    if (!match) continue;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0').slice(0, 3)}`) : 0;
    lines.push({
      time: (minutes * 60 + seconds + fraction) * 1000,
      text: match[4].trim() || '♪',
    });
  }

  return lines.sort((a, b) => a.time - b.time);
}

export function DashboardLyrics({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [liveMode, setLiveMode] = useState(false);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus | null>(null);
  const [livePosition, setLivePosition] = useState(0);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const lastLiveTrackRef = useRef('');
  const liveClockRef = useRef<{
    trackKey: string;
    position: number;
    duration: number;
    capturedAt: number;
    paused: boolean;
  } | null>(null);

  const loadLyrics = useCallback(async (manual: boolean, requestedArtist = artist, requestedTitle = title) => {
    setLoading(true);
    try {
      const params = manual
        ? `?artist=${encodeURIComponent(requestedArtist.trim())}&title=${encodeURIComponent(requestedTitle.trim())}`
        : '';
      const result = await apiFetch<LyricsResult>(`/guilds/${guildId}/lyrics${params}`);
      setLyrics(result);
      if (!manual) {
        setArtist(result.artist);
        setTitle(result.title);
      }
    } catch (error) {
      setLyrics(null);
      if (manual) toast.error('Lyrics unavailable', error instanceof Error ? error.message : 'Lyrics not found.');
    } finally {
      setLoading(false);
    }
  }, [artist, title, guildId, toast]);

  useEffect(() => {
    loadLyrics(false, '', '');
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!liveMode) return;
    const source = new EventSource(`/api/guilds/${guildId}/player/events?page=0`);
    const handleSnapshot = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { status?: PlayerStatus };
        if (!payload.status) return;

        const status = payload.status;
        const track = status.currentTrack;
        if (!track) {
          liveClockRef.current = null;
          setLivePosition(0);
          setPlayerStatus(status);
          return;
        }

        const now = Date.now();
        const trackKey = `${track.uri}|${track.title}|${track.author}`;
        const incomingPosition = track.position || 0;
        const previousClock = liveClockRef.current;
        let stablePosition = incomingPosition;

        if (previousClock?.trackKey === trackKey) {
          const estimatedPrevious = previousClock.position +
            (previousClock.paused ? 0 : now - previousClock.capturedAt);
          const movedBackwards = incomingPosition < estimatedPrevious - 5000;

          if (status.paused && !previousClock.paused) {
            stablePosition = Math.max(incomingPosition, estimatedPrevious);
          } else if (status.paused && previousClock.paused && !movedBackwards) {
            stablePosition = previousClock.position;
          } else if (!status.paused && !movedBackwards) {
            stablePosition = Math.max(incomingPosition, estimatedPrevious);
          }
        }

        stablePosition = Math.min(track.duration || Infinity, Math.max(0, stablePosition));
        liveClockRef.current = {
          trackKey,
          position: stablePosition,
          duration: track.duration || 0,
          capturedAt: now,
          paused: status.paused,
        };
        setLivePosition(stablePosition);
        setPlayerStatus({
          ...status,
          currentTrack: {
            ...track,
            position: stablePosition,
          },
        });
      } catch {
        // Wait for the next valid snapshot.
      }
    };
    source.addEventListener('snapshot', handleSnapshot as EventListener);
    return () => source.close();
  }, [guildId, liveMode]);

  useEffect(() => {
    if (!liveMode || !playerStatus?.currentTrack) return;
    const track = playerStatus.currentTrack;
    const trackKey = `${track.uri}|${track.title}|${track.author}`;
    if (trackKey === lastLiveTrackRef.current) return;
    lastLiveTrackRef.current = trackKey;
    loadLyrics(false, '', '');
  }, [liveMode, playerStatus?.currentTrack?.uri]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!liveMode) return;
    const updatePosition = () => {
      const clock = liveClockRef.current;
      if (!clock) return;
      const elapsed = clock.paused ? 0 : Date.now() - clock.capturedAt;
      setLivePosition(Math.min(clock.duration || Infinity, clock.position + elapsed));
    };
    updatePosition();
    const timer = setInterval(updatePosition, 250);
    return () => clearInterval(timer);
  }, [liveMode]);

  const syncedLines = React.useMemo(
    () => (lyrics?.syncedLyrics ? parseSyncedLyrics(lyrics.syncedLyrics) : []),
    [lyrics?.syncedLyrics],
  );
  const activeLineIndex = syncedLines.reduce(
    (current, line, index) => (line.time <= livePosition ? index : current),
    -1,
  );

  useEffect(() => {
    if (liveMode && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLineIndex, liveMode]);

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      <div className="rounded-lg border border-border bg-bg-card p-4">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (artist.trim() && title.trim()) loadLyrics(true);
          }}
        >
          <input className={inputClass + ' w-full'} value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Artist" />
          <input className={inputClass + ' w-full'} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Track title" />
          <button type="submit" disabled={loading || !artist.trim() || !title.trim()} className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            {loading ? <Spinner /> : <Search size={16} />} Find
          </button>
        </form>
      </div>
      <div className="rounded-lg border border-border bg-bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-border bg-bg-secondary px-5 py-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[15px] font-medium"><BookOpenText size={17} /> <span className="truncate">{lyrics?.title || 'Lyrics'}</span></h3>
            {lyrics && <p className="mt-1 truncate text-xs text-text-secondary">{lyrics.artist}{lyrics.album ? ` · ${lyrics.album}` : ''}</p>}
          </div>
          <label className={`flex shrink-0 items-center gap-2 text-xs ${syncedLines.length ? 'text-text-secondary' : 'text-text-muted'}`}>
            <span>Live</span>
            <button
              type="button"
              role="switch"
              aria-checked={liveMode}
              disabled={!syncedLines.length}
              onClick={() => setLiveMode((value) => !value)}
              className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${liveMode ? 'bg-accent' : 'bg-border'}`}
            >
              <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${liveMode ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        </div>
        <div className={`p-5 sm:p-7 ${liveMode ? 'max-h-[60vh] overflow-y-auto scroll-smooth' : ''}`}>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : lyrics?.instrumental ? (
            <p className="py-10 text-center text-sm text-text-secondary">This track is marked as instrumental.</p>
          ) : lyrics && liveMode && syncedLines.length ? (
            <div className="space-y-5 py-[24vh] text-center">
              {syncedLines.map((line, index) => (
                <p
                  key={`${line.time}-${index}`}
                  ref={index === activeLineIndex ? activeLineRef : null}
                  className={`transition-all duration-300 ${
                    index === activeLineIndex
                      ? 'text-xl font-semibold text-text-primary'
                      : index < activeLineIndex
                        ? 'text-sm text-text-muted/60'
                        : 'text-base text-text-secondary'
                  }`}
                >
                  {line.text}
                </p>
              ))}
            </div>
          ) : lyrics ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-text-primary">{lyrics.plainLyrics || lyrics.syncedLyrics}</pre>
          ) : (
            <p className="py-10 text-center text-sm text-text-muted">No lyrics found for the current track. Try a manual search.</p>
          )}
        </div>
        {lyrics && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[10px] text-text-muted">
            <span>Lyrics provided by {lyrics.provider}</span>
            {lyrics.syncedLyrics && <span>{liveMode ? formatDuration(livePosition) : 'Synced lyrics available'}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
