'use client';

import { useEffect, useState } from 'react';
import { apiFetch, type HistoryPage, formatDuration } from '@/lib/api';
import { ChevronLeft, ChevronRight, Clock3, History, ListPlus, Play } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { Spinner } from '@/components/dashboard/DashboardPrimitives';

type DashboardHistoryProps = {
  guildId: string;
  canQueue?: boolean;
  onRequeue?: (uri: string, mode: 'queue' | 'now') => void | Promise<unknown>;
};

export function DashboardHistory({ guildId, canQueue = false, onRequeue }: DashboardHistoryProps) {
  const toast = useToast();
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyUri, setBusyUri] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch<HistoryPage>(`/guilds/${guildId}/history?page=${page}&limit=30`)
      .then(setHistory)
      .catch((error) => toast.error('History unavailable', error instanceof Error ? error.message : 'Failed to load history.'))
      .finally(() => setLoading(false));
  }, [guildId, page, toast]);

  const replay = async (uri: string, mode: 'queue' | 'now') => {
    if (!onRequeue || busyUri) return;
    setBusyUri(uri);
    try {
      await onRequeue(uri, mode);
    } finally {
      setBusyUri(null);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="rounded-lg border border-border bg-bg-card overflow-hidden">
        <div className="border-b border-border bg-bg-secondary px-5 py-4">
          <h3 className="flex items-center gap-2 text-[15px] font-medium"><History size={17} /> Listening History</h3>
          <p className="mt-1 text-xs text-text-muted">{history ? `${history.total} retained plays` : 'Recent server playback'}</p>
        </div>
        <div className="divide-y divide-border/60">
          {loading && <div className="p-8 text-center text-text-muted"><Spinner /></div>}
          {!loading && history?.items.length === 0 && <div className="p-10 text-center text-sm text-text-muted">No playback history yet.</div>}
          {!loading && history?.items.map((entry) => {
            const replayable = /^https?:\/\//i.test(entry.track.uri);
            const busy = busyUri === entry.track.uri;
            return (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                {entry.track.artwork ? (
                  <img src={entry.track.artwork} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-bg-hover"><Play size={16} className="text-text-muted" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium">{entry.track.title}</p>
                    {entry.autoplay && <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">AUTO</span>}
                  </div>
                  <p className="truncate text-xs text-text-secondary">
                    {entry.track.author}{entry.requester ? `  requested by ${entry.requester.displayName}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs tabular-nums text-text-secondary">{formatDuration(entry.track.duration)}</p>
                  <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-text-muted">
                    <Clock3 size={10} />{new Date(entry.playedAt).toLocaleString()}
                  </p>
                </div>
                {canQueue && replayable && onRequeue && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => replay(entry.track.uri, 'queue')}
                      className="rounded-md border border-border p-2 text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary disabled:opacity-40"
                      aria-label={`Add ${entry.track.title} to queue`}
                      title="Add to queue"
                    >
                      <ListPlus size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => replay(entry.track.uri, 'now')}
                      className="rounded-md border border-border p-2 text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary disabled:opacity-40"
                      aria-label={`Play ${entry.track.title} now`}
                      title="Play now"
                    >
                      <Play size={16} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {history && history.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border bg-bg-secondary px-4 py-3">
            <button className="rounded-md border border-border p-2 disabled:opacity-40" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} aria-label="Previous history page"><ChevronLeft size={16} /></button>
            <span className="text-xs text-text-secondary">Page {page + 1} of {history.totalPages}</span>
            <button className="rounded-md border border-border p-2 disabled:opacity-40" disabled={page + 1 >= history.totalPages} onClick={() => setPage((value) => value + 1)} aria-label="Next history page"><ChevronRight size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
