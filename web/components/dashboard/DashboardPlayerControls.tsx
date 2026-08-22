import { Activity, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Square, SlidersHorizontal, Volume2, X } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PlayerStatus } from '@/lib/api';
import { CtrlBtn } from '@/components/dashboard/DashboardPrimitives';

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

      <div className={`flex items-center gap-4 mt-5 px-1 ${canUsePlayerControls && canUseDJControls ? '' : 'opacity-45 pointer-events-none'}`}>
        <Volume2 size={18} className="text-text-muted shrink-0" />
        <div className="flex-1 flex justify-center items-center">
          <SegmentedVolume value={volume} onChange={onVolumeChange} onCommit={onVolumeCommit} />
        </div>
        <span className="text-xs font-medium text-text-secondary w-12 shrink-0 text-center tabular-nums bg-bg-hover px-1.5 py-1 rounded-md">{volume}%</span>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          onClick={() => onAction('autoplay', { enabled: !status.autoplay })}
          disabled={!canUseDJControls || !canUsePlayerControls}
          className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${status.autoplay ? 'bg-success/15 text-success border border-success/30 hover:bg-success/20' : 'bg-bg-input text-text-secondary border border-border hover:text-text-primary hover:border-accent/30'}`}
        >
          <Activity size={15} />
          Autoplay: {status.autoplay ? 'ON' : 'OFF'}
        </button>

        <div className="flex gap-2">
          <select
            value={selectedFilter}
            onChange={(event) => onFilterChange(event.target.value)}
            disabled={!canUseDJControls || !canUsePlayerControls}
            className="rounded-md border border-border bg-bg-input text-text-primary px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-[inherit] flex-1 min-w-0 disabled:opacity-50"
          >
            {filterOptions.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </select>
          <button
            onClick={onApplyFilter}
            disabled={applyingFilter || !selectedFilter || !canUseDJControls || !canUsePlayerControls}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-bg-input border border-border text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="Apply filter preset"
          >
            <SlidersHorizontal size={14} />
            Apply
          </button>
          <button
            onClick={() => onAction('filter', { preset: 'clear' })}
            disabled={!canUseDJControls || !canUsePlayerControls}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-danger/10 border border-danger/25 text-danger hover:bg-danger/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="Clear filter"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </>
  );
}

function SegmentedVolume({ value, onChange, onCommit }: { value: number; onChange: (value: number) => void; onCommit: (value: number) => void }) {
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

  return (
    <div
      className="relative flex items-end justify-between h-6 w-36 gap-[3px] cursor-pointer group py-1"
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
