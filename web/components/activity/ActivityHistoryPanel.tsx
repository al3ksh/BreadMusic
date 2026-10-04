import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Heart, History, ListPlus, Play, Plus, SquarePlus } from 'lucide-react';
import type { HistoryPage } from '@/lib/api';
import { ActivityArtwork, ActivitySpinner } from '@/components/activity/ActivityArtwork';
import type { LibraryPlaylistSummary, LibrarySnapshot } from '@/components/activity/ActivityLibraryPanel';

type LibraryRequest = <T>(path: string, body?: Record<string, unknown>) => Promise<T>;

type ActivityHistoryPanelProps = {
  canDj: boolean;
  canQueue: boolean;
  actionBusy: string | null;
  fetchHistoryPage: (page: number) => Promise<HistoryPage>;
  onRequeue: (uri: string) => void | Promise<unknown>;
  onPlayNow: (uri: string) => void | Promise<unknown>;
  libraryRequest: LibraryRequest;
  onLibraryChange: () => void;
  notify: (message: string, tone: 'success' | 'error' | 'info') => void;
};

function isReplayable(uri: string | undefined) {
  return typeof uri === 'string' && /^https?:\/\//i.test(uri);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ActivityHistoryPanel({
  canDj,
  canQueue,
  actionBusy,
  fetchHistoryPage,
  onRequeue,
  onPlayNow,
  libraryRequest,
  onLibraryChange,
  notify,
}: ActivityHistoryPanelProps) {
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUri, setBusyUri] = useState<string | null>(null);
  const [likedUris, setLikedUris] = useState<Set<string>>(() => new Set());
  const [menuId, setMenuId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<LibraryPlaylistSummary[] | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (page === 0) setLoading(true);
    else setLoadingMore(true);
    setError(null);

    fetchHistoryPage(page)
      .then((result) => {
        if (cancelled) return;
        setHistory((current) => {
          if (page === 0 || !current) return result;
          const seen = new Set(current.items.map((entry) => entry.id));
          return { ...result, items: [...current.items, ...result.items.filter((entry) => !seen.has(entry.id))] };
        });
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'History is unavailable.');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadingMore(false);
        }
      });

    return () => { cancelled = true; };
  }, [fetchHistoryPage, page]);

  // The playlist menu closes on an outside press or Escape.
  useEffect(() => {
    if (!menuId) return undefined;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuId(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuId(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuId]);

  const replay = useCallback(async (uri: string, mode: 'queue' | 'now') => {
    if (busyUri || actionBusy) return;
    setBusyUri(uri);
    try {
      await (mode === 'now' ? onPlayNow(uri) : onRequeue(uri));
    } finally {
      setBusyUri(null);
    }
  }, [actionBusy, busyUri, onPlayNow, onRequeue]);

  const like = useCallback(async (uri: string) => {
    if (busyUri) return;
    setBusyUri(uri);
    try {
      const result = await libraryRequest<{ title: string }>('/liked/add', { uri });
      setLikedUris((current) => new Set(current).add(uri));
      onLibraryChange();
      notify(`Liked ${result.title}`, 'success');
    } catch (cause) {
      notify(errorMessage(cause, 'Could not like this track.'), 'error');
    } finally {
      setBusyUri(null);
    }
  }, [busyUri, libraryRequest, notify, onLibraryChange]);

  const toggleMenu = useCallback(async (id: string) => {
    if (menuId === id) {
      setMenuId(null);
      return;
    }
    setMenuId(id);
    try {
      setPlaylists((await libraryRequest<LibrarySnapshot>('')).playlists);
    } catch (cause) {
      setMenuId(null);
      notify(errorMessage(cause, 'Your library is unavailable.'), 'error');
    }
  }, [libraryRequest, menuId, notify]);

  const addToPlaylist = useCallback(async (uri: string, playlist: LibraryPlaylistSummary) => {
    setMenuId(null);
    setBusyUri(uri);
    try {
      const result = await libraryRequest<{ added: number }>(`/playlists/${encodeURIComponent(playlist.id)}/add`, { from: 'uri', uri });
      onLibraryChange();
      notify(result.added ? `Added to ${playlist.name}` : `Already in ${playlist.name}`, result.added ? 'success' : 'info');
    } catch (cause) {
      notify(errorMessage(cause, 'Could not add this track.'), 'error');
    } finally {
      setBusyUri(null);
    }
  }, [libraryRequest, notify, onLibraryChange]);

  if (loading) {
    return <div className="activity-empty"><ActivitySpinner /> Loading history</div>;
  }

  if (error) {
    return <div className="activity-empty"><History size={20} /><span>{error}</span></div>;
  }

  if (!history?.items.length) {
    return <div className="activity-empty"><History size={20} /><span>No listening history yet</span></div>;
  }

  return (
    <div className="activity-history-list">
      {history.items.map((entry, index) => {
        const uri = entry.track.uri;
        const replayable = isReplayable(uri);
        const rowBusy = busyUri === uri;
        const busy = rowBusy || Boolean(actionBusy);
        const liked = likedUris.has(uri);
        const menuOpen = menuId === entry.id;
        return (
          <div
            className={`activity-queue-row activity-history-row activity-card${menuOpen ? ' has-menu' : ''}`}
            key={entry.id}
            style={{ '--stagger-index': Math.min(index, 12) } as CSSProperties}
          >
            <ActivityArtwork src={entry.track.artwork} />
            <div className="activity-queue-copy">
              <strong>
                {entry.track.title}
                {entry.autoplay && <span className="activity-history-badge">AUTO</span>}
              </strong>
              <span>
                {entry.track.author}
                {entry.requester ? ` - ${entry.requester.displayName}` : ''}
                {' - '}
                {relativeTime(entry.playedAt)}
              </span>
            </div>
            <time>{formatDuration(entry.track.duration)}</time>
            <div className="activity-history-actions">
              {replayable && (<>
                <button
                  type="button"
                  className={liked ? 'is-liked' : undefined}
                  disabled={rowBusy || liked}
                  onClick={() => like(uri)}
                  aria-label={liked ? `${entry.track.title} is liked` : `Like ${entry.track.title}`}
                  aria-pressed={liked}
                  title={liked ? 'Liked' : 'Like'}
                >
                  <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
                </button>
                <div className="activity-history-menu" ref={menuOpen ? menuRef : undefined}>
                  <button
                    type="button"
                    disabled={rowBusy}
                    onClick={() => toggleMenu(entry.id)}
                    aria-label={`Add ${entry.track.title} to a playlist`}
                    aria-expanded={menuOpen}
                    title="Add to playlist"
                  >
                    <ListPlus size={15} />
                  </button>
                  {menuOpen && (
                    <div className="activity-history-popover" role="menu" aria-label="Add to playlist">
                      {playlists === null && <span className="activity-history-popover-note"><ActivitySpinner /> Loading</span>}
                      {playlists?.length === 0 && <span className="activity-history-popover-note">No playlists yet. Create one in Library.</span>}
                      {playlists?.map((playlist) => (
                        <button type="button" role="menuitem" key={playlist.id} onClick={() => addToPlaylist(uri, playlist)}>
                          {playlist.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {(canDj || canQueue) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => replay(uri, 'queue')}
                    aria-label={`Add ${entry.track.title} to queue`}
                    title="Add to queue"
                  >
                    <SquarePlus size={15} />
                  </button>
                )}
                {canDj && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => replay(uri, 'now')}
                    aria-label={`Play ${entry.track.title} now`}
                    title="Play now"
                  >
                    <Play size={15} />
                  </button>
                )}
              </>)}
            </div>
          </div>
        );
      })}
      {history.items.length < history.total && (
        <button
          type="button"
          className="activity-queue-load-more"
          disabled={loadingMore}
          onClick={() => setPage((current) => current + 1)}
        >
          {loadingMore ? <ActivitySpinner /> : <Plus size={15} />}
          {loadingMore ? 'Loading history' : `Load more (${history.items.length}/${history.total})`}
        </button>
      )}
    </div>
  );
}

function formatDuration(duration: number) {
  const totalSeconds = Math.max(0, Math.floor(duration / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
