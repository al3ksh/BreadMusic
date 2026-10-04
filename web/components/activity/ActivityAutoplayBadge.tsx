import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { PlayerStatus } from '@/lib/api';

type ActivityAutoplayBadgeProps = {
  label: string;
  className?: string;
  status: PlayerStatus;
  hasTrack: boolean;
  actionBusy: string | null;
  controlFeedback: string | null;
  runControlAction: (action: string) => void | Promise<unknown>;
};

// The autoplay badge doubles as the place to rate the current track, so the feedback
// buttons stay out of the main controls.
export function ActivityAutoplayBadge({
  label,
  className = '',
  status,
  hasTrack,
  actionBusy,
  controlFeedback,
  runControlAction,
}: ActivityAutoplayBadgeProps) {
  const rateable = Boolean(status.autoplay && status.autoplayRateable && hasTrack);
  const liked = status.autoplayFeedback === 'like';
  const disabled = Boolean(actionBusy);

  return (
    <span className={`activity-autoplay-badge${rateable ? ' is-rateable' : ''} ${className}`.trim()}>
      {label}
      {rateable && (
        <>
          <button
            type="button"
            className={`activity-autoplay-thumb${liked ? ' is-liked' : ''}${controlFeedback === 'autoplay_like' ? ' is-popping' : ''}`}
            disabled={disabled}
            onClick={() => runControlAction('autoplay_like')}
            aria-label={liked ? 'Liked' : 'Like'}
            aria-pressed={liked}
            title={liked ? 'Remove like' : 'Like: autoplay will pick more like this'}
          >
            <ThumbsUp size={12} fill={liked ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className={`activity-autoplay-thumb is-dislike${controlFeedback === 'autoplay_dislike' ? ' is-popping' : ''}`}
            disabled={disabled}
            onClick={() => runControlAction('autoplay_dislike')}
            aria-label="Dislike"
            title="Dislike and skip: autoplay will avoid this track"
          >
            <ThumbsDown size={12} />
          </button>
        </>
      )}
    </span>
  );
}
