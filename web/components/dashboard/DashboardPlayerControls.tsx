import { Activity, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Square, SlidersHorizontal, Volume2, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { PlayerStatus } from '@/lib/api';
import { CtrlBtn } from '@/components/dashboard/DashboardPrimitives';
import { Select } from '@/components/dashboard/DashboardSelect';

type DashboardPlayerControlsProps = {
  status: PlayerStatus;
  canUseDJControls: boolean;
  canUsePlayerControls: boolean;
  canControlTrack: boolean;
  queueHasTracks: boolean;
  selectedFilter: string;
  filterOptions: { value: string; label: string }[];
  applyingFilter: boolean;
  volume: number;
  onAction: (action: string, body?: Record<string, unknown>) => Promise<boolean>;
  onVolumeChange: (value: number) => void;
  onVolumeCommit: (value: number) => void;
  onFilterChange: (value: string) => void;
  onApplyFilter: () => void;
};

export function DashboardPlayerControls({
  status,
  canUseDJControls,
  canUsePlayerControls,
  canControlTrack,
  queueHasTracks,
  selectedFilter,
  filterOptions,
  applyingFilter,
  volume,
  onAction,
  onVolumeChange,
  onVolumeCommit,
  onFilterChange,
  onApplyFilter,
}: DashboardPlayerControlsProps) {
  return (
    <>
      <div className="flex items-center justify-center gap-3 mt-6">
        <CtrlBtn onClick={() => onAction('shuffle')} title="Shuffle" disabled={!canUseDJControls || !canUsePlayerControls || !queueHasTracks}>
          <Shuffle size={16} />
        </CtrlBtn>
        <CtrlBtn onClick={() => onAction('back')} title="Previous" disabled={!canUseDJControls || !canControlTrack}>
          <SkipBack size={16} />
        </CtrlBtn>
        <CtrlBtn onClick={() => onAction('toggle')} title={status.paused ? 'Play' : 'Pause'} primary disabled={!canControlTrack}>
          {status.paused ? <Play size={18} /> : <Pause size={18} />}
        </CtrlBtn>
        <CtrlBtn onClick={() => onAction('skip')} title={status.voteSkip ? `Vote skip ${status.voteSkip.votes}/${status.voteSkip.requiredVotes}` : 'Skip'} disabled={!canControlTrack}>
          <SkipForward size={16} />
        </CtrlBtn>
        <CtrlBtn onClick={() => onAction('stop')} title="Stop" disabled={!canUseDJControls || !canControlTrack}>
          <Square size={14} />
        </CtrlBtn>
        <CtrlBtn onClick={() => onAction('loop')} title="Loop" badge={status.repeatMode !== 'off' ? (status.repeatMode === 'track' ? '1' : 'A') : undefined} disabled={!canUseDJControls || !canControlTrack}>
          <Repeat size={16} />
        </CtrlBtn>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 lg:flex-row lg:items-center">
        <div className={`flex items-center gap-3 rounded-lg border border-border bg-bg-input px-3 py-2 lg:w-[260px] lg:shrink-0 ${canUsePlayerControls && canUseDJControls ? '' : 'opacity-45 pointer-events-none'}`}>
          <Volume2 size={17} className="text-text-muted shrink-0" aria-hidden="true" />
          <SegmentedVolume
            value={volume}
            onChange={onVolumeChange}
            onCommit={onVolumeCommit}
            disabled={!canUsePlayerControls || !canUseDJControls}
          />
          <span className="w-11 shrink-0 text-right text-xs font-medium tabular-nums text-text-secondary" aria-hidden="true">{volume}%</span>
        </div>

        <button
          type="button"
          onClick={() => onAction('autoplay', { enabled: !status.autoplay })}
          disabled={!canUseDJControls || !canUsePlayerControls}
          aria-pressed={status.autoplay}
          className={`inline-flex h-[42px] shrink-0 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${status.autoplay ? 'border-success/30 bg-success/15 text-success hover:bg-success/20' : 'border-border bg-bg-input text-text-secondary hover:border-accent/30 hover:text-text-primary'}`}
        >
          <Activity size={15} />
          Autoplay
          <span className={`rounded px-1.5 py-px text-[10px] font-semibold tracking-wider ${status.autoplay ? 'bg-success/20' : 'bg-bg-hover text-text-muted'}`}>
            {status.autoplay ? 'ON' : 'OFF'}
          </span>
        </button>

        <div className="flex min-w-0 flex-1 gap-2">
          <Select
            ariaLabel="Audio filter"
            value={selectedFilter}
            onChange={onFilterChange}
            options={filterOptions}
            placeholder={status.filters ? `Active: ${status.filters}` : 'Audio filter'}
            disabled={!canUseDJControls || !canUsePlayerControls}
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={onApplyFilter}
            disabled={applyingFilter || !selectedFilter || !canUseDJControls || !canUsePlayerControls}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-secondary transition-colors hover:border-accent/30 hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            title="Apply filter preset"
          >
            <SlidersHorizontal size={14} />
            Apply
          </button>
          {status.filters && (
            <button
              type="button"
              onClick={() => onAction('filter', { preset: 'clear' })}
              disabled={!canUseDJControls || !canUsePlayerControls}
              aria-label="Clear filter"
              title="Clear filter"
              className="inline-flex shrink-0 items-center rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-danger transition-colors hover:bg-danger/15 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function SegmentedVolume({ value, onChange, onCommit, disabled }: { value: number; onChange: (value: number) => void; onCommit: (value: number) => void; disabled?: boolean }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState(0);
  const max = 150;
  const segments = 15;
  const isDragging = useRef(false);
  const dragValue = useRef(value);

  const getHoverIndex = (event: ReactPointerEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setTooltipLeft(progress * 100);
    return Math.round(progress * segments);
  };

  const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const hoverIndex = getHoverIndex(event, event.currentTarget);
    const nextValue = hoverIndex * (max / segments);
    dragValue.current = nextValue;
    setHoverIdx(hoverIndex);
    if (isDragging.current && value !== nextValue) onChange(nextValue);
  };

  // Arrow keys move one segment, Page keys two, Home and End jump to the ends.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = max / segments;
    const keys: Record<string, number> = {
      ArrowRight: value + step, ArrowUp: value + step,
      ArrowLeft: value - step, ArrowDown: value - step,
      PageUp: value + step * 2, PageDown: value - step * 2,
      Home: 0, End: max,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(max, Math.round(keys[event.key] / step) * step));
    if (next === value) return;
    onChange(next);
    onCommit(next);
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value}%`}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className="relative flex h-7 min-w-0 flex-1 items-end justify-between gap-[3px] cursor-pointer group py-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-4 focus-visible:ring-offset-bg-input"
      style={{ touchAction: 'none' }}
      onPointerLeave={() => setHoverIdx(null)}
      onPointerUp={(event) => {
        updateFromPointer(event);
        isDragging.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        onCommit(dragValue.current);
      }}
      onPointerCancel={() => {
        isDragging.current = false;
        onCommit(dragValue.current);
      }}
      onPointerDown={(event) => {
        isDragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={updateFromPointer}
    >
      {hoverIdx !== null && (
        <div className="pointer-events-none absolute -top-7 z-10 rounded bg-bg-primary border border-border px-1.5 py-0.5 text-[11px] font-medium text-text-primary shadow-lg tabular-nums" style={{ left: `${tooltipLeft}%`, transform: 'translateX(-50%)' }}>
          {hoverIdx * (max / segments)}%
        </div>
      )}
      {Array.from({ length: segments }).map((_, index) => {
        const segmentValue = (index + 1) * (max / segments);
        const isActive = value >= segmentValue - (max / segments) / 2;
        const isHovered = hoverIdx !== null && hoverIdx >= index + 1;
        return <div key={index} className={`flex-1 rounded-[1px] transition-all duration-75 ${isHovered ? 'bg-accent' : isActive ? 'bg-accent/80 shadow-[0_0_8px_rgba(90,84,148,0.3)]' : 'bg-border group-hover:bg-border/70'}`} style={{ height: `${30 + (index / (segments - 1)) * 70}%` }} />;
      })}
    </div>
  );
}
