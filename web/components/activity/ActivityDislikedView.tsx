import { ArrowLeft, Ban, ThumbsDown, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { ActivityArtwork } from '@/components/activity/ActivityArtwork';

export type DislikedTrack = {
  key: string;
  title: string;
  author?: string | null;
  artistKey?: string | null;
  duration?: number | null;
  artwork?: string | null;
  at: number;
};

export type BlockedArtist = { artistKey: string; author: string; tracks: number };

export type DislikeSummary = { artists: BlockedArtist[]; tracks: DislikedTrack[] };

type ActivityDislikedViewProps = {
  dislikes: DislikeSummary;
  busy: string | null;
  onBack: () => void;
  onRemove: (track: DislikedTrack) => void;
  onBlock: (artistKey: string, author: string) => void;
  onUnblock: (artist: BlockedArtist) => void;
};

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function formatDuration(duration?: number | null) {
  const totalSeconds = Math.max(0, Math.floor((duration ?? 0) / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

type ArtistGroup = { artistKey: string; author: string; tracks: DislikedTrack[] };

// Tracks arrive newest first, so each group sits where its latest dislike is.
function groupByArtist(tracks: DislikedTrack[]) {
  const groups = new Map<string, ArtistGroup>();
  for (const track of tracks) {
    const artistKey = track.artistKey || `track:${track.key}`;
    const group = groups.get(artistKey) ?? { artistKey, author: track.author || 'Unknown artist', tracks: [] };
    group.tracks.push(track);
    groups.set(artistKey, group);
  }
  return [...groups.values()];
}

// What the listener turned down for autoplay: blocked artists first, then disliked tracks by artist.
export function ActivityDislikedView({ dislikes, busy, onBack, onRemove, onBlock, onUnblock }: ActivityDislikedViewProps) {
  const blocked = new Set(dislikes.artists.map((artist) => artist.artistKey));
  const groups = groupByArtist(dislikes.tracks);
  let stagger = 0;
  const nextStagger = () => ({ '--stagger-index': Math.min(stagger++, 12) } as CSSProperties);

  return (
    <div className="activity-library-panel">
      <div className="activity-library-detail-head">
        <button type="button" className="activity-library-back" onClick={onBack} aria-label="Back to library">
          <ArrowLeft size={16} />
        </button>
        <div>
          <strong>Disliked</strong>
          <span>{plural(dislikes.tracks.length, 'track')} - {plural(dislikes.artists.length, 'blocked artist')}</span>
        </div>
      </div>
      <p className="activity-library-hint">Autoplay avoids these for you. Disliking two tracks by one artist blocks the artist.</p>

      {dislikes.artists.length === 0 && dislikes.tracks.length === 0 && (
        <div className="activity-empty">
          <ThumbsDown size={20} />
          <span>Nothing here. Tracks you dislike with the thumbs down show up here.</span>
        </div>
      )}

      {dislikes.artists.length > 0 && (
        <section className="activity-library-section" aria-label="Blocked artists">
          <h3>Blocked artists</h3>
          <div className="activity-history-list">
            {dislikes.artists.map((artist) => (
              <div className="activity-queue-row activity-history-row activity-card" key={artist.artistKey} style={nextStagger()}>
                <span className="activity-library-heart is-blocked"><Ban size={18} /></span>
                <div className="activity-queue-copy">
                  <strong>{artist.author}</strong>
                  <span>{artist.tracks ? `${plural(artist.tracks, 'disliked track')}` : 'Blocked'}</span>
                </div>
                <span />
                <div className="activity-history-actions">
                  <button
                    type="button"
                    className="is-text"
                    disabled={Boolean(busy)}
                    onClick={() => onUnblock(artist)}
                    aria-label={`Unblock ${artist.author}`}
                    title="Unblock and forget its disliked tracks"
                  >
                    Unblock
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.length > 0 && (
        <section className="activity-library-section" aria-label="Disliked tracks">
          <h3>Disliked tracks</h3>
          {groups.map((group) => (
            <div className="activity-library-group" key={group.artistKey}>
              <div className="activity-library-group-head">
                <strong>{group.author}</strong>
                {blocked.has(group.artistKey) ? (
                  <span className="activity-history-badge">BLOCKED</span>
                ) : group.artistKey.startsWith('track:') ? null : (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => onBlock(group.artistKey, group.author)}
                    aria-label={`Block ${group.author}`}
                    title="Block this artist for your autoplay"
                  >
                    <Ban size={13} /> Block artist
                  </button>
                )}
              </div>
              <div className="activity-history-list">
                {group.tracks.map((track) => (
                  <div className="activity-queue-row activity-history-row activity-card" key={track.key} style={nextStagger()}>
                    <ActivityArtwork src={track.artwork} />
                    <div className="activity-queue-copy">
                      <strong>{track.title}</strong>
                      <span>{track.author}</span>
                    </div>
                    <time>{formatDuration(track.duration)}</time>
                    <div className="activity-history-actions">
                      <button type="button" disabled={Boolean(busy)} onClick={() => onRemove(track)} aria-label={`Undo dislike of ${track.title}`} title="Undo dislike">
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
