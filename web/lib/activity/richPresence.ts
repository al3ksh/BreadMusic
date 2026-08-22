import type { PlayerStatus } from '@/lib/api';

const BREAD_ICON_URL = 'https://breadmusic.aleksh.xyz/assets/breadicon.png?v=3';
const MAX_TEXT_LENGTH = 128;

export type RichPresenceActivity = {
  type: number;
  details: string;
  state: string;
  timestamps?: {
    start: number;
    end: number;
  };
  assets: {
    large_image: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  instance: boolean;
};

function presenceText(value: string | null | undefined, fallback: string) {
  const normalized = String(value || '').trim() || fallback;
  if (normalized.length <= MAX_TEXT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TEXT_LENGTH - 1).trimEnd()}…`;
}

export function buildActivityRichPresence(
  status: PlayerStatus,
  position: number,
  now = Date.now(),
): RichPresenceActivity {
  const track = status.connected ? status.currentTrack : null;

  if (!track) {
    return {
      type: 2,
      details: 'Choosing the next track',
      state: status.voiceChannelName ? presenceText(`In ${status.voiceChannelName}`, 'In voice') : 'Ready to listen',
      assets: {
        large_image: BREAD_ICON_URL,
        large_text: 'Bread Music Activity',
      },
      instance: true,
    };
  }

  const title = presenceText(track.title, 'Unknown track');
  const author = presenceText(track.author, 'Unknown artist');
  const activity: RichPresenceActivity = {
    type: 2,
    details: title,
    state: status.paused ? presenceText(`Paused • ${author}`, 'Paused') : author,
    assets: {
      large_image: track.artwork || BREAD_ICON_URL,
      small_image: BREAD_ICON_URL,
      small_text: 'Bread Music',
    },
    instance: true,
  };

  if (!status.paused && track.duration > 0) {
    const safePosition = Math.max(0, Math.min(track.duration, position));
    activity.timestamps = {
      start: Math.floor((now - safePosition) / 1000),
      end: Math.floor((now + track.duration - safePosition) / 1000),
    };
  }

  return activity;
}
