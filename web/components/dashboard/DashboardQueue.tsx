import { ChevronLeft, ChevronRight, GripVertical, Play, Trash2 } from 'lucide-react';
import type { DragEvent } from 'react';
import type { QueueTrack } from '@/lib/api';
import { formatDuration } from '@/lib/api';

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
  onDragStart: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnd: () => void;
  onRemove: (index: number) => void | Promise<unknown>;
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
  onRemove,
}: DashboardQueueProps) {
  return (
    <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
      <div className="bg-bg-secondary px-5 py-3.5 border-b border-border flex items-center justify-between">
        <h3 className="text-[15px] font-medium">Queue <span className="text-text-muted font-normal ml-2 text-sm">{queue.total} tracks</span></h3>
        <div className="flex items-center gap-2">
          <button onClick={onClear} disabled={!canUseDJControls || queue.total === 0} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer text-xs">
            <Trash2 size={13} /> Clear
          </button>
          {queue.totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => onPageChange(Math.max(0, queuePage - 1))} disabled={queuePage === 0} className="p-1 rounded hover:bg-bg-hover disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors">
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs text-text-muted tabular-nums px-1">{queuePage + 1}/{queue.totalPages}</span>
              <button onClick={() => onPageChange(Math.min(queue.totalPages - 1, queuePage + 1))} disabled={queuePage >= queue.totalPages - 1} className="p-1 rounded hover:bg-bg-hover disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-5">
        {queue.current && (
          <div className="mb-2 px-3 py-2.5 rounded-md bg-accent/10 border border-accent/20 flex items-center gap-3">
            {queue.current.artwork ? <img src={queue.current.artwork} alt="" className="w-8 h-8 rounded shrink-0 object-cover" /> : <Play size={14} className="text-accent shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{queue.current.title}</p>
              <p className="text-xs text-text-muted truncate">{queue.current.author}{queue.current.requester ? ` • Requested by ${queue.current.requester}` : ''}</p>
            </div>
            <span className="text-xs text-text-muted tabular-nums">{formatDuration(queue.current.duration)}</span>
          </div>
        )}

        {queue.tracks.length === 0 && <p className="text-sm text-text-muted text-center py-6">Queue is empty</p>}
        <div className="space-y-0.5">
          {queue.tracks.map((track, index) => (
            <div
              key={`${track.uri}-${index}`}
              draggable={canUseDJControls}
              onDragStart={(event) => canUseDJControls && onDragStart(event, index)}
              onDragEnter={(event) => canUseDJControls && onDragOver(event, index)}
              onDragOver={(event) => canUseDJControls && onDragOver(event, index)}
              onDrop={(event) => canUseDJControls && onDrop(event, index)}
              onDragEnd={onDragEnd}
              className={`group flex items-center gap-3 px-3 py-2 border rounded-md hover:bg-bg-hover/50 transition-colors ${canUseDJControls ? 'cursor-grab active:cursor-grabbing' : ''} ${dropTargetIdx === index && draggedIdx !== index ? 'border-accent/70 bg-accent/10' : 'border-transparent'} ${draggedIdx === index ? 'opacity-50' : ''}`}
            >
              {canUseDJControls && <div className="flex items-center justify-center w-5 text-text-muted cursor-move opacity-50 hover:opacity-100"><GripVertical size={14} /></div>}
              {track.artwork ? <img src={track.artwork} alt="" className="w-8 h-8 rounded shrink-0 object-cover" /> : <span className="text-xs text-text-muted w-4 ml-1 tabular-nums flex-shrink-0">{queuePage * 20 + index + 1}</span>}
              <div className="flex-1 min-w-0 ml-1">
                <p className="text-sm truncate select-none">{track.title}</p>
                <p className="text-xs text-text-muted truncate select-none">{track.author}{track.requester ? ` • Requested by ${track.requester}` : ''}</p>
              </div>
              <span className="text-xs text-text-muted tabular-nums">{formatDuration(track.duration)}</span>
              {canUseDJControls && <button onClick={() => onRemove(index)} className="p-1.5 ml-2 text-text-muted hover:text-danger hover:bg-danger/10 rounded-md transition-colors opacity-70 group-hover:opacity-100" title="Remove track">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
