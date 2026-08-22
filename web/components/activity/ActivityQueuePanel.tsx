import { ChevronDown, Disc3, GripVertical, Radio, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { PlayerStatus, QueueTrack } from '@/lib/api';
import { ActivityArtwork, ActivitySpinner } from '@/components/activity/ActivityArtwork';

type ActivityQueue = {
  tracks: QueueTrack[];
  total: number;
};
type QueueRestoreState = { id: number; revision: string; throughPage: number };

type ActivityQueuePanelProps = {
  queue: ActivityQueue | null;
  status: PlayerStatus;
  canDj: boolean;
  actionBusy: string | null;
  queueRestore: QueueRestoreState | null;
  dragIndex: number | null;
  dropIndex: number | null;
  queueLoadingMore: boolean;
  setDragIndex: Dispatch<SetStateAction<number | null>>;
  setDropIndex: Dispatch<SetStateAction<number | null>>;
  stopQueueAutoScroll: () => void;
  runControlAction: (action: string, body?: Record<string, unknown>) => void | Promise<unknown>;
  handleQueueDrop: (index: number) => void | Promise<unknown>;
  handleQueueRemove: (index: number) => void | Promise<unknown>;
  loadMoreQueue: () => void | Promise<unknown>;
};

export function ActivityQueuePanel({
  queue,
  status,
  canDj,
  actionBusy,
  queueRestore,
  dragIndex,
  dropIndex,
  queueLoadingMore,
  setDragIndex,
  setDropIndex,
  stopQueueAutoScroll,
  runControlAction,
  handleQueueDrop,
  handleQueueRemove,
  loadMoreQueue,
}: ActivityQueuePanelProps) {
  return (
    <div className="activity-queue-list">
      <button
        type="button"
        className={`activity-queue-state activity-autoplay-toggle ${status.autoplay ? 'active' : ''}`}
        disabled={!canDj || Boolean(actionBusy)}
        aria-pressed={status.autoplay}
        onClick={() => runControlAction('autoplay', { enabled: !status.autoplay })}
      >
        <Radio size={15} /> Autoplay {status.autoplay ? 'on' : 'off'}
      </button>
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
