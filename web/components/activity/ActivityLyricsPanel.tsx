import { AudioLines, BookOpenText, Mic2 } from 'lucide-react';
import type { RefObject } from 'react';
import { ActivitySpinner } from '@/components/activity/ActivityArtwork';

type SyncedLine = { time: number; text: string };

type ActivityLyricsPanelProps = {
  lyricsSyncEnabled: boolean;
  karaokeEnabled: boolean;
  lyricsLoading: boolean;
  syncedLyrics: SyncedLine[];
  lyricsError: string | null;
  plainLyrics: string | null | undefined;
  activeLyricIndex: number;
  lyricsListRef: RefObject<HTMLDivElement | null>;
  activeLyricRef: RefObject<HTMLParagraphElement | null>;
  onToggleSync: () => void;
  onToggleKaraoke: () => void;
  loadLyrics: () => void | Promise<unknown>;
};

export function ActivityLyricsPanel({
  lyricsSyncEnabled,
  karaokeEnabled,
  lyricsLoading,
  syncedLyrics,
  lyricsError,
  plainLyrics,
  activeLyricIndex,
  lyricsListRef,
  activeLyricRef,
  onToggleSync,
  onToggleKaraoke,
  loadLyrics,
}: ActivityLyricsPanelProps) {
  return (
    <div className="activity-lyrics-panel">
      <div className="activity-lyrics-actions">
        <button type="button" className={`activity-lyrics-refresh ${lyricsSyncEnabled ? 'active' : ''}`} onClick={onToggleSync} disabled={lyricsLoading || syncedLyrics.length === 0}>
          <AudioLines size={15} /> {lyricsSyncEnabled ? 'Live sync on' : 'Live sync'}
        </button>
        <button type="button" className={`activity-lyrics-refresh ${karaokeEnabled ? 'active' : ''}`} onClick={onToggleKaraoke} disabled={lyricsLoading || syncedLyrics.length === 0}>
          <Mic2 size={15} /> {karaokeEnabled ? 'Karaoke on' : 'Karaoke'}
        </button>
        <button type="button" className="activity-lyrics-refresh" onClick={loadLyrics} disabled={lyricsLoading}>{lyricsLoading ? <ActivitySpinner /> : 'Refresh'}</button>
      </div>
      {lyricsLoading ? (
        <div className="activity-empty"><ActivitySpinner /><span>Loading lyrics</span></div>
      ) : lyricsError ? (
        <div className="activity-lyrics-error"><span><BookOpenText size={20} /></span><strong>Lyrics unavailable</strong><p>{lyricsError}</p></div>
      ) : lyricsSyncEnabled && syncedLyrics.length ? (
        <div className="activity-lyrics-list" ref={lyricsListRef} aria-live="polite">
          {syncedLyrics.map((line, index) => <p key={`${line.time}-${index}`} ref={index === activeLyricIndex ? activeLyricRef : null} className={index === activeLyricIndex ? 'active' : ''}>{line.text}</p>)}
        </div>
      ) : (
        <div className="activity-lyrics-plain">{plainLyrics || syncedLyrics.map((line) => line.text).join('\n') || 'No lyrics available for this track.'}</div>
      )}
    </div>
  );
}
