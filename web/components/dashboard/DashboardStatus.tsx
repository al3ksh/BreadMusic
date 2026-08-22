'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, type GuildHealth, type GuildInsights, type GuildInsightsRange, type PlayerStatus, formatDuration } from '@/lib/api';
import { Play } from 'lucide-react';
import { Skeleton } from '@/components/dashboard/DashboardPrimitives';

export function DashboardStatus({ guildId }: { guildId: string }) {
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [health, setHealth] = useState<GuildHealth | null>(null);
  const [insights, setInsights] = useState<GuildInsights | null>(null);
  const [insightsRange, setInsightsRange] = useState<GuildInsightsRange>('all');
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(() => {
    Promise.allSettled([
      apiFetch<PlayerStatus>(`/guilds/${guildId}/status`),
      apiFetch<GuildHealth>(`/guilds/${guildId}/health`),
      apiFetch<GuildInsights>(`/guilds/${guildId}/insights?limit=5&range=${insightsRange}`),
    ])
      .then(([statusRes, healthRes, insightsRes]) => {
        if (statusRes.status === 'fulfilled') {
          setStatus(statusRes.value);
        }
        if (healthRes.status === 'fulfilled') {
          setHealth(healthRes.value);
        }
        if (insightsRes.status === 'fulfilled') {
          setInsights(insightsRes.value);
        }
      })
      .finally(() => setLoading(false));
  }, [guildId, insightsRange]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading) return (
    <div className="space-y-5 w-full max-w-5xl mx-auto">
      <div className="bg-bg-card rounded-lg border border-border p-5">
        <Skeleton className="h-5 w-1/3 mb-4" />
        <div className="space-y-4 pt-2 border-t border-border/50">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </div>
    </div>
  );
  if (!status) return <p className="text-text-secondary">Failed to load status.</p>;

  const stateLabel = status.connected
    ? status.playing ? 'Playing' : status.paused ? 'Paused' : 'Idle'
    : 'Disconnected';
  const stateColor = status.connected ? (status.playing ? 'text-success' : status.paused ? 'text-warning' : 'text-text-muted') : 'text-text-muted';

  const InfoRow = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex justify-between py-2.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );

  const HealthRow = ({
    label,
    ok,
    details,
  }: {
    label: string;
    ok: boolean;
    details: string;
  }) => (
    <div className="flex items-start justify-between py-2.5 border-b border-border/50 last:border-0 gap-3">
      <div className="min-w-0 flex items-start gap-2.5">
        <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${ok ? 'bg-success' : 'bg-danger'}`} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{label}</p>
          <p className="text-xs text-text-secondary mt-0.5 truncate">{details}</p>
        </div>
      </div>
      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full ${ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>
        {ok ? 'OK' : 'Issue'}
      </span>
    </div>
  );

  const healthRows = health
    ? [
        {
          label: 'API',
          ok: health.api.ok,
          details: 'Dashboard API responding',
        },
        {
          label: 'Discord Gateway',
          ok: health.discord.ok,
          details: health.discord.ping !== null
            ? `Ping ${health.discord.ping}ms (ws status ${health.discord.wsStatusCode ?? 'n/a'})`
            : `ws status ${health.discord.wsStatusCode ?? 'n/a'}`,
        },
        {
          label: 'Lavalink Node',
          ok: health.lavalink.ok,
          details: `${health.lavalink.connectedNodes}/${health.lavalink.totalNodes} nodes connected`,
        },
        {
          label: 'Player Message Channel',
          ok: health.playerMessageChannel.configured && health.playerMessageChannel.sendable === true,
          details: !health.playerMessageChannel.configured
            ? 'Disabled in settings'
            : health.playerMessageChannel.sendable
              ? `#${health.playerMessageChannel.channelName || health.playerMessageChannel.channelId || 'unknown'}`
              : 'Configured channel is not sendable',
        },
      ]
    : [];

  const topTracks = insights?.topTracks || [];
  const topUsers = insights?.topUsers || [];
  const trend14d = insights?.trend14d || [];
  const trendMax = trend14d.reduce((max, point) => Math.max(max, point.count), 0);
  const effectiveRange: GuildInsightsRange = insights?.range || insightsRange;
  const rangeLabel = effectiveRange === '24h' ? '24h' : effectiveRange === '7d' ? '7d' : 'all-time';

  const formatRelativeTime = (timestamp: number | null) => {
    if (!timestamp) return 'No data yet';

    const diff = Math.max(0, Date.now() - timestamp);
    if (diff < 60_000) return 'just now';

    const minutes = Math.floor(diff / 60_000);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const hasNowPlaying = Boolean(status.currentTrack);
  const sessionHistory = status.sessionHistory || [];

  return (
    <div className="w-full max-w-6xl mx-auto space-y-5 xl:grid xl:grid-cols-3 xl:gap-5 xl:space-y-0">
      <div className="space-y-5 xl:col-span-2">
        <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h3 className="text-[15px] font-medium">Health Panel</h3>
            <span className={`text-xs font-semibold uppercase tracking-wider ${healthRows.every((row) => row.ok) && healthRows.length > 0 ? 'text-success' : 'text-warning'}`}>
              {healthRows.every((row) => row.ok) && healthRows.length > 0 ? 'Healthy' : 'Needs Attention'}
            </span>
          </div>
          <div className="p-5">
            {healthRows.length > 0 ? (
              <div>
                {healthRows.map((row) => (
                  <HealthRow key={row.label} label={row.label} ok={row.ok} details={row.details} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted py-2">Health data not available yet.</p>
            )}
          </div>
        </div>

        <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h3 className="text-[15px] font-medium">Player Status</h3>
            <span className={`text-xs font-semibold uppercase tracking-wider ${stateColor}`}>
              {stateLabel}
            </span>
          </div>
          <div className="p-5">
            {status.connected ? (
              <div>
                <InfoRow label="Voice Channel" value={status.voiceChannelName || 'Unknown'} />
                <InfoRow label="Volume" value={`${status.volume}%`} />
                <InfoRow label="Loop" value={status.repeatMode.charAt(0).toUpperCase() + status.repeatMode.slice(1)} />
                <InfoRow label="Autoplay" value={status.autoplay ? 'Enabled' : 'Disabled'} />
                <InfoRow label="Queue" value={`${status.queueLength} tracks`} />
                {status.filters && <InfoRow label="Filter" value={status.filters.charAt(0).toUpperCase() + status.filters.slice(1)} />}
              </div>
            ) : (
              <p className="text-sm text-text-muted py-4 text-center">Bot is not connected to a voice channel.</p>
            )}
          </div>
        </div>

        <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h3 className="text-[15px] font-medium">Insights</h3>
            <div className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-bg-secondary/40 p-1">
              {(['24h', '7d', 'all'] as GuildInsightsRange[]).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setInsightsRange(range)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer ${effectiveRange === range ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-md border border-border/60 bg-bg-secondary/40 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-text-muted">Plays ({rangeLabel})</p>
                <p className="text-base font-semibold tabular-nums">{(insights?.summary.totalPlays || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-border/60 bg-bg-secondary/40 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-text-muted">Tracks</p>
                <p className="text-base font-semibold tabular-nums">{(insights?.summary.uniqueTracks || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-border/60 bg-bg-secondary/40 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-text-muted">Users</p>
                <p className="text-base font-semibold tabular-nums">{(insights?.summary.uniqueUsers || 0).toLocaleString()}</p>
              </div>
            </div>

            <p className="text-xs text-text-muted mt-3">
              Last play ({rangeLabel}): {formatRelativeTime(insights?.summary.lastPlayAt || null)}
            </p>

            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wider text-text-muted">Plays Trend</p>
                <span className="text-[11px] text-text-muted">Last 14 days</span>
              </div>

              {trend14d.length === 0 || trendMax === 0 ? (
                <p className="text-sm text-text-muted py-2">No trend data yet.</p>
              ) : (
                <>
                  <div className="h-24 rounded-md border border-border/60 bg-bg-secondary/30 px-2 py-2 flex items-end gap-1">
                    {trend14d.map((point) => (
                      <div
                        key={point.dateKey}
                        className="flex-1 h-full flex items-end"
                        title={`${point.dateKey}: ${point.count} plays`}
                      >
                        <div
                          className="w-full rounded-sm bg-accent/80 hover:bg-accent transition-colors"
                          style={{ height: `${Math.max(6, Math.round((point.count / trendMax) * 100))}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted tabular-nums">
                    <span>{trend14d[0]?.label}</span>
                    <span>{trend14d[Math.floor((trend14d.length - 1) / 2)]?.label}</span>
                    <span>{trend14d[trend14d.length - 1]?.label}</span>
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-text-muted mb-2">Top Tracks ({rangeLabel})</p>
                {topTracks.length === 0 ? (
                  <p className="text-sm text-text-muted py-2">No track data yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {topTracks.map((track) => (
                      <div key={track.key} className="flex items-center gap-2.5 rounded-md border border-border/50 px-2.5 py-2">
                        <span className="w-7 text-xs tabular-nums text-text-muted">#{track.rank}</span>
                        {track.artwork ? (
                          <img src={track.artwork} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-bg-hover flex items-center justify-center shrink-0">
                            <Play size={12} className="text-text-muted" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{track.title}</p>
                          <p className="text-xs text-text-muted truncate">{track.author}</p>
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-accent">{track.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-text-muted mb-2">Top Users ({rangeLabel})</p>
                {topUsers.length === 0 ? (
                  <p className="text-sm text-text-muted py-2">No user data yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {topUsers.map((user) => (
                      <div key={user.userId} className="flex items-center gap-2.5 rounded-md border border-border/50 px-2.5 py-2">
                        <span className="w-7 text-xs tabular-nums text-text-muted">#{user.rank}</span>
                        {user.avatar ? (
                          <img src={user.avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-bg-hover flex items-center justify-center text-xs text-text-muted shrink-0">
                            {(user.displayName || user.username || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{user.displayName || user.username}</p>
                          <p className="text-xs text-text-muted truncate">@{user.username}</p>
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-accent">{user.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="xl:col-span-1 xl:self-start xl:sticky xl:top-6">
        <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3.5 border-b border-border">
            <h3 className="text-[15px] font-medium">Now Playing</h3>
          </div>
          <div className="p-5">
            {hasNowPlaying && status.currentTrack ? (
              <div className="flex gap-4">
                {status.currentTrack.artwork ? (
                  <img src={status.currentTrack.artwork} alt="" className="w-20 h-20 rounded-lg object-cover shadow-lg" />
                ) : (
                  <div className="w-20 h-20 rounded-lg bg-bg-hover flex items-center justify-center">
                    <Music2 size={28} className="text-text-muted" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{status.currentTrack.title}</p>
                  <p className="text-sm text-text-secondary truncate">{status.currentTrack.author}</p>
                  <div className="mt-3">
                    <div className="h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all duration-1000"
                        style={{ width: `${status.currentTrack.duration > 0 ? (status.currentTrack.position / status.currentTrack.duration) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-text-muted mt-1.5 tabular-nums">
                      <span>{formatDuration(status.currentTrack.position)}</span>
                      <span>{formatDuration(status.currentTrack.duration)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-20 h-20 rounded-lg bg-bg-hover/80 border border-border/70 flex items-center justify-center shrink-0">
                    <Music2 size={28} className="text-text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      {status.connected ? 'Nothing is playing right now.' : 'Bot is not connected.'}
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      {status.connected
                        ? 'Queue a track to see live details in this panel.'
                        : 'Connect the bot and start playback to populate this panel.'}
                    </p>
                    <div className="mt-3 space-y-2">
                      <Skeleton className="h-1.5 w-full" />
                      <div className="flex justify-between">
                        <Skeleton className="h-3 w-10" />
                        <Skeleton className="h-3 w-10" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 bg-bg-card rounded-lg border border-border overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3.5 border-b border-border">
            <h3 className="text-[15px] font-medium">Session History</h3>
          </div>

          <div className="p-4">
            {sessionHistory.length === 0 ? (
              <p className="text-sm text-text-muted py-2">No tracks in bot session yet.</p>
            ) : (
              <div className="space-y-2">
                {sessionHistory.map((track, index) => (
                  <div key={`${track.uri || track.title}-${index}`} className="flex items-center gap-2.5 rounded-md border border-border/50 bg-bg-secondary/20 px-2.5 py-2">
                    {track.artwork ? (
                      <img src={track.artwork} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-bg-hover flex items-center justify-center shrink-0">
                        <Play size={12} className="text-text-muted" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{track.title}</p>
                      <p className="text-xs text-text-muted truncate">{track.author}</p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-[11px] tabular-nums text-text-secondary">{formatDuration(track.duration)}</p>
                      <p className="text-[10px] text-text-muted">#{index + 1}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Music2({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="8" cy="18" r="4" /><path d="M12 18V2l7 4" />
    </svg>
  );
}

function SegmentedVolume({ value, onChange, onCommit }: { value: number; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState(0);
  const max = 150;
  const segments = 15;
  const isDragging = useRef(false);
  const dragPointerId = useRef<number | null>(null);
  const dragValue = useRef(value);

  const getClientX = (e: React.PointerEvent) => e.clientX;

  const getHoverIndex = (e: React.PointerEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const x = getClientX(e);
    const progress = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    setTooltipLeft(progress * 100);
    return Math.round(progress * segments);
  };

  const updateFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const hIdx = getHoverIndex(e, e.currentTarget);
    const nextValue = hIdx * (max / segments);
    dragValue.current = nextValue;
    setHoverIdx(hIdx);
    if (isDragging.current && value !== nextValue) onChange(nextValue);
  };

  return (
    <div
      className="relative flex items-end justify-between h-6 w-36 gap-[3px] cursor-pointer group py-1"
      style={{ touchAction: 'none' }}
      onPointerLeave={() => setHoverIdx(null)}
      onPointerUp={(e) => {
        updateFromPointer(e);
        isDragging.current = false;
        dragPointerId.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        onCommit(dragValue.current);
      }}
      onPointerCancel={() => {
        isDragging.current = false;
        dragPointerId.current = null;
        onCommit(dragValue.current);
      }}
      onPointerDown={(e) => {
        isDragging.current = true;
        dragPointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        updateFromPointer(e);
      }}
      onPointerMove={updateFromPointer}
    >
      {hoverIdx !== null && (
        <div
          className="pointer-events-none absolute -top-7 z-10 rounded bg-bg-primary border border-border px-1.5 py-0.5 text-[11px] font-medium text-text-primary shadow-lg tabular-nums"
          style={{ left: `${tooltipLeft}%`, transform: 'translateX(-50%)' }}
        >
          {hoverIdx * (max / segments)}%
        </div>
      )}
      {Array.from({ length: segments }).map((_, i) => {
        const segValue = (i + 1) * (max / segments);
        const isActive = value >= segValue - (max/segments)/2;
        const isHovered = hoverIdx !== null && hoverIdx >= i + 1;

        return (
          <div
            key={i}
            className={`flex-1 rounded-[1px] transition-all duration-75 ${
              isHovered ? 'bg-accent' : isActive ? 'bg-accent/80 shadow-[0_0_8px_rgba(90,84,148,0.3)]' : 'bg-border group-hover:bg-border/70'
            }`}
            style={{ height: `${30 + (i / (segments - 1)) * 70}%` }}
          />
        );
      })}
    </div>
  );
}
