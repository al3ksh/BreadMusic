import { Heart } from 'lucide-react';
import type { PlayerStatus } from '@/lib/api';

type ActivityHeartButtonProps = {
  status: PlayerStatus;
  hasTrack: boolean;
  actionBusy: string | null;
  controlFeedback: string | null;
  onToggle: () => void;
};

// Saves the current track to the listener's Liked list. It sits by the title, apart from the playback controls.
export function ActivityHeartButton({ status, hasTrack, actionBusy, controlFeedback, onToggle }: ActivityHeartButtonProps) {
  if (!hasTrack || !status.likeable) return null;
  const liked = Boolean(status.liked);
  const label = liked ? 'Saved to your Library' : 'Save to your Library';
  return (
    <button
      type="button"
      className={`activity-title-heart${liked ? ' is-liked' : ''}${controlFeedback === 'library_like' ? ' is-popping' : ''}`}
      disabled={Boolean(actionBusy)}
      onClick={onToggle}
      aria-label={label}
      aria-pressed={liked}
      title={label}
    >
      <Heart size={20} fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
}
