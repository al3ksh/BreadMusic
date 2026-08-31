import { Pause, Play, Radio, Repeat, Shuffle, SkipBack, SkipForward, Square, Volume2 } from 'lucide-react';
import type { CSSProperties, MutableRefObject, ReactNode } from 'react';
import type { PlayerStatus } from '@/lib/api';
import { ActivitySpinner } from '@/components/activity/ActivityArtwork';

type ActivityPlayerControlsProps = {
  iconOnly?: boolean;
  autoplayDisabled?: boolean;
  status: PlayerStatus;
  queueTotal: number;
  canDj: boolean;
  hasTrack: boolean;
  actionBusy: string | null;
  controlFeedback: string | null;
  loopActive: boolean;
  runControlAction: (action: string, body?: Record<string, unknown>) => void | Promise<unknown>;
  playerAction: (action: string, body?: Record<string, unknown>) => void | Promise<unknown>;
  volumeOpen: boolean;
  setVolumeOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  volumeControlRef: MutableRefObject<HTMLDivElement | null>;
  displayedVolume: number;
  volumeLimit: number;
  volumeCommitTimerRef: MutableRefObject<number | null>;
  volumeDraggingRef: MutableRefObject<boolean>;
  volumePendingRef: MutableRefObject<number | null>;
  volumeDraft: number | null;
  setVolumeDraft: (value: number | null) => void;
  commitVolume: (value: number) => void | Promise<unknown>;
};

export function ActivityPlayerControls({
  iconOnly = false,
  autoplayDisabled = false,
  status,
  queueTotal,
  canDj,
  hasTrack,
  actionBusy,
  controlFeedback,
  loopActive,
  runControlAction,
  playerAction,
  volumeOpen,
  setVolumeOpen,
  volumeControlRef,
  displayedVolume,
  volumeLimit,
  volumeCommitTimerRef,
  volumeDraggingRef,
  volumePendingRef,
  volumeDraft,
  setVolumeDraft,
  commitVolume,
}: ActivityPlayerControlsProps) {
  return (
    <div className={`activity-controls-panel${iconOnly ? ' activity-icon-controls' : ''}`}>
      <div className="activity-primary-controls">
        <ControlButton label="Previous" feedback={controlFeedback === 'back'} disabled={!canDj || !hasTrack || Boolean(actionBusy)} onClick={() => runControlAction('back')}><SkipBack size={18} /></ControlButton>
        <ControlButton label={status.paused ? 'Resume' : 'Pause'} primary disabled={!canDj || !hasTrack || Boolean(actionBusy)} onClick={() => playerAction('toggle')}>
          {actionBusy === 'toggle' ? <ActivitySpinner /> : status.paused ? <Play size={20} /> : <Pause size={20} />}
        </ControlButton>
        <ControlButton label={status.voteSkip ? `Skip ${status.voteSkip.votes}/${status.voteSkip.requiredVotes}` : 'Skip'} feedback={controlFeedback === 'skip'} disabled={!hasTrack || Boolean(actionBusy)} onClick={() => runControlAction('skip')}><SkipForward size={18} /></ControlButton>
        <ControlButton label="Stop" feedback={controlFeedback === 'stop'} disabled={!canDj || !hasTrack || Boolean(actionBusy)} onClick={() => runControlAction('stop')}><Square size={16} /></ControlButton>
      </div>
      <div className="activity-secondary-controls">
        <ControlButton label="Shuffle" feedback={controlFeedback === 'shuffle'} disabled={!canDj || !queueTotal || Boolean(actionBusy)} onClick={() => runControlAction('shuffle')}><Shuffle size={16} /></ControlButton>
        <ControlButton label={`Loop ${status.repeatMode}`} active={loopActive} feedback={controlFeedback === 'loop'} disabled={!canDj || !hasTrack || Boolean(actionBusy)} onClick={() => runControlAction('loop')}><Repeat size={16} /></ControlButton>
        {iconOnly && <ControlButton label={`Autoplay ${status.autoplay ? 'on' : 'off'}`} active={status.autoplay} feedback={controlFeedback === 'autoplay'} disabled={autoplayDisabled || !canDj || Boolean(actionBusy)} onClick={() => runControlAction('autoplay', { enabled: !status.autoplay })}><Radio size={16} /></ControlButton>}
        <div className={`activity-volume-control ${volumeOpen ? 'is-open' : ''}`} ref={volumeControlRef}>
          <button
            type="button"
            className="activity-volume-trigger"
            disabled={!canDj || !status.connected}
            onClick={() => setVolumeOpen((open) => !open)}
            aria-label={`Volume ${displayedVolume}%`}
            aria-expanded={volumeOpen}
            title={`Volume ${displayedVolume}%`}
          >
            <Volume2 size={17} />
            <i style={{ transform: `scaleX(${displayedVolume / volumeLimit})` }} />
          </button>
          {volumeOpen && (
            <div className="activity-volume-popover" role="group" aria-label="Volume control">
              <div className="activity-volume-popover-header">
                <span><Volume2 size={16} /> Volume</span>
                <output>{displayedVolume}%</output>
              </div>
              <input
                type="range"
                min={0}
                max={volumeLimit}
                value={displayedVolume}
                disabled={!canDj || !status.connected}
                onPointerDown={(event) => {
                  if (volumeCommitTimerRef.current) window.clearTimeout(volumeCommitTimerRef.current);
                  volumeCommitTimerRef.current = null;
                  volumePendingRef.current = null;
                  volumeDraggingRef.current = true;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setVolumeDraft(Number(event.currentTarget.value));
                }}
                onChange={(event) => setVolumeDraft(Number(event.target.value))}
                onPointerUp={(event) => commitVolume(Number(event.currentTarget.value))}
                onPointerCancel={() => {
                  volumeDraggingRef.current = false;
                  volumePendingRef.current = null;
                  setVolumeDraft(null);
                }}
                onKeyUp={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                    commitVolume(Number(event.currentTarget.value));
                  }
                }}
                onBlur={(event) => {
                  if (volumeDraft !== null && volumePendingRef.current === null) commitVolume(Number(event.currentTarget.value));
                }}
                style={{ '--range-progress': `${(displayedVolume / volumeLimit) * 100}%` } as CSSProperties}
                aria-label="Volume"
                aria-valuetext={`${displayedVolume}%`}
              />
              <div className="activity-volume-scale" aria-hidden="true"><span>0</span><span>{volumeLimit}</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  disabled,
  primary,
  active,
  feedback,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  primary?: boolean;
  active?: boolean;
  feedback?: boolean;
  onClick: () => void | Promise<unknown>;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`activity-control-button${primary ? ' primary' : ''}${active ? ' is-active' : ''}${feedback ? ' is-feedback' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
