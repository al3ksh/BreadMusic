import { Dices, Radio, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import type { AutoplayFeedback, AutoplayNextTrack } from '@/lib/api';
import { formatDuration } from '@/lib/api';
import { ArtworkImage } from '@/components/ArtworkImage';

type PlayerAction = (action: string, body?: Record<string, unknown>) => Promise<boolean>;

function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

export function AutoplayRating({ feedback, onAction }: { feedback: AutoplayFeedback; onAction: PlayerAction }) {
  const [busy, run] = useBusy();
  const liked = feedback === 'like';
  const base = 'w-8 h-8 rounded-full flex items-center justify-center border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={() => run(() => onAction('autoplay_like'))}
        disabled={busy}
        title={liked ? 'Remove like' : 'Like: autoplay will pick more like this'}
        aria-pressed={liked}
        className={`${base} ${liked ? 'bg-success/15 text-success border-success/30 hover:bg-success/20' : 'bg-bg-hover text-text-secondary border-border hover:text-text-primary'}`}
      >
        <ThumbsUp size={14} fill={liked ? 'currentColor' : 'none'} />
      </button>
      <button
        onClick={() => run(() => onAction('autoplay_dislike'))}
        disabled={busy}
        title="Dislike and skip: autoplay will avoid this track"
        className={`${base} bg-bg-hover text-text-secondary border-border hover:text-danger hover:border-danger/30`}
      >
        <ThumbsDown size={14} />
      </button>
    </div>
  );
}

// Candidate sources from src/music/autoplay/sources.js.
const SOURCE_LABELS: Record<string, string> = {
  lastfm: 'Last.fm',
  radio: 'Radio mix',
  search: 'Similar',
  discovery: 'Discovery',
};

export function formatAutoplaySource(source: string | null) {
  if (!source) return null;
  return SOURCE_LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

export function AutoplayUpNext({ track, onAction }: { track: AutoplayNextTrack; onAction: PlayerAction }) {
  const [busy, run] = useBusy();
  const source = formatAutoplaySource(track.source);

  return (
    <div className="mt-1 flex items-center gap-3 px-3 py-2 rounded-md border border-dashed border-border/80 bg-bg-secondary/30">
      {track.artwork
        ? <ArtworkImage src={track.artwork} className="w-8 h-8 rounded shrink-0 object-cover opacity-70" />
        : <Radio size={14} className="text-text-muted shrink-0 mx-2" />}
      <div className="flex-1 min-w-0 ml-1">
        <p className="text-sm truncate text-text-secondary">{track.title}</p>
        <p className="text-xs text-text-muted truncate">
          <span className="text-accent/90">Up next · Autoplay</span>
          {source ? ` · ${source}` : ''} • {track.author}
        </p>
      </div>
      <span className="text-xs text-text-muted tabular-nums">{formatDuration(track.duration)}</span>
      <button
        onClick={() => run(() => onAction('autoplay_reroll'))}
        disabled={busy}
        title="Pick a different next track"
        aria-label="Pick a different next track"
        className="ml-2 inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Dices size={13} className={busy ? 'animate-spin' : ''} />
        <span className="hidden sm:inline">Different</span>
      </button>
    </div>
  );
}
