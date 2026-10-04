import { ArrowLeft, Download, Heart, ListMusic, ListPlus, Play, Plus, Shuffle, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { ActivityArtwork, ActivitySpinner } from '@/components/activity/ActivityArtwork';

export type LibraryEntry = {
  key: string;
  title: string;
  author: string;
  uri?: string | null;
  duration: number;
  artwork?: string | null;
  source?: string | null;
  addedAt?: number;
};

export type LibraryPlaylistSummary = {
  id: string;
  name: string;
  trackCount: number;
  duration: number;
  artwork?: string | null;
  updatedAt?: number;
};

export type LibrarySnapshot = {
  liked: LibraryEntry[];
  playlists: LibraryPlaylistSummary[];
  limits?: { liked: number; playlists: number; tracks: number; name: number };
};

type LibraryPlaylist = { id: string; name: string; tracks: LibraryEntry[] };

type LibraryRequest = <T>(path: string, body?: Record<string, unknown>) => Promise<T>;

type ActivityLibraryPanelProps = {
  canQueue: boolean;
  hasTrack: boolean;
  refreshKey: number;
  request: LibraryRequest;
  onPlay: (playlistId: string, shuffle: boolean) => Promise<boolean>;
  notify: (message: string, tone: 'success' | 'error' | 'info') => void;
};

const LIKED_ID = 'liked';

function formatDuration(duration: number) {
  const totalSeconds = Math.max(0, Math.floor(duration / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

// Per-user Liked list and playlists. Everything is the signed-in listener's own,
// so it works on any server where they can queue music.
export function ActivityLibraryPanel({ canQueue, hasTrack, refreshKey, request, onPlay, notify }: ActivityLibraryPanelProps) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LibraryPlaylist | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      setSnapshot(await request<LibrarySnapshot>(''));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, 'Your library is unavailable.'));
    }
  }, [request]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  useEffect(() => {
    setConfirmDelete(false);
    if (!openId || openId === LIKED_ID) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    request<LibraryPlaylist>(`/playlists/${encodeURIComponent(openId)}`)
      .then((playlist) => { if (!cancelled) setDetail(playlist); })
      .catch((cause) => {
        if (cancelled) return;
        notify(errorMessage(cause, 'Playlist not found.'), 'error');
        setOpenId(null);
      });
    return () => { cancelled = true; };
  }, [notify, openId, request]);

  const run = useCallback(async (key: string, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await task();
    } catch (cause) {
      notify(errorMessage(cause, 'Library action failed'), 'error');
    } finally {
      setBusy(null);
    }
  }, [busy, notify]);

  const play = (playlistId: string, shuffle: boolean) => run(`play:${playlistId}:${shuffle}`, async () => {
    await onPlay(playlistId, shuffle);
  });

  const addCurrent = (playlist: LibraryPlaylistSummary) => run(`add:${playlist.id}`, async () => {
    const result = await request<{ added: number }>(`/playlists/${encodeURIComponent(playlist.id)}/add`, { from: 'current' });
    notify(result.added ? `Added to ${playlist.name}` : `Already in ${playlist.name}`, result.added ? 'success' : 'info');
    await load();
  });

  const createFromQueue = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    void run('create', async () => {
      const result = await request<{ playlist: LibraryPlaylistSummary; added: number }>('/playlists', { name, from: hasTrack ? 'queue' : 'empty' });
      notify(`Saved ${plural(result.added, 'track')} to ${result.playlist.name}`, 'success');
      setNewName('');
      await load();
    });
  };

  const importLink = (event: FormEvent) => {
    event.preventDefault();
    const url = importUrl.trim();
    if (!url) return;
    void run('import', async () => {
      const result = await request<{ playlist: LibraryPlaylistSummary; added: number }>('/import', { url });
      notify(`Imported ${plural(result.added, 'track')} as ${result.playlist.name}`, 'success');
      setImportUrl('');
      await load();
    });
  };

  const removeTrack = (entry: LibraryEntry, index: number) => run(`remove:${entry.key}:${index}`, async () => {
    if (openId === LIKED_ID) {
      setSnapshot(await request<LibrarySnapshot>('/liked/remove', { key: entry.key }));
      return;
    }
    if (!detail) return;
    const result = await request<{ playlist: LibraryPlaylist }>(`/playlists/${encodeURIComponent(detail.id)}/remove`, { index });
    setDetail(result.playlist);
    await load();
  });

  const deleteOpen = () => run('delete', async () => {
    if (!detail) return;
    await request(`/playlists/${encodeURIComponent(detail.id)}/delete`, {});
    notify(`Deleted ${detail.name}`, 'success');
    setOpenId(null);
    await load();
  });

  if (!snapshot) {
    return error
      ? <div className="activity-empty"><ListMusic size={20} /><span>{error}</span></div>
      : <div className="activity-empty"><ActivitySpinner /> Loading your library</div>;
  }

  if (openId) {
    const isLiked = openId === LIKED_ID;
    const name = isLiked ? 'Liked' : detail?.name ?? '';
    const tracks = isLiked ? snapshot.liked : detail?.tracks ?? [];
    const loading = !isLiked && !detail;
    return (
      <div className="activity-library-panel">
        <div className="activity-library-detail-head">
          <button type="button" className="activity-library-back" onClick={() => setOpenId(null)} aria-label="Back to library">
            <ArrowLeft size={16} />
          </button>
          <div>
            <strong>{name}</strong>
            <span>{plural(tracks.length, 'track')}</span>
          </div>
          <div className="activity-history-actions">
            <button type="button" disabled={!canQueue || tracks.length === 0 || Boolean(busy)} onClick={() => play(openId, false)} aria-label={`Play ${name}`} title="Play">
              <Play size={15} />
            </button>
            <button type="button" disabled={!canQueue || tracks.length === 0 || Boolean(busy)} onClick={() => play(openId, true)} aria-label={`Shuffle ${name}`} title="Shuffle">
              <Shuffle size={15} />
            </button>
            {!isLiked && (
              <button
                type="button"
                className={confirmDelete ? 'is-danger' : ''}
                disabled={loading || Boolean(busy)}
                onClick={() => (confirmDelete ? deleteOpen() : setConfirmDelete(true))}
                aria-label={confirmDelete ? `Confirm deleting ${name}` : `Delete ${name}`}
                title={confirmDelete ? 'Click again to delete' : 'Delete playlist'}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
        {loading ? (
          <div className="activity-empty"><ActivitySpinner /> Loading playlist</div>
        ) : tracks.length === 0 ? (
          <div className="activity-empty">
            {isLiked ? <Heart size={20} /> : <ListMusic size={20} />}
            <span>{isLiked ? 'Like a track with the heart on the player to keep it here' : 'This playlist is empty'}</span>
          </div>
        ) : (
          <div className="activity-history-list">
            {tracks.map((entry, index) => (
              <div className="activity-queue-row activity-history-row activity-card" key={`${entry.key}-${index}`} style={{ '--stagger-index': Math.min(index, 12) } as CSSProperties}>
                <ActivityArtwork src={entry.artwork} />
                <div className="activity-queue-copy">
                  <strong>{entry.title}</strong>
                  <span>{entry.author}</span>
                </div>
                <time>{formatDuration(entry.duration)}</time>
                <div className="activity-history-actions">
                  <button type="button" disabled={Boolean(busy)} onClick={() => removeTrack(entry, index)} aria-label={`Remove ${entry.title}`} title="Remove">
                    <X size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const likedArtwork = snapshot.liked[0]?.artwork ?? null;
  return (
    <div className="activity-library-panel">
      <form className="activity-search-box activity-library-form" onSubmit={importLink}>
        <Download size={17} />
        <input
          value={importUrl}
          onChange={(event) => setImportUrl(event.target.value)}
          placeholder="Import a Spotify, YouTube or SoundCloud link"
          aria-label="Playlist link to import"
          maxLength={500}
        />
        <button type="submit" disabled={!importUrl.trim() || Boolean(busy)}>
          {busy === 'import' ? <ActivitySpinner /> : 'Import'}
        </button>
      </form>

      <form className="activity-search-box activity-library-form" onSubmit={createFromQueue}>
        <Plus size={17} />
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder={hasTrack ? 'Save the queue as a playlist' : 'New playlist name'}
          aria-label="New playlist name"
          maxLength={snapshot.limits?.name ?? 60}
        />
        <button type="submit" disabled={!newName.trim() || Boolean(busy)}>
          {busy === 'create' ? <ActivitySpinner /> : hasTrack ? 'Save queue' : 'Create'}
        </button>
      </form>

      <div className="activity-history-list">
        <div className="activity-library-row activity-library-liked activity-card" style={{ '--stagger-index': 0 } as CSSProperties}>
          <button type="button" className="activity-library-open" onClick={() => setOpenId(LIKED_ID)} aria-label="Open Liked">
            {likedArtwork ? <ActivityArtwork src={likedArtwork} /> : <span className="activity-library-heart"><Heart size={18} /></span>}
            <span className="activity-queue-copy">
              <strong>Liked</strong>
              <span>{plural(snapshot.liked.length, 'track')}</span>
            </span>
          </button>
          <div className="activity-history-actions">
            <button type="button" disabled={!canQueue || snapshot.liked.length === 0 || Boolean(busy)} onClick={() => play(LIKED_ID, false)} aria-label="Play Liked" title="Play">
              <Play size={15} />
            </button>
            <button type="button" disabled={!canQueue || snapshot.liked.length === 0 || Boolean(busy)} onClick={() => play(LIKED_ID, true)} aria-label="Shuffle Liked" title="Shuffle">
              <Shuffle size={15} />
            </button>
          </div>
        </div>

        {snapshot.playlists.map((playlist, index) => (
          <div className="activity-library-row activity-card" key={playlist.id} style={{ '--stagger-index': Math.min(index + 1, 12) } as CSSProperties}>
            <button type="button" className="activity-library-open" onClick={() => setOpenId(playlist.id)} aria-label={`Open ${playlist.name}`}>
              <ActivityArtwork src={playlist.artwork} />
              <span className="activity-queue-copy">
                <strong>{playlist.name}</strong>
                <span>{plural(playlist.trackCount, 'track')} - {formatDuration(playlist.duration)}</span>
              </span>
            </button>
            <div className="activity-history-actions">
              <button type="button" disabled={!hasTrack || Boolean(busy)} onClick={() => addCurrent(playlist)} aria-label={`Add the current track to ${playlist.name}`} title="Add the current track">
                <ListPlus size={15} />
              </button>
              <button type="button" disabled={!canQueue || playlist.trackCount === 0 || Boolean(busy)} onClick={() => play(playlist.id, false)} aria-label={`Play ${playlist.name}`} title="Play">
                <Play size={15} />
              </button>
              <button type="button" disabled={!canQueue || playlist.trackCount === 0 || Boolean(busy)} onClick={() => play(playlist.id, true)} aria-label={`Shuffle ${playlist.name}`} title="Shuffle">
                <Shuffle size={15} />
              </button>
            </div>
          </div>
        ))}

        {snapshot.playlists.length === 0 && (
          <p className="activity-library-hint">No playlists yet. Save the queue or import a link above.</p>
        )}
      </div>
    </div>
  );
}
