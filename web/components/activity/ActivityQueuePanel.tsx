import { ChevronDown, Disc3, GripVertical, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { QueueTrack } from '@/lib/api';
import { ActivityArtwork, ActivitySpinner } from '@/components/activity/ActivityArtwork';

type ActivityQueue = {
  tracks: QueueTrack[];
  total: number;
};
type QueueRestoreState = { id: number; revision: string; throughPage: number };

type ActivityQueuePanelProps = {
  queue: ActivityQueue | null;
  canDj: boolean;
  queueRestore: QueueRestoreState | null;
  dragIndex: number | null;
  dropIndex: number | null;
  queueLoadingMore: boolean;
  setDragIndex: Dispatch<SetStateAction<number | null>>;
  setDropIndex: Dispatch<SetStateAction<number | null>>;
  stopQueueAutoScroll: () => void;
  handleQueueDrop: (index: number) => void | Promise<unknown>;
  handleQueueRemove: (index: number) => void | Promise<unknown>;
  loadMoreQueue: () => void | Promise<unknown>;
};

export function ActivityQueuePanel({
  queue,
  canDj,
  queueRestore,
  dragIndex,
  dropIndex,
  queueLoadingMore,
  setDragIndex,
  setDropIndex,
  stopQueueAutoScroll,
  handleQueueDrop,
  handleQueueRemove,
  loadMoreQueue,
}: ActivityQueuePanelProps) {
  return (
    <div className="activity-queue-list">
      {!queue?.tracks.length ? (
        <div className="activity-empty"><Disc3 size={20} /><span>Queue is empty</span></div>
      ) : queue.tracks.map((track, index) => (
        <div
          className={`activity-queue-row ${dropIndex === index ? 'drop-target' : ''}`}
          key={`${track.uri}-${index}`}
          draggable={canDj && !queueRestore}
          onDragStart={() => { stopQueueAutoScroll(); setDragIndex(index); setDropIndex(index); }}
          onDragOver={(event) => { if (canDj && !queueRestore) { event.preventDefault(); setDropIndex(index); } }}
          onDrop={() => handleQueueDrop(index)}
          onDragEnd={() => { stopQueueAutoScroll(); setDragIndex(null); setDropIndex(null); }}
        >
          <GripVertical size={15} className="activity-drag-icon" />
          <div className="activity-queue-index">{index + 1}</div>
          <ActivityArtwork src={track.artwork} />
          <div className="activity-queue-copy"><strong>{track.title}</strong><span>{track.author} - {track.requester || 'Unknown requester'}</span></div>
          <time>{formatDuration(track.duration)}</time>
          <button type="button" className="activity-queue-remove" disabled={!canDj} onClick={(event) => { event.stopPropagation(); handleQueueRemove(index); }} aria-label={`Remove ${track.title}`} title="Remove from queue"><Trash2 size={14} /></button>
        </div>
      ))}
      {queue && queue.tracks.length < queue.total && (
        <button type="button" className="activity-queue-load-more" disabled={queueLoadingMore || Boolean(queueRestore)} onClick={loadMoreQueue}>
          {queueLoadingMore || queueRestore ? <ActivitySpinner /> : <ChevronDown size={15} />}
          {queueRestore ? 'Syncing loaded tracks' : queueLoadingMore ? 'Loading queue' : `Load more (${queue.tracks.length}/${queue.total})`}
        </button>
      )}
    </div>
  );
}

function formatDuration(duration: number) {
  const totalSeconds = Math.max(0, Math.floor(duration / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
