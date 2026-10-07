import { ChevronLeft, ChevronRight, GripVertical, ListMusic, Play, Trash2, X } from 'lucide-react';
import type { DragEvent } from 'react';
import type { AutoplayNextTrack, QueueTrack } from '@/lib/api';
import { formatDuration, formatTrackCount } from '@/lib/api';
import { EmptyState } from '@/components/dashboard/DashboardPrimitives';
import { ArtworkImage } from '@/components/ArtworkImage';
import { AutoplayUpNext } from '@/components/dashboard/DashboardAutoplay';

type DashboardQueueData = {
  current: QueueTrack | null;
  tracks: QueueTrack[];
  total: number;
  totalPages: number;
};

type DashboardQueueProps = {
  queue: DashboardQueueData;
  queuePage: number;
  canUseDJControls: boolean;
  draggedIdx: number | null;
  dropTargetIdx: number | null;
  onClear: () => void | Promise<unknown>;
  onPageChange: (page: number) => void;
  onDragStart: (event: DragEvent<HTMLElement>, index: number) => void;
  onDragOver: (event: DragEvent<HTMLElement>, index: number) => void;
  onDrop: (event: DragEvent<HTMLElement>, index: number) => void;
  onDragEnd: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void | Promise<unknown>;
  autoplayNext: AutoplayNextTrack | null;
  onAction: (action: string, body?: Record<string, unknown>) => Promise<boolean>;
};

export function DashboardQueue({
  queue,
  queuePage,
  canUseDJControls,
  draggedIdx,
  dropTargetIdx,
  onClear,
  onPageChange,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onRemove,
  autoplayNext,
  onAction,
}: DashboardQueueProps) {
  // Keys follow the track rather than its slot, so a moved row keeps its DOM node and focus.
  const seen = new Map<string, number>();
  const rowKeys = queue.tracks.map((track) => {
    const count = seen.get(track.uri) ?? 0;
    seen.set(track.uri, count + 1);
    return `${track.uri}#${count}`;
  });

  return (
    <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
      <div className="bg-bg-secondary px-5 py-3.5 border-b border-border flex items-center justify-between">
        <h3 className="text-[15px] font-medium">Queue <span className="text-text-muted font-normal ml-2 text-sm">{formatTrackCount(queue.total)}</span></h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClear} disabled={!canUseDJControls || queue.total === 0} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer text-xs">
            <Trash2 size={13} /> Clear
          </button>
          {queue.totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous queue page" onClick={() => onPageChange(Math.max(0, queuePage - 1))} disabled={queuePage === 0} className="p-1 rounded hover:bg-bg-hover disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors">
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs text-text-muted tabular-nums px-1">{queuePage + 1}/{queue.totalPages}</span>
              <button type="button" aria-label="Next queue page" onClick={() => onPageChange(Math.min(queue.totalPages - 1, queuePage + 1))} disabled={queuePage >= queue.totalPages - 1} className="p-1 rounded hover:bg-bg-hover disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-5">
        {queue.current && (
          <div className="mb-2 px-3 py-2.5 rounded-md bg-accent/10 border border-accent/20 flex items-center gap-3">
            {queue.current.artwork ? <ArtworkImage src={queue.current.artwork} className="w-8 h-8 rounded shrink-0 object-cover" /> : <Play size={14} className="text-accent shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{queue.current.title}</p>
              <p className="text-xs text-text-muted truncate">{queue.current.author}{queue.current.requester ? ` • Requested by ${queue.current.requester}` : ''}</p>
            </div>
            <span className="text-xs text-text-muted tabular-nums">{formatDuration(queue.current.duration)}</span>
          </div>
        )}

        {queue.tracks.length === 0 && !autoplayNext && (
          <EmptyState
            compact
            icon={ListMusic}
            title="Queue is empty"
            description={queue.current ? 'Tracks you add play after the current one.' : 'Search for a track or paste a link above to fill it up.'}
          />
        )}
        <ol className="space-y-0.5" aria-label="Queued tracks">
          {queue.tracks.map((track, index) => (
            <li
              key={rowKeys[index]}
              draggable={canUseDJControls}
              onDragStart={(event) => canUseDJControls && onDragStart(event, index)}
              onDragEnter={(event) => canUseDJControls && onDragOver(event, index)}
              onDragOver={(event) => canUseDJControls && onDragOver(event, index)}
              onDrop={(event) => canUseDJControls && onDrop(event, index)}
              onDragEnd={onDragEnd}
              className={`group flex items-center gap-3 px-3 py-2 border rounded-md hover:bg-bg-hover/50 transition-colors ${canUseDJControls ? 'cursor-grab active:cursor-grabbing' : ''} ${dropTargetIdx === index && draggedIdx !== index ? 'border-accent/70 bg-accent/10' : 'border-transparent'} ${draggedIdx === index ? 'opacity-50' : ''}`}
            >
              {canUseDJControls && (
                <button
                  type="button"
                  aria-label={`Reorder ${track.title}`}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  title="Drag, or focus and use the arrow keys"
                  onKeyDown={(event) => {
                    const target = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
                    if (target === null) return;
                    event.preventDefault();
                    if (target < 0 || target >= queue.tracks.length) return;
                    onMove(index, target);
                    // Keep the handle focused on the row it moved to.
                    const list = event.currentTarget.closest('ol');
                    requestAnimationFrame(() => list?.querySelectorAll<HTMLButtonElement>('[data-queue-handle]')[target]?.focus());
                  }}
                  data-queue-handle
                  className="flex h-7 w-5 items-center justify-center rounded text-text-muted cursor-move opacity-50 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <GripVertical size={14} />
                </button>
              )}
              {track.artwork ? <ArtworkImage src={track.artwork} className="w-8 h-8 rounded shrink-0 object-cover" /> : <span className="text-xs text-text-muted w-4 ml-1 tabular-nums flex-shrink-0">{queuePage * 20 + index + 1}</span>}
              <div className="flex-1 min-w-0 ml-1">
                <p className="text-sm truncate select-none">{track.title}</p>
                <p className="text-xs text-text-muted truncate select-none">{track.author}{track.requester ? ` • Requested by ${track.requester}` : ''}</p>
              </div>
              <span className="text-xs text-text-muted tabular-nums">{formatDuration(track.duration)}</span>
              {canUseDJControls && <button type="button" onClick={() => onRemove(index)} className="p-1.5 ml-2 text-text-muted hover:text-danger hover:bg-danger/10 rounded-md transition-colors opacity-70 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50 cursor-pointer" title="Remove track" aria-label={`Remove ${track.title}`}>
                <X size={14} />
              </button>}
            </li>
          ))}
        </ol>
        {autoplayNext && queue.tracks.length === 0 && <AutoplayUpNext track={autoplayNext} onAction={onAction} />}
      </div>
    </div>
  );
}
