import { useCallback, useEffect, useState } from 'react';
import { History, Play, Plus, SquarePlus } from 'lucide-react';
import type { HistoryPage } from '@/lib/api';
import { ActivityArtwork, ActivitySpinner } from '@/components/activity/ActivityArtwork';

type ActivityHistoryPanelProps = {
  canDj: boolean;
  actionBusy: string | null;
  fetchHistoryPage: (page: number) => Promise<HistoryPage>;
  onRequeue: (uri: string) => void | Promise<unknown>;
  onPlayNow: (uri: string) => void | Promise<unknown>;
};

function isReplayable(uri: string | undefined) {
  return typeof uri === 'string' && /^https?:\/\//i.test(uri);
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
  actionBusy,
  fetchHistoryPage,
  onRequeue,
  onPlayNow,
}: ActivityHistoryPanelProps) {
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUri, setBusyUri] = useState<string | null>(null);

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

  const replay = useCallback(async (uri: string, mode: 'queue' | 'now') => {
    if (busyUri || actionBusy) return;
    setBusyUri(uri);
    try {
      await (mode === 'now' ? onPlayNow(uri) : onRequeue(uri));
    } finally {
      setBusyUri(null);
    }
  }, [actionBusy, busyUri, onPlayNow, onRequeue]);

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
      {history.items.map((entry) => {
        const replayable = isReplayable(entry.track.uri);
        const busy = busyUri === entry.track.uri || Boolean(actionBusy);
        return (
          <div className="activity-queue-row activity-history-row" key={entry.id}>
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
              {canDj && replayable && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => replay(entry.track.uri, 'queue')}
                    aria-label={`Add ${entry.track.title} to queue`}
                    title="Add to queue"
                  >
                    <SquarePlus size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => replay(entry.track.uri, 'now')}
                    aria-label={`Play ${entry.track.title} now`}
                    title="Play now"
                  >
                    <Play size={15} />
                  </button>
                </>
              )}
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
