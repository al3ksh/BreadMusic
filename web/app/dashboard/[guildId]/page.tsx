'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { apiFetch, type GuildConfig, type PlayerStatus, type QueueTrack, type GuildHealth, type GuildInsights, type GuildInsightsRange, type FilterPreset, type EconomyLeaderboardEntry, type EconomyMember, type DashboardCapabilities, type HistoryPage, type LyricsResult, formatDuration } from '@/lib/api';
import { Settings, Activity, Play, Pause, SkipForward, Square, Shuffle, Repeat, Volume2, Search, ChevronLeft, ChevronRight, ArrowLeft, Terminal, MessageSquare, Mic, Paperclip, X, Coins, SlidersHorizontal, Trash2, Upload, FileAudio, SkipBack, GripVertical, Bold, Italic, Code2, AtSign, Hash, History, BookOpenText, Clock3 } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';

type Tab = 'settings' | 'status' | 'player' | 'history' | 'lyrics' | 'economy' | 'control';

export default function GuildPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const guildId = params.guildId as string;
  const rawView = searchParams.get('view');
  const [capabilities, setCapabilities] = useState<DashboardCapabilities | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const validTabs: Tab[] = ['settings', 'status', 'player', 'history', 'lyrics', 'economy', 'control'];
  const invalidView = rawView && !validTabs.includes(rawView as Tab) ? rawView : null;
  const defaultTab: Tab = capabilities?.canManageConfig ? 'settings' : 'player';
  const activeTab = invalidView ? defaultTab : ((rawView as Tab) || defaultTab);
  const restrictedView = (
    (activeTab === 'settings' && !capabilities?.canManageConfig) ||
    (activeTab === 'economy' && !capabilities?.canManageEconomy) ||
    (activeTab === 'control' && !capabilities?.canUseRemoteControl)
  );

  useEffect(() => {
    setAccessLoading(true);
    apiFetch<DashboardCapabilities>(`/guilds/${guildId}/access`)
      .then(setCapabilities)
      .catch(() => setCapabilities(null))
      .finally(() => setAccessLoading(false));
  }, [guildId]);

  useEffect(() => {
    if (!accessLoading && capabilities && restrictedView) {
      router.replace(`/dashboard/${guildId}?view=player`);
    }
  }, [accessLoading, capabilities, restrictedView, router, guildId]);

  if (accessLoading) {
    return <div className="flex justify-center py-24"><Spinner /></div>;
  }

  if (!capabilities?.canAccess) {
    return <div className="rounded-lg border border-border bg-bg-card p-8 text-center text-text-secondary">You do not have dashboard access for this server.</div>;
  }

  return (
    <div className="animate-fade-up">
      {/* Page header */}
      <div className="bg-bg-secondary border-b border-border -mx-4 -mt-16 mb-5 px-4 py-4 pl-16 md:-m-8 md:mb-8 md:px-8 md:py-5">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Settings size={22} className="hidden shrink-0 text-text-secondary sm:block" />
            <div>
              <h2 className="truncate text-[18px] font-medium sm:text-[22px]">
                {invalidView && 'View Not Found'}
                {activeTab === 'settings' && 'Server Settings'}
                {activeTab === 'status' && 'Server Status'}
                {activeTab === 'player' && 'Music Player'}
                {activeTab === 'history' && 'Listening History'}
                {activeTab === 'lyrics' && 'Lyrics'}
                {activeTab === 'economy' && 'Economy'}
                {activeTab === 'control' && 'Remote Control'}
              </h2>
              <p className="mt-1 truncate text-[12px] text-text-secondary sm:text-[13px]">
                {invalidView
                  ? `The view "${invalidView}" does not exist in dashboard.`
                  : 'Manage bot configuration and playback'}
              </p>
            </div>
          </div>
          <button
            onClick={() => router.push('/dashboard')}
            className="hidden sm:flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer px-4 py-2 rounded-lg border border-border hover:bg-bg-hover"
          >
            <ArrowLeft size={14} />
            Back
          </button>
        </div>
      </div>

      {!invalidView && !restrictedView && activeTab === 'settings' && <SettingsTab guildId={guildId} />}
      {!invalidView && activeTab === 'status' && <StatusTab guildId={guildId} />}
      {!invalidView && activeTab === 'player' && <PlayerTab guildId={guildId} capabilities={capabilities} />}
      {!invalidView && activeTab === 'history' && <HistoryTab guildId={guildId} />}
      {!invalidView && activeTab === 'lyrics' && <LyricsTab guildId={guildId} />}
      {!invalidView && !restrictedView && activeTab === 'economy' && <EconomyTab guildId={guildId} />}
      {!invalidView && !restrictedView && activeTab === 'control' && <ControlTab guildId={guildId} />}

      {invalidView && (
        <div className="w-full max-w-5xl mx-auto rounded-lg border border-border bg-bg-card p-6 text-center">
          <p className="text-sm text-text-secondary">
            Requested view <span className="font-mono text-text-primary">{invalidView}</span> is not available.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => router.replace(`/dashboard/${guildId}?view=settings`)}
              className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover transition-colors cursor-pointer"
            >
              Go to Settings
            </button>
            <button
              type="button"
              onClick={() => router.replace(`/dashboard/${guildId}?view=status`)}
              className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
            >
              Go to Status
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-border/50 rounded-md ${className}`} />;
}

const inputClass = "w-48 rounded-md border border-border bg-bg-input text-text-primary px-3 py-2 text-sm outline-none focus:border-accent transition-colors placeholder:text-text-muted font-[inherit]";
const rangeClass = "w-full min-w-24 h-1.5 rounded-full appearance-none cursor-pointer bg-border accent-accent";
const selectClass = "rounded-md border border-border bg-bg-input text-text-primary px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-[inherit]";
const TRACK_TRANSITION_GRACE_MS = 3500;

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-bg-card rounded-lg border border-border overflow-hidden ${className || ''}`}>
      <div className="bg-bg-secondary px-4 py-3 border-b border-border sm:px-5 sm:py-3.5">
        <h3 className="text-[15px] font-medium flex items-center gap-2">{title}</h3>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-stretch justify-between gap-3 py-3 border-b border-border/50 last:border-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {desc && <p className="text-xs text-text-secondary mt-0.5">{desc}</p>}
      </div>
      <div className="w-full sm:w-auto sm:shrink-0">{children}</div>
    </div>
  );
}

function SettingsTab({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [config, setConfig] = useState<GuildConfig | null>(null);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const compactValueInputClass = 'w-14 h-7 rounded-md border border-border bg-bg-input text-text-primary px-2 text-xs text-right tabular-nums outline-none focus:border-accent transition-colors font-[inherit]';

  useEffect(() => {
    Promise.all([
      apiFetch<GuildConfig>(`/guilds/${guildId}/config`),
      apiFetch<DiscordRole[]>(`/guilds/${guildId}/roles`),
      apiFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`)
    ])
      .then(([confRes, rolesRes, channelsRes]) => {
        setConfig(confRes);
        setRoles(rolesRes || []);
        setChannels(channelsRes || []);
      })
      .catch(() => {
        toast.error('Failed to load settings', 'Could not load server configuration.');
      })
      .finally(() => setLoading(false));
  }, [guildId, toast]);

  const save = useCallback(async (updates: Record<string, unknown>) => {
    setSaving(true);
    try {
      await apiFetch(`/guilds/${guildId}/config`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      toast.success('Settings saved', 'Server configuration has been updated.');
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to save';
      toast.error('Save failed', text);
    } finally {
      setSaving(false);
    }
  }, [guildId, toast]);

  const reset = useCallback(async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ success: boolean; config: GuildConfig }>(`/guilds/${guildId}/config/reset`, { method: 'POST' });
      setConfig(res.config);
      toast.success('Settings reset', 'Default values have been restored.');
    } catch (err) {
      toast.error('Reset failed', 'Could not reset server configuration.');
    } finally {
      setSaving(false);
    }
  }, [guildId, toast]);

  if (loading) return (
    <div className="space-y-5 w-full max-w-5xl mx-auto">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-bg-card rounded-lg border border-border p-5">
          <Skeleton className="h-5 w-1/3 mb-4" />
          <div className="space-y-4 pt-2 border-t border-border/50">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
  if (!config) return <p className="text-text-secondary">Failed to load config.</p>;

  const playerTextChannelValue = config.playerTextChannelId === null
    ? '__default'
    : config.playerTextChannelId === 'disabled'
      ? '__disabled'
      : config.playerTextChannelId;
  const playerTextChannelDescription = config.playerTextChannelId === 'disabled'
    ? 'Disabled (no player message)'
    : config.playerTextChannelName || 'Default (use command/player context)';

  return (
    <div className="space-y-5 w-full max-w-5xl mx-auto">

      <Section title="DJ & Permissions">
        <Row label="Dashboard Access" desc="DJ access uses the configured DJ role; without one, every member is treated as a DJ">
          <select
            value={config.dashboardAccess}
            onChange={(e) => setConfig({ ...config, dashboardAccess: e.target.value as GuildConfig['dashboardAccess'] })}
            className={selectClass + " w-full sm:w-64"}
          >
            <option value="admin">Administrators only</option>
            <option value="dj">Administrators and DJs</option>
            <option value="members">All server members</option>
          </select>
        </Row>
        <Row label="DJ Role" desc={config.djRoleName || 'All members can DJ'}>
          <select
            value={config.djRoleId || ''}
            onChange={(e) => setConfig({ ...config, djRoleId: e.target.value || null })}
            className={selectClass + " w-full sm:w-64"}
          >
            <option value="">(None - All members can DJ)</option>
            {roles.filter(r => r.name !== '@everyone').map(r => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Vote Skip Threshold" desc="Percentage of listeners needed to skip">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10} max={100} step={5}
              value={config.voteSkipPercent * 100}
              onChange={(e) => setConfig({ ...config, voteSkipPercent: Number(e.target.value) / 100 })}
              className={rangeClass}
            />
            <input
              type="number"
              min={10}
              max={100}
              step={1}
              value={Math.round(config.voteSkipPercent * 100)}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isNaN(value)) return;
                setConfig({ ...config, voteSkipPercent: clamp(value, 10, 100) / 100 });
              }}
              aria-label="Vote skip percent"
              className={compactValueInputClass}
            />
            <span className="text-xs text-text-secondary">%</span>
          </div>
        </Row>
      </Section>

      <Section title="Volume">
        <Row label="Default Volume">
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={100}
              value={config.defaultVolume}
              onChange={(e) => setConfig({ ...config, defaultVolume: Number(e.target.value) })}
              className={rangeClass}
            />
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={config.defaultVolume}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isNaN(value)) return;
                setConfig({ ...config, defaultVolume: clamp(value, 0, 100) });
              }}
              aria-label="Default volume"
              className={compactValueInputClass}
            />
            <span className="text-xs text-text-secondary">%</span>
          </div>
        </Row>
        <Row label="Maximum Volume">
          <div className="flex items-center gap-2">
            <input
              type="range" min={10} max={500}
              value={config.maxVolume}
              onChange={(e) => setConfig({ ...config, maxVolume: Number(e.target.value) })}
              className={rangeClass}
            />
            <input
              type="number"
              min={10}
              max={500}
              step={1}
              value={config.maxVolume}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isNaN(value)) return;
                setConfig({ ...config, maxVolume: clamp(value, 10, 500) });
              }}
              aria-label="Maximum volume"
              className={compactValueInputClass}
            />
            <span className="text-xs text-text-secondary">%</span>
          </div>
        </Row>
      </Section>

      <Section title="Behavior">
        <Row label="Autoplay" desc="Play similar tracks when queue ends">
          <ToggleSwitch checked={config.autoplay} onChange={(v) => setConfig({ ...config, autoplay: v })} />
        </Row>
        <Row label="Stay in Channel (24/7)" desc="Bot stays connected even when idle">
          <ToggleSwitch checked={config.stayInChannel} onChange={(v) => setConfig({ ...config, stayInChannel: v })} />
        </Row>
        <Row label="Persistent Queue" desc="Save queue between bot restarts">
          <ToggleSwitch checked={config.persistentQueue} onChange={(v) => setConfig({ ...config, persistentQueue: v })} />
        </Row>
        <Row label="Voice Channel Status" desc="Show the current track below the voice channel name">
          <ToggleSwitch checked={config.voiceChannelStatus} onChange={(v) => setConfig({ ...config, voiceChannelStatus: v })} />
        </Row>
        <Row label="AFK Timeout">
          <div className="flex items-center gap-2">
            <input
              type="range" min={0.5} max={30} step={0.5}
              value={config.afkTimeout / 60000}
              onChange={(e) => setConfig({ ...config, afkTimeout: Number(e.target.value) * 60000 })}
              className={rangeClass}
            />
            <input
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={Number((config.afkTimeout / 60000).toFixed(1))}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isNaN(value)) return;
                setConfig({ ...config, afkTimeout: clamp(value, 0.5, 30) * 60000 });
              }}
              aria-label="AFK timeout minutes"
              className={compactValueInputClass}
            />
            <span className="text-xs text-text-secondary">m</span>
          </div>
        </Row>
        <Row label="Preferred Source">
          <select
            value={config.preferredSource || ''}
            onChange={(e) => setConfig({ ...config, preferredSource: e.target.value || null })}
            className={selectClass + " w-full sm:w-48"}
          >
            <option value="">Auto</option>
            <option value="ytsearch">YouTube</option>
            <option value="scsearch">SoundCloud</option>
            <option value="spsearch">Spotify</option>
          </select>
        </Row>
        <Row label="Player Text Channel" desc={playerTextChannelDescription}>
          <select
            value={playerTextChannelValue}
            onChange={(e) => {
              const value = e.target.value;
              setConfig({
                ...config,
                playerTextChannelId: value === '__default' ? null : value === '__disabled' ? 'disabled' : value,
              });
            }}
            className={selectClass + " w-full sm:w-64"}
          >
            <option value="__default">Default (use command/player channel)</option>
            <option value="__disabled">Disabled (do not send player message)</option>
            {channels.filter(c => c.type === 0 || c.type === 5).map(c => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="24/7 Voice Channel" desc={config.twentyFourSevenChannelName || 'Not set'}>
          <select
            value={config.twentyFourSevenChannelId || ''}
            onChange={(e) => setConfig({ ...config, twentyFourSevenChannelId: e.target.value || null })}
            className={selectClass + " w-full sm:w-64"}
          >
            <option value="">(None - Disabled)</option>
            {channels.filter(c => c.type === 2 || c.type === 13).map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <div className="flex flex-col gap-3 pt-4 border-t border-border/50 sm:flex-row sm:items-center sm:gap-4">
        <button
          onClick={() => save(config as any)}
          disabled={saving}
          className="w-full px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all shadow-lg shadow-accent/20 disabled:opacity-50 cursor-pointer sm:w-auto"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          onClick={reset}
          disabled={saving}
          className="w-full px-6 py-2.5 rounded-lg bg-danger/10 text-danger text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 cursor-pointer sm:w-auto"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${checked ? 'bg-accent' : 'bg-border'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

function StatusTab({ guildId }: { guildId: string }) {
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

function Music2({ size, className }: { size: number; className?: string }) {
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

  const getClientX = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e) {
      return e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? 0;
    }
    return (e as React.MouseEvent).clientX;
  };

  const getHoverIndex = (e: React.MouseEvent | React.TouchEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const x = getClientX(e);
    const progress = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    setTooltipLeft(progress * 100);
    return Math.round(progress * segments);
  };

  return (
    <div 
      className="relative flex items-end justify-between h-6 w-36 gap-[3px] cursor-pointer group py-1"
      onMouseLeave={() => { setHoverIdx(null); isDragging.current = false; }}
      onMouseUp={(e) => { 
        isDragging.current = false;
        onCommit(getHoverIndex(e, e.currentTarget) * (max / segments));
      }}
      onTouchEnd={(e) => { 
        isDragging.current = false;
        onCommit(getHoverIndex(e, e.currentTarget) * (max / segments));
      }}
      onMouseDown={(e) => {
        isDragging.current = true;
        const v = getHoverIndex(e, e.currentTarget) * (max / segments);
        if (value !== v) onChange(v);
      }}
      onTouchStart={(e) => {
        isDragging.current = true;
        const v = getHoverIndex(e, e.currentTarget) * (max / segments);
        if (value !== v) onChange(v);
      }}
      onMouseMove={(e) => {
        const hIdx = getHoverIndex(e, e.currentTarget);
        setHoverIdx(hIdx);
        const v = hIdx * (max / segments);
        if (isDragging.current && value !== v) {
            onChange(v);
        }
      }}
      onTouchMove={(e) => {
        if (isDragging.current) {
            const hIdx = getHoverIndex(e, e.currentTarget);
            setHoverIdx(hIdx);
            const v = hIdx * (max / segments);
            if (value !== v) onChange(v);
        }
      }}
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

function HistoryTab({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<HistoryPage>(`/guilds/${guildId}/history?page=${page}&limit=30`)
      .then(setHistory)
      .catch((error) => toast.error('History unavailable', error instanceof Error ? error.message : 'Failed to load history.'))
      .finally(() => setLoading(false));
  }, [guildId, page, toast]);

  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="rounded-lg border border-border bg-bg-card overflow-hidden">
        <div className="border-b border-border bg-bg-secondary px-5 py-4">
          <h3 className="flex items-center gap-2 text-[15px] font-medium"><History size={17} /> Listening History</h3>
          <p className="mt-1 text-xs text-text-muted">{history ? `${history.total} retained plays` : 'Recent server playback'}</p>
        </div>
        <div className="divide-y divide-border/60">
          {loading && <div className="p-8 text-center text-text-muted"><Spinner /></div>}
          {!loading && history?.items.length === 0 && <div className="p-10 text-center text-sm text-text-muted">No playback history yet.</div>}
          {!loading && history?.items.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              {entry.track.artwork ? (
                <img src={entry.track.artwork} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-bg-hover"><Play size={16} className="text-text-muted" /></div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-medium">{entry.track.title}</p>
                  {entry.autoplay && <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">AUTO</span>}
                </div>
                <p className="truncate text-xs text-text-secondary">
                  {entry.track.author}{entry.requester ? ` · requested by ${entry.requester.displayName}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs tabular-nums text-text-secondary">{formatDuration(entry.track.duration)}</p>
                <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-text-muted">
                  <Clock3 size={10} />{new Date(entry.playedAt).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
        {history && history.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border bg-bg-secondary px-4 py-3">
            <button className="rounded-md border border-border p-2 disabled:opacity-40" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} aria-label="Previous history page"><ChevronLeft size={16} /></button>
            <span className="text-xs text-text-secondary">Page {page + 1} of {history.totalPages}</span>
            <button className="rounded-md border border-border p-2 disabled:opacity-40" disabled={page + 1 >= history.totalPages} onClick={() => setPage((value) => value + 1)} aria-label="Next history page"><ChevronRight size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

type SyncedLyricLine = {
  time: number;
  text: string;
};

function parseSyncedLyrics(value: string): SyncedLyricLine[] {
  const lines: SyncedLyricLine[] = [];
  const pattern = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]\s*(.*)$/;

  for (const rawLine of value.split(/\r?\n/)) {
    const match = rawLine.match(pattern);
    if (!match) continue;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0').slice(0, 3)}`) : 0;
    lines.push({
      time: (minutes * 60 + seconds + fraction) * 1000,
      text: match[4].trim() || '♪',
    });
  }

  return lines.sort((a, b) => a.time - b.time);
}

function LyricsTab({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [liveMode, setLiveMode] = useState(false);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus | null>(null);
  const [livePosition, setLivePosition] = useState(0);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const lastLiveTrackRef = useRef('');
  const liveClockRef = useRef<{
    trackKey: string;
    position: number;
    duration: number;
    capturedAt: number;
    paused: boolean;
  } | null>(null);

  const loadLyrics = useCallback(async (manual: boolean, requestedArtist = artist, requestedTitle = title) => {
    setLoading(true);
    try {
      const params = manual
        ? `?artist=${encodeURIComponent(requestedArtist.trim())}&title=${encodeURIComponent(requestedTitle.trim())}`
        : '';
      const result = await apiFetch<LyricsResult>(`/guilds/${guildId}/lyrics${params}`);
      setLyrics(result);
      if (!manual) {
        setArtist(result.artist);
        setTitle(result.title);
      }
    } catch (error) {
      setLyrics(null);
      if (manual) toast.error('Lyrics unavailable', error instanceof Error ? error.message : 'Lyrics not found.');
    } finally {
      setLoading(false);
    }
  }, [artist, title, guildId, toast]);

  useEffect(() => {
    loadLyrics(false, '', '');
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!liveMode) return;
    const source = new EventSource(`/api/guilds/${guildId}/player/events?page=0`);
    const handleSnapshot = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { status?: PlayerStatus };
        if (!payload.status) return;

        const status = payload.status;
        const track = status.currentTrack;
        if (!track) {
          liveClockRef.current = null;
          setLivePosition(0);
          setPlayerStatus(status);
          return;
        }

        const now = Date.now();
        const trackKey = `${track.uri}|${track.title}|${track.author}`;
        const incomingPosition = track.position || 0;
        const previousClock = liveClockRef.current;
        let stablePosition = incomingPosition;

        if (previousClock?.trackKey === trackKey) {
          const estimatedPrevious = previousClock.position +
            (previousClock.paused ? 0 : now - previousClock.capturedAt);
          const movedBackwards = incomingPosition < estimatedPrevious - 5000;

          if (status.paused && !previousClock.paused) {
            stablePosition = Math.max(incomingPosition, estimatedPrevious);
          } else if (status.paused && previousClock.paused && !movedBackwards) {
            stablePosition = previousClock.position;
          } else if (!status.paused && !movedBackwards) {
            stablePosition = Math.max(incomingPosition, estimatedPrevious);
          }
        }

        stablePosition = Math.min(track.duration || Infinity, Math.max(0, stablePosition));
        liveClockRef.current = {
          trackKey,
          position: stablePosition,
          duration: track.duration || 0,
          capturedAt: now,
          paused: status.paused,
        };
        setLivePosition(stablePosition);
        setPlayerStatus({
          ...status,
          currentTrack: {
            ...track,
            position: stablePosition,
          },
        });
      } catch {
        // Wait for the next valid snapshot.
      }
    };
    source.addEventListener('snapshot', handleSnapshot as EventListener);
    return () => source.close();
  }, [guildId, liveMode]);

  useEffect(() => {
    if (!liveMode || !playerStatus?.currentTrack) return;
    const track = playerStatus.currentTrack;
    const trackKey = `${track.uri}|${track.title}|${track.author}`;
    if (trackKey === lastLiveTrackRef.current) return;
    lastLiveTrackRef.current = trackKey;
    loadLyrics(false, '', '');
  }, [liveMode, playerStatus?.currentTrack?.uri]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!liveMode) return;
    const updatePosition = () => {
      const clock = liveClockRef.current;
      if (!clock) return;
      const elapsed = clock.paused ? 0 : Date.now() - clock.capturedAt;
      setLivePosition(Math.min(clock.duration || Infinity, clock.position + elapsed));
    };
    updatePosition();
    const timer = setInterval(updatePosition, 250);
    return () => clearInterval(timer);
  }, [liveMode]);

  const syncedLines = React.useMemo(
    () => (lyrics?.syncedLyrics ? parseSyncedLyrics(lyrics.syncedLyrics) : []),
    [lyrics?.syncedLyrics],
  );
  const activeLineIndex = syncedLines.reduce(
    (current, line, index) => (line.time <= livePosition ? index : current),
    -1,
  );

  useEffect(() => {
    if (liveMode && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLineIndex, liveMode]);

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      <div className="rounded-lg border border-border bg-bg-card p-4">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (artist.trim() && title.trim()) loadLyrics(true);
          }}
        >
          <input className={inputClass + ' w-full'} value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Artist" />
          <input className={inputClass + ' w-full'} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Track title" />
          <button type="submit" disabled={loading || !artist.trim() || !title.trim()} className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            {loading ? <Spinner /> : <Search size={16} />} Find
          </button>
        </form>
      </div>
      <div className="rounded-lg border border-border bg-bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-border bg-bg-secondary px-5 py-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[15px] font-medium"><BookOpenText size={17} /> <span className="truncate">{lyrics?.title || 'Lyrics'}</span></h3>
            {lyrics && <p className="mt-1 truncate text-xs text-text-secondary">{lyrics.artist}{lyrics.album ? ` · ${lyrics.album}` : ''}</p>}
          </div>
          <label className={`flex shrink-0 items-center gap-2 text-xs ${syncedLines.length ? 'text-text-secondary' : 'text-text-muted'}`}>
            <span>Live</span>
            <button
              type="button"
              role="switch"
              aria-checked={liveMode}
              disabled={!syncedLines.length}
              onClick={() => setLiveMode((value) => !value)}
              className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${liveMode ? 'bg-accent' : 'bg-border'}`}
            >
              <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${liveMode ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        </div>
        <div className={`p-5 sm:p-7 ${liveMode ? 'max-h-[60vh] overflow-y-auto scroll-smooth' : ''}`}>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : lyrics?.instrumental ? (
            <p className="py-10 text-center text-sm text-text-secondary">This track is marked as instrumental.</p>
          ) : lyrics && liveMode && syncedLines.length ? (
            <div className="space-y-5 py-[24vh] text-center">
              {syncedLines.map((line, index) => (
                <p
                  key={`${line.time}-${index}`}
                  ref={index === activeLineIndex ? activeLineRef : null}
                  className={`transition-all duration-300 ${
                    index === activeLineIndex
                      ? 'text-xl font-semibold text-text-primary'
                      : index < activeLineIndex
                        ? 'text-sm text-text-muted/60'
                        : 'text-base text-text-secondary'
                  }`}
                >
                  {line.text}
                </p>
              ))}
            </div>
          ) : lyrics ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-text-primary">{lyrics.plainLyrics || lyrics.syncedLyrics}</pre>
          ) : (
            <p className="py-10 text-center text-sm text-text-muted">No lyrics found for the current track. Try a manual search.</p>
          )}
        </div>
        {lyrics && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[10px] text-text-muted">
            <span>Lyrics provided by {lyrics.provider}</span>
            {lyrics.syncedLyrics && <span>{liveMode ? formatDuration(livePosition) : 'Synced lyrics available'}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerTab({ guildId, capabilities }: { guildId: string; capabilities: DashboardCapabilities }) {
  const toast = useToast();
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [queue, setQueue] = useState<{ current: QueueTrack | null; tracks: QueueTrack[]; total: number; page: number; totalPages: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ encoded?: string; title: string; author: string; uri: string; duration: number; artwork?: string }[]>([]);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [queuePage, setQueuePage] = useState(0);
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  const [selectedFilter, setSelectedFilter] = useState('');
  const [applyingFilter, setApplyingFilter] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [seekPreview, setSeekPreview] = useState<{ value: number; left: number } | null>(null);
  const [livePosition, setLivePosition] = useState(0);

  // Local state for smooth sliders
  const [localVolume, setLocalVolume] = useState<number | null>(null);
  const [localSeek, setLocalSeek] = useState<number | null>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const statusRef = useRef<PlayerStatus | null>(null);
  const lastTrackSeenAtRef = useRef(0);
  const pausedTrackKeyRef = useRef<string | null>(null);
  const pausedTrackPositionRef = useRef<number | null>(null);
  const playerClockRef = useRef<{
    trackKey: string;
    base: number;
    startedAt: number;
    duration: number;
    paused: boolean;
  }>({ trackKey: '', base: 0, startedAt: Date.now(), duration: 0, paused: true });

  const applyIncomingStatus = useCallback((incomingStatus: PlayerStatus) => {
    const previousStatus = statusRef.current;
    let nextStatus = incomingStatus;

    if (nextStatus.currentTrack) {
      const incomingTrack = nextStatus.currentTrack;
      const trackKey = `${incomingTrack.uri}|${incomingTrack.title}|${incomingTrack.author}`;

      if (nextStatus.paused) {
        if (pausedTrackKeyRef.current !== trackKey || pausedTrackPositionRef.current === null) {
          pausedTrackKeyRef.current = trackKey;
          const previousTrackKey = previousStatus?.currentTrack
            ? `${previousStatus.currentTrack.uri}|${previousStatus.currentTrack.title}|${previousStatus.currentTrack.author}`
            : null;
          pausedTrackPositionRef.current = previousTrackKey === trackKey
            ? Math.max(previousStatus?.currentTrack?.position || 0, incomingTrack.position || 0)
            : incomingTrack.position || 0;
        }

        nextStatus = {
          ...nextStatus,
          currentTrack: {
            ...incomingTrack,
            position: pausedTrackPositionRef.current,
          },
        };
      } else {
        pausedTrackKeyRef.current = trackKey;
        pausedTrackPositionRef.current = null;
        const previousTrackKey = previousStatus?.currentTrack
          ? `${previousStatus.currentTrack.uri}|${previousStatus.currentTrack.title}|${previousStatus.currentTrack.author}`
          : null;
        if (previousStatus?.paused && previousTrackKey === trackKey) {
          nextStatus = {
            ...nextStatus,
            currentTrack: {
              ...incomingTrack,
              position: Math.max(previousStatus.currentTrack?.position || 0, incomingTrack.position || 0),
            },
          };
        }
      }

      const now = Date.now();
      const incomingPosition = nextStatus.currentTrack?.position || 0;
      const previousClock = playerClockRef.current;
      let stablePosition = incomingPosition;

      if (previousClock.trackKey === trackKey) {
        const estimatedPosition = previousClock.base + (previousClock.paused ? 0 : now - previousClock.startedAt);
        const movedBackwards = incomingPosition < estimatedPosition - 5000;

        if (nextStatus.paused && !previousClock.paused) {
          stablePosition = Math.max(incomingPosition, estimatedPosition);
        } else if (nextStatus.paused && previousClock.paused && !movedBackwards) {
          stablePosition = previousClock.base;
        } else if (!nextStatus.paused && !movedBackwards) {
          stablePosition = Math.max(incomingPosition, estimatedPosition);
        }
      }

      stablePosition = Math.min(
        incomingTrack.duration || Infinity,
        Math.max(0, stablePosition),
      );
      nextStatus = {
        ...nextStatus,
        currentTrack: { ...incomingTrack, position: stablePosition },
      };
      playerClockRef.current = {
        trackKey,
        base: stablePosition,
        startedAt: now,
        duration: incomingTrack.duration || 0,
        paused: nextStatus.paused,
      };
      setLivePosition(stablePosition);
      statusRef.current = nextStatus;
      lastTrackSeenAtRef.current = Date.now();
      setStatus(nextStatus);
      return;
    }

    const withinGraceWindow = Date.now() - lastTrackSeenAtRef.current < TRACK_TRANSITION_GRACE_MS;
    if (nextStatus.connected && withinGraceWindow && previousStatus?.currentTrack) {
      nextStatus = { ...nextStatus, currentTrack: previousStatus.currentTrack };
      statusRef.current = nextStatus;
      setStatus(nextStatus);
      return;
    }

    if (!nextStatus.connected) {
      lastTrackSeenAtRef.current = 0;
    }

    pausedTrackKeyRef.current = null;
    pausedTrackPositionRef.current = null;
    playerClockRef.current = { trackKey: '', base: 0, startedAt: Date.now(), duration: 0, paused: true };
    statusRef.current = nextStatus;
    setLivePosition(0);
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const fetchData = useCallback(() => {
    apiFetch<PlayerStatus>(`/guilds/${guildId}/status`).then(applyIncomingStatus).catch(() => {});
    apiFetch<NonNullable<typeof queue>>(`/guilds/${guildId}/queue?page=${queuePage}`).then(setQueue).catch(() => {});
  }, [applyIncomingStatus, guildId, queuePage]);

  useEffect(() => {
    let source: EventSource | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let usingFallback = false;

    const startFallback = () => {
      if (usingFallback) return;
      usingFallback = true;
      fallbackInterval = setInterval(fetchData, 3000);
    };

    fetchData();

    const connect = () => {
      if (stopped) return;
      source = new EventSource(`/api/guilds/${guildId}/player/events?page=${queuePage}`);
      source.addEventListener('snapshot', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            status?: PlayerStatus;
            queue?: NonNullable<typeof queue>;
          };
          if (payload.status) applyIncomingStatus(payload.status);
          if (payload.queue) setQueue(payload.queue);
        } catch {
          // Ignore malformed stream frames and let the next snapshot repair state.
        }
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (!stopped) reconnectTimer = setTimeout(connect, 1000);
      };
    };

    if (typeof window !== 'undefined' && 'EventSource' in window) {
      connect();
    } else {
      startFallback();
    }

    return () => {
      stopped = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [applyIncomingStatus, fetchData, guildId, queuePage]);

  useEffect(() => {
    const updatePosition = () => {
      const clock = playerClockRef.current;
      if (!clock.trackKey || clock.paused || localSeek !== null) return;
      setLivePosition(Math.min(clock.duration || Infinity, clock.base + Date.now() - clock.startedAt));
    };

    updatePosition();
    const timer = setInterval(updatePosition, 250);
    return () => clearInterval(timer);
  }, [localSeek]);

  useEffect(() => {
    apiFetch<{ presets: FilterPreset[] }>(`/guilds/${guildId}/player/filters`)
      .then((res) => {
        const presets = res.presets || [];
        setFilterPresets(presets);
        if (presets.length > 0) {
          setSelectedFilter((current) => current || presets[0].value);
        }
      })
      .catch(() => {});
  }, [guildId]);

  const playerAction = useCallback(async (action: string, body?: Record<string, unknown>) => {
    const actionDescriptions: Record<string, string> = {
      play: 'Track queued in player.',
      toggle: 'Playback state changed.',
      skip: 'Track skipped.',
      stop: 'Playback stopped.',
      loop: 'Loop mode updated.',
      autoplay: 'Autoplay setting updated.',
      clearqueue: 'Queue cleared.',
      filter: 'Filter setting updated.',
      remove: 'Track removed from queue.',
      move: 'Queue order updated.',
      shuffle: 'Queue shuffled.',
      back: 'Switched to previous track.',
      pause: 'Playback paused.',
      resume: 'Playback resumed.',
    };

    const silentActions = new Set(['seek', 'volume', 'search']);

    // Optimistic UI updates to prevent flickering
    if (status) {
      const newStatus = { ...status };
      if (action === 'toggle') newStatus.paused = !newStatus.paused;
      if (action === 'toggle' && status.currentTrack) {
        const clock = playerClockRef.current;
        const position = Math.min(
          status.currentTrack.duration || Infinity,
          clock.trackKey ? clock.base + (clock.paused ? 0 : Date.now() - clock.startedAt) : status.currentTrack.position,
        );
        playerClockRef.current = {
          trackKey: clock.trackKey || `${status.currentTrack.uri}|${status.currentTrack.title}|${status.currentTrack.author}`,
          base: position,
          startedAt: Date.now(),
          duration: status.currentTrack.duration || 0,
          paused: !status.paused,
        };
        setLivePosition(position);
      }
      if (action === 'volume' && body?.volume !== undefined) newStatus.volume = body.volume as number;
      if (action === 'seek' && body?.position !== undefined && newStatus.currentTrack) {
        newStatus.currentTrack = { ...newStatus.currentTrack, position: body.position as number };
      }
      if (action === 'loop') {
        const modes = ['off', 'track', 'queue'];
        const idx = modes.indexOf(newStatus.repeatMode);
        newStatus.repeatMode = modes[(idx + 1) % modes.length];
      }
      if (action === 'autoplay' && typeof body?.enabled === 'boolean') {
        newStatus.autoplay = body.enabled as boolean;
      }
      if (action === 'filter') {
        const preset = typeof body?.preset === 'string' ? body.preset : null;
        newStatus.filters = preset && preset !== 'clear' ? preset : null;
      }
      setStatus(newStatus);
    }

    try {
      const result = await apiFetch<{ message?: string; voteSkip?: { votes: number; requiredVotes: number } | null }>(`/guilds/${guildId}/player/${action}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      // Fetch data immediately after API completes instead of timeout
      fetchData();

      if (!silentActions.has(action)) {
        const description = action === 'skip' && result.message
          ? result.message
          : actionDescriptions[action] || 'Player action completed.';
        toast.success(result.voteSkip ? 'Vote registered' : 'Action applied', description);
      }
    } catch (err) {
      console.error('Player action failed:', err);
      const errorText = err instanceof Error ? err.message : 'Unknown player action error.';
      toast.error('Player action failed', errorText);
      fetchData(); // revert on fail
    }
  }, [guildId, fetchData, status, toast]);

  const handleSearch = useCallback(async (queryOverride?: string) => {
    const query = (queryOverride ?? searchQuery).trim();
    if (!query) return;
    setSearching(true);
    try {
      const res = await apiFetch<{ tracks: { encoded?: string; title: string; author: string; uri: string; duration: number; artwork?: string }[] }>(
        `/guilds/${guildId}/player/search`,
        { method: 'POST', body: JSON.stringify({ query }) },
      );
      setSearchResults(res.tracks || []);
      setSearchedQuery(query);
    } catch {
      setSearchResults([]);
      setSearchedQuery(query);
      toast.error('Search failed', 'Could not load search results for this query.');
    } finally {
      setSearching(false);
    }
  }, [guildId, searchQuery, toast]);

  const isLikelyLink = (value: string) => /^https?:\/\//i.test(value.trim());

  const handleInputSubmit = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (searchedQuery === query) return;

    if (isLikelyLink(query)) {
      setSearching(true);
      try {
        await playerAction('play', { query });
        setSearchQuery('');
        setSearchResults([]);
        setSearchedQuery('');
      } finally {
        setSearching(false);
      }
      return;
    }

    await handleSearch(query);
  }, [handleSearch, playerAction, searchQuery, searchedQuery]);

  const handleUploadFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;

    const allowedExtensions = /\.(mp3|flac|wav|ogg|m4a|aac|opus|webm)$/i;
    if (!allowedExtensions.test(file.name)) {
      toast.error('Upload failed', 'Unsupported audio file type.');
      e.target.value = '';
      return;
    }

    if (file.size > 256 * 1024 * 1024) {
      toast.error('Upload failed', 'Maximum audio upload size is 256MB.');
      e.target.value = '';
      return;
    }

    setUploadFile(file);
  }, [toast]);

  const handleUploadSubmit = useCallback(async () => {
    if (!uploadFile) {
      uploadInputRef.current?.click();
      return;
    }

    setUploading(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/player/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': uploadFile.type || 'application/octet-stream',
          // HTTP header values are ASCII-only in browsers; keep the original name encoded.
          'X-File-Name': encodeURIComponent(uploadFile.name),
        },
        body: uploadFile,
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || `Upload failed: ${res.status}`);
      }

      toast.success('Upload queued', payload.title || uploadFile.name);
      setUploadFile(null);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
      fetchData();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not upload audio file.';
      toast.error('Upload failed', text);
    } finally {
      setUploading(false);
    }
  }, [fetchData, guildId, toast, uploadFile]);

  const handleApplyFilter = useCallback(async () => {
    if (!selectedFilter) return;
    setApplyingFilter(true);
    try {
      await playerAction('filter', { preset: selectedFilter });
    } finally {
      setApplyingFilter(false);
    }
  }, [playerAction, selectedFilter]);

  const handleClearQueue = useCallback(async () => {
    if (!confirm('Clear the entire upcoming queue?')) return;
    await playerAction('clearqueue');
    setQueue((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tracks: [],
        total: 0,
        totalPages: 0,
      };
    });
  }, [playerAction]);

  const handleVolumeCommit = (vol: number) => {
    playerAction('volume', { volume: vol });
    setTimeout(() => setLocalVolume(null), 100);
  };

  const handleSeekCommit = (pos: number) => {
    const track = status?.currentTrack;
    if (track) {
      playerClockRef.current = {
        trackKey: `${track.uri}|${track.title}|${track.author}`,
        base: pos,
        startedAt: Date.now(),
        duration: track.duration || 0,
        paused: status.paused,
      };
      setLivePosition(pos);
    }
    if (status?.paused && track) {
      pausedTrackKeyRef.current = `${track.uri}|${track.title}|${track.author}`;
      pausedTrackPositionRef.current = pos;
    }
    playerAction('seek', { position: pos });
    setTimeout(() => setLocalSeek(null), 100);
  };

  const resetDragState = useCallback(() => {
    setDraggedIdx(null);
    setDropTargetIdx(null);
  }, []);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedIdx(idx);
    setDropTargetIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetIdx(idx);
  };

  const handleDrop = async (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (!queue || draggedIdx === null || draggedIdx === targetIdx) {
      resetDragState();
      return;
    }

    const previousQueue = queue;
    const newQueue = [...queue.tracks];
    const item = newQueue.splice(draggedIdx, 1)[0];
    newQueue.splice(targetIdx, 0, item);
    setQueue({ ...queue, tracks: newQueue });
    resetDragState();

    try {
      await apiFetch(`/guilds/${guildId}/player/move`, {
        method: 'POST',
        body: JSON.stringify({ from: queuePage * 20 + draggedIdx, to: queuePage * 20 + targetIdx }),
      });
      toast.success('Action applied', 'Queue order updated.');
      fetchData();
    } catch (err) {
      setQueue(previousQueue);
      const errorText = err instanceof Error ? err.message : 'Could not reorder queue.';
      toast.error('Player action failed', errorText);
      fetchData();
    }
  };

  if (!status) return (
    <div className="space-y-5 w-full max-w-6xl mx-auto">
      <div className="bg-bg-card rounded-lg border border-border p-5">
        <div className="flex gap-5">
          <Skeleton className="w-24 h-24 rounded-lg" />
          <div className="flex-1 space-y-3 pt-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-2 w-full mt-6" />
          </div>
        </div>
        <div className="flex justify-center gap-3 mt-8">
          <Skeleton className="w-10 h-10 rounded-full" />
          <Skeleton className="w-10 h-10 rounded-full" />
          <Skeleton className="w-10 h-10 rounded-full" />
        </div>
      </div>
    </div>
  );

  const currentDuration = status.currentTrack?.duration || 0;
  const currentPos = localSeek !== null ? localSeek : livePosition;
  const hasCurrentTrack = Boolean(status.connected && status.currentTrack);
  const canUsePlayerControls = Boolean(status.connected);
  const canControlTrack = Boolean(status.connected && status.currentTrack);
  const canUseDJControls = capabilities.accessLevel !== 'member';
  const canSeekTrack = Boolean(canUseDJControls && canControlTrack && status.currentTrack?.seekable);

  const updateSeekPreview = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    if (!canSeekTrack || !currentDuration) {
      setSeekPreview(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = 'touches' in e
      ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX ?? rect.left
      : e.clientX;
    const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setSeekPreview({
      value: Math.round(progress * currentDuration),
      left: progress * 100,
    });
  };

  return (
    <div className="space-y-5 w-full max-w-6xl mx-auto">
      <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
        <div className="p-5">
          <div className="flex gap-5">
            {status.currentTrack?.artwork ? (
              <img src={status.currentTrack.artwork} alt="" className="w-24 h-24 rounded-lg object-cover shadow-xl" />
            ) : (
              <div className="w-24 h-24 rounded-lg bg-bg-hover flex items-center justify-center border border-border/70">
                <Music2 size={32} className="text-text-muted" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              {hasCurrentTrack && status.currentTrack ? (
                <>
                  <p className="font-medium text-base truncate">{status.currentTrack.title}</p>
                  <p className="text-sm text-text-secondary truncate mt-0.5">{status.currentTrack.author}</p>
                  <div className="mt-4 group/slider">
                    <div className="relative">
                      {seekPreview && canSeekTrack && (
                        <div
                          className="pointer-events-none absolute -top-8 z-10 rounded bg-bg-primary border border-border px-1.5 py-0.5 text-[11px] font-medium text-text-primary shadow-lg tabular-nums"
                          style={{ left: `${seekPreview.left}%`, transform: 'translateX(-50%)' }}
                        >
                          {formatDuration(seekPreview.value)}
                        </div>
                      )}
                      <input
                        type="range"
                        min={0}
                        max={currentDuration}
                        value={currentPos}
                        onChange={(e) => setLocalSeek(Number(e.target.value))}
                        onMouseMove={updateSeekPreview}
                        onMouseLeave={() => setSeekPreview(null)}
                        onTouchMove={updateSeekPreview}
                        onTouchEnd={(e) => {
                          updateSeekPreview(e);
                          handleSeekCommit(Number((e.target as HTMLInputElement).value));
                          setSeekPreview(null);
                        }}
                        onMouseUp={(e) => handleSeekCommit(Number((e.target as HTMLInputElement).value))}
                        disabled={!canSeekTrack}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-border transition-all duration-200 hover:h-2 disabled:cursor-not-allowed disabled:opacity-60
                          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(90,84,148,0.6)] [&::-webkit-slider-thumb]:opacity-0 hover:[&::-webkit-slider-thumb]:opacity-100 [&::-webkit-slider-thumb]:transition-opacity
                          [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:shadow-[0_0_10px_rgba(90,84,148,0.6)] [&::-moz-range-thumb]:opacity-0 hover:[&::-moz-range-thumb]:opacity-100"
                        style={{ background: `linear-gradient(to right, #5a5494 ${currentDuration > 0 ? (currentPos / currentDuration) * 100 : 0}%, rgba(255,255,255,0.05) 0)` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-text-muted mt-1.5 tabular-nums">
                      <span>{formatDuration(currentPos)}</span>
                      <span>{formatDuration(currentDuration)}</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p className="font-medium text-base">
                    {status.connected ? 'Nothing is playing right now.' : 'Bot is not connected.'}
                  </p>
                  <p className="text-sm text-text-secondary mt-0.5">
                    {status.connected
                      ? 'Use Play / Search below to queue a track.'
                      : 'Use /play in Discord to connect and start playback.'}
                  </p>
                  <div className="mt-4 space-y-2">
                    <Skeleton className="h-1.5 w-full" />
                    <div className="flex justify-between">
                      <Skeleton className="h-3 w-10" />
                      <Skeleton className="h-3 w-10" />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 mt-6">
            <CtrlBtn
              onClick={() => playerAction('shuffle')}
              title="Shuffle"
              disabled={!canUseDJControls || !canUsePlayerControls || !queue || queue.tracks.length === 0}
            >
              <Shuffle size={16} />
            </CtrlBtn>
            <CtrlBtn onClick={() => playerAction('back')} title="Previous" disabled={!canUseDJControls || !canControlTrack}>
              <SkipBack size={16} />
            </CtrlBtn>
            <CtrlBtn onClick={() => playerAction('toggle')} title={status.paused ? 'Play' : 'Pause'} primary disabled={!canControlTrack}>
              {status.paused ? <Play size={18} /> : <Pause size={18} />}
            </CtrlBtn>
            <CtrlBtn onClick={() => playerAction('skip')} title={status.voteSkip ? `Vote skip ${status.voteSkip.votes}/${status.voteSkip.requiredVotes}` : 'Skip'} disabled={!canControlTrack}>
              <SkipForward size={16} />
            </CtrlBtn>
            <CtrlBtn onClick={() => playerAction('stop')} title="Stop" disabled={!canUseDJControls || !canControlTrack}>
              <Square size={14} />
            </CtrlBtn>
            <CtrlBtn onClick={() => playerAction('loop')} title="Loop" badge={status.repeatMode !== 'off' ? (status.repeatMode === 'track' ? '1' : 'A') : undefined} disabled={!canUseDJControls || !canControlTrack}>
              <Repeat size={16} />
            </CtrlBtn>
          </div>

          <div className={`flex items-center gap-4 mt-5 px-1 ${canUsePlayerControls && canUseDJControls ? '' : 'opacity-45 pointer-events-none'}`}>
            <Volume2 size={18} className="text-text-muted shrink-0" />
            <div className="flex-1 flex justify-center items-center">
              <SegmentedVolume
                value={localVolume !== null ? localVolume : status.volume}
                onChange={(v) => setLocalVolume(v)}
                onCommit={(v) => handleVolumeCommit(v)}
              />
            </div>
            <span className="text-xs font-medium text-text-secondary w-12 shrink-0 text-center tabular-nums bg-bg-hover px-1.5 py-1 rounded-md">{localVolume !== null ? localVolume : status.volume}%</span>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => playerAction('autoplay', { enabled: !status.autoplay })}
              disabled={!canUseDJControls || !canUsePlayerControls}
              className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${status.autoplay ? 'bg-success/15 text-success border border-success/30 hover:bg-success/20' : 'bg-bg-input text-text-secondary border border-border hover:text-text-primary hover:border-accent/30'}`}
            >
              <Activity size={15} />
              Autoplay: {status.autoplay ? 'ON' : 'OFF'}
            </button>

            <div className="flex gap-2">
              <select
                value={selectedFilter}
                onChange={(e) => setSelectedFilter(e.target.value)}
                disabled={!canUseDJControls || !canUsePlayerControls}
                className={selectClass + ' flex-1 min-w-0 disabled:opacity-50'}
              >
                {filterPresets.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <button
                onClick={handleApplyFilter}
                disabled={applyingFilter || !selectedFilter || !canUseDJControls || !canUsePlayerControls}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-bg-input border border-border text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title="Apply filter preset"
              >
                <SlidersHorizontal size={14} />
                Apply
              </button>
              <button
                onClick={() => playerAction('filter', { preset: 'clear' })}
                disabled={!canUseDJControls || !canUsePlayerControls}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-danger/10 border border-danger/25 text-danger hover:bg-danger/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title="Clear filter"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {status.connected && (
        <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3.5 border-b border-border">
            <h3 className="text-[15px] font-medium">Play / Search</h3>
          </div>
          <div className="p-5">
            <div className="flex gap-2">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInputSubmit()}
                placeholder="Paste link or search title..."
                className="flex-1 rounded-md border border-border bg-bg-input text-text-primary px-4 py-2.5 text-sm outline-none placeholder:text-text-muted focus:border-accent transition-colors font-[inherit]"
              />
              <button
                onClick={handleInputSubmit}
                disabled={searching}
                className="px-4 py-2.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
              >
                {searching ? <Spinner /> : <Search size={16} />}
              </button>
            </div>
            <p className="text-xs text-text-muted mt-2">Link starts playback immediately. Text query shows quick search results.</p>

            {capabilities.canUpload && <div className="mt-4 rounded-md border border-border bg-bg-secondary/40 p-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".mp3,.flac,.wav,.ogg,.m4a,.aac,.opus,.webm,audio/*"
                  className="hidden"
                  onChange={handleUploadFileChange}
                />
                <button
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-bg-input border border-border text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-sm"
                >
                  <FileAudio size={15} />
                  Choose Audio
                </button>
                <div className="flex-1 min-w-0">
                  {uploadFile ? (
                    <>
                      <p className="text-sm text-text-primary truncate">{uploadFile.name}</p>
                      <p className="text-xs text-text-muted">{formatFileSize(uploadFile.size)}</p>
                    </>
                  ) : (
                    <p className="text-sm text-text-muted truncate">No audio file selected</p>
                  )}
                </div>
                <button
                  onClick={handleUploadSubmit}
                  disabled={uploading}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-sm"
                >
                  {uploading ? <Spinner /> : <Upload size={15} />}
                  {uploading ? 'Uploading...' : 'Queue Upload'}
                </button>
              </div>
            </div>}

            {searchResults.length > 0 && (
              <div className="mt-3 rounded-md overflow-hidden border border-border">
                {searchResults.map((track, i) => (
                  <button
                    key={`${track.uri}-${i}`}
                    onClick={() => {
                      playerAction('play', {
                        encoded: track.encoded,
                        query: track.encoded ? undefined : track.uri || `${track.author} ${track.title}`,
                        track: {
                          title: track.title,
                          author: track.author,
                          uri: track.uri,
                          duration: track.duration,
                          artwork: track.artwork,
                        },
                      });
                      setSearchResults([]);
                      setSearchQuery('');
                      setSearchedQuery('');
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors text-left cursor-pointer border-b border-border/50 last:border-0"
                  >
                    {track.artwork ? (
                      <img src={track.artwork} alt="" className="w-8 h-8 rounded shrink-0 object-cover" />
                    ) : (
                      <span className="text-xs text-text-muted w-5 tabular-nums text-center">{i + 1}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{track.title}</p>
                      <p className="text-xs text-text-muted truncate">{track.author}</p>
                    </div>
                    <span className="text-xs text-text-muted tabular-nums">{formatDuration(track.duration)}</span>
                  </button>
                ))}
              </div>
            )}
            {!searching && searchedQuery === searchQuery.trim() && searchedQuery && searchResults.length === 0 && (
              <div className="mt-3 rounded-md border border-border bg-bg-secondary/40 px-4 py-5 text-center text-sm text-text-muted">
                No results found. Try another title or artist, or paste a direct track link.
              </div>
            )}
          </div>
        </div>
      )}

      {status.connected && queue && (
        <div className="bg-bg-card rounded-lg border border-border overflow-hidden">
          <div className="bg-bg-secondary px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h3 className="text-[15px] font-medium">
              Queue
              <span className="text-text-muted font-normal ml-2 text-sm">{queue.total} tracks</span>
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearQueue}
                disabled={!canUseDJControls || queue.total === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer text-xs"
              >
                <Trash2 size={13} />
                Clear
              </button>
              {queue.totalPages > 1 && (
                <div className="flex items-center gap-1">
                <button
                  onClick={() => setQueuePage(Math.max(0, queuePage - 1))}
                  disabled={queuePage === 0}
                  className="p-1 rounded hover:bg-bg-hover disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-text-muted tabular-nums px-1">{queuePage + 1}/{queue.totalPages}</span>
                <button
                  onClick={() => setQueuePage(Math.min(queue.totalPages - 1, queuePage + 1))}
                  disabled={queuePage >= queue.totalPages - 1}
                  className="p-1 rounded hover:bg-bg-hover disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              )}
            </div>
          </div>

          <div className="p-5">
            {queue.current && (
              <div className="mb-2 px-3 py-2.5 rounded-md bg-accent/10 border border-accent/20 flex items-center gap-3">
                {queue.current.artwork ? (
                  <img src={queue.current.artwork} alt="" className="w-8 h-8 rounded shrink-0 object-cover" />
                ) : (
                  <Play size={14} className="text-accent shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{queue.current.title}</p>
                  <p className="text-xs text-text-muted truncate">
                    {queue.current.author}
                    {queue.current.requester ? ` • Requested by ${queue.current.requester}` : ''}
                  </p>
                </div>
                <span className="text-xs text-text-muted tabular-nums">{formatDuration(queue.current.duration)}</span>
              </div>
            )}

            {queue.tracks.length === 0 && (
              <p className="text-sm text-text-muted text-center py-6">Queue is empty</p>
            )}

            <div className="space-y-0.5">
              {queue.tracks.map((track, i) => (
                <div 
                  key={`${track.uri}-${i}`} 
                  draggable={canUseDJControls}
                  onDragStart={(e) => canUseDJControls && handleDragStart(e, i)}
                  onDragEnter={(e) => canUseDJControls && handleDragOver(e, i)}
                  onDragOver={(e) => canUseDJControls && handleDragOver(e, i)}
                  onDrop={(e) => canUseDJControls && handleDrop(e, i)}
                  onDragEnd={resetDragState}
                  className={`group flex items-center gap-3 px-3 py-2 border rounded-md hover:bg-bg-hover/50 transition-colors ${canUseDJControls ? 'cursor-grab active:cursor-grabbing' : ''} ${
                    dropTargetIdx === i && draggedIdx !== i
                      ? 'border-accent/70 bg-accent/10'
                      : 'border-transparent'
                  } ${draggedIdx === i ? 'opacity-50' : ''}`}
                >
                  {canUseDJControls && <div className="flex items-center justify-center w-5 text-text-muted cursor-move opacity-50 hover:opacity-100">
                    <GripVertical size={14} />
                  </div>}
                  {track.artwork ? (
                    <img src={track.artwork} alt="" className="w-8 h-8 rounded shrink-0 object-cover" />
                  ) : (
                    <span className="text-xs text-text-muted w-4 ml-1 tabular-nums flex-shrink-0">{queuePage * 20 + i + 1}</span>
                  )}
                  <div className="flex-1 min-w-0 ml-1">
                    <p className="text-sm truncate select-none">{track.title}</p>
                    <p className="text-xs text-text-muted truncate select-none">
                      {track.author}
                      {track.requester ? ` • Requested by ${track.requester}` : ''}
                    </p>
                  </div>
                  <span className="text-xs text-text-muted tabular-nums">{formatDuration(track.duration)}</span>
                  
                  {/* Remove Track Button */}
                  {canUseDJControls && <button
                     onClick={() => playerAction('remove', { start: queuePage * 20 + i })}
                     className="p-1.5 ml-2 text-text-muted hover:text-danger hover:bg-danger/10 rounded-md transition-colors opacity-70 group-hover:opacity-100"
                     title="Remove track"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CtrlBtn({ onClick, title, primary, badge, disabled, children }: {
  onClick: () => void;
  title: string;
  primary?: boolean;
  badge?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all ${
        disabled
          ? 'opacity-35 cursor-not-allowed'
          : primary
            ? 'bg-accent text-white hover:bg-accent-hover shadow-lg shadow-accent/30 cursor-pointer'
            : 'bg-bg-hover text-text-secondary hover:bg-border hover:text-text-primary border border-border cursor-pointer'
      }`}
    >
      {children}
      {badge && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent text-[9px] text-white flex items-center justify-center font-bold leading-none">
          {badge}
        </span>
      )}
    </button>
  );
}

function EconomyTab({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [leaderboard, setLeaderboard] = useState<EconomyLeaderboardEntry[]>([]);
  const [members, setMembers] = useState<EconomyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [mode, setMode] = useState<'add' | 'remove' | 'set'>('add');
  const [amount, setAmount] = useState(100);

  const fetchEconomy = useCallback(() => {
    Promise.allSettled([
      apiFetch<{ entries: EconomyLeaderboardEntry[] }>(`/guilds/${guildId}/economy/leaderboard?limit=20`),
      apiFetch<{ members: EconomyMember[] }>(`/guilds/${guildId}/economy/members?limit=120`),
    ])
      .then(([leaderboardRes, membersRes]) => {
        if (leaderboardRes.status === 'fulfilled') {
          setLeaderboard(leaderboardRes.value.entries || []);
        }
        if (membersRes.status === 'fulfilled') {
          const list = membersRes.value.members || [];
          setMembers(list);
          if (!selectedUserId && list.length > 0) {
            setSelectedUserId(list[0].userId);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [guildId, selectedUserId]);

  useEffect(() => {
    fetchEconomy();
    const interval = setInterval(fetchEconomy, 15000);
    return () => clearInterval(interval);
  }, [fetchEconomy]);

  const selectedUser = members.find((member) => member.userId === selectedUserId) || null;

  const adjustBalance = useCallback(async () => {
    if (!selectedUserId) return;
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Invalid amount', 'Amount must be 0 or higher.');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<{ success: boolean; balance: number }>(`/guilds/${guildId}/economy/adjust`, {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUserId, mode, amount: Math.floor(amount) }),
      });
      toast.success('Balance updated', `New balance: ${res.balance.toLocaleString()} bread.`);
      fetchEconomy();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to update balance';
      toast.error('Balance update failed', text);
    } finally {
      setSaving(false);
    }
  }, [amount, fetchEconomy, guildId, mode, selectedUserId, toast]);

  if (loading) {
    return (
      <div className="space-y-5 w-full max-w-6xl mx-auto">
        <div className="bg-bg-card rounded-lg border border-border p-5">
          <Skeleton className="h-5 w-1/3 mb-4" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 w-full max-w-6xl mx-auto">
      <Section title="Economy Leaderboard">
        {leaderboard.length === 0 ? (
          <p className="text-sm text-text-muted">No economy data for this guild yet.</p>
        ) : (
          <div className="space-y-1">
            {leaderboard.map((entry) => (
              <div key={entry.userId} className="flex items-center gap-3 px-3 py-2 rounded-md border border-border/50 bg-bg-secondary/40">
                <span className="w-8 text-xs tabular-nums text-text-muted">#{entry.rank}</span>
                {entry.avatar ? (
                  <img src={entry.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-bg-hover flex items-center justify-center text-xs text-text-muted">{entry.displayName.charAt(0).toUpperCase()}</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.displayName}</p>
                  <p className="text-xs text-text-muted truncate">{entry.username}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-accent">{entry.balance.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Manage Balance">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Member</label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className={selectClass + ' w-full max-w-md'}
            >
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName} ({member.balance.toLocaleString()} bread)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'add' | 'remove' | 'set')}
                className={selectClass + ' w-full'}
              >
                <option value="add">Add</option>
                <option value="remove">Remove</option>
                <option value="set">Set</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Amount</label>
              <input
                type="number"
                min={0}
                step={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className={inputClass + ' w-full'}
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={adjustBalance}
                disabled={saving || !selectedUserId}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Coins size={15} />
                {saving ? 'Saving...' : 'Apply'}
              </button>
            </div>
          </div>

          {selectedUser && (
            <p className="text-xs text-text-muted">
              Current balance for {selectedUser.displayName}: <span className="text-text-secondary font-medium">{selectedUser.balance.toLocaleString()} bread</span>
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}

interface DiscordRole {
  id: string;
  name: string;
  color: string;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

interface DiscordMember {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

interface ChatMessage {
  id: string;
  content: string;
  author: {
    username: string;
    avatar: string | null;
    bot: boolean;
  };
  timestamp: number;
  attachments?: {
    url: string;
    name: string;
    contentType: string | null;
    width: number | null;
    height: number | null;
  }[];
  embeds?: {
    title: string | null;
    description: string | null;
    url: string | null;
    image: string | null;
    provider: string | null;
  }[];
  mentions?: {
    users?: { id: string; label: string }[];
    roles?: { id: string; label: string }[];
    channels?: { id: string; label: string }[];
  };
}

function ControlTab({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [members, setMembers] = useState<DiscordMember[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [memberMentionQuery, setMemberMentionQuery] = useState('');
  const [roleMentionQuery, setRoleMentionQuery] = useState('');
  const [attachment, setAttachment] = useState<{ name: string, base64: string } | null>(null);
  const [selectedTextId, setSelectedTextId] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [mentionConfirmOpen, setMentionConfirmOpen] = useState(false);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    Promise.allSettled([
      apiFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`),
      apiFetch<DiscordRole[]>(`/guilds/${guildId}/roles`),
    ])
      .then(([channelsRes, rolesRes]) => {
        const channelList = channelsRes.status === 'fulfilled' ? channelsRes.value : [];
        setChannels(channelList);
        if (rolesRes.status === 'fulfilled') {
          setRoles((rolesRes.value || []).filter((role) => role.name !== '@everyone'));
        }
        if (channelList.length > 0) {
          const text = channelList.find(c => c.type === 0 || c.type === 5);
          const voice = channelList.find(c => c.type === 2 || c.type === 13);
          if (text) setSelectedTextId(text.id);
          if (voice) setSelectedVoiceId(voice.id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [guildId]);

  useEffect(() => {
    const query = memberMentionQuery.trim();
    if (query.length < 2) {
      setMembers([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      apiFetch<{ members: DiscordMember[] }>(`/guilds/${guildId}/members?q=${encodeURIComponent(query)}&limit=8`, {
        signal: controller.signal,
      })
        .then((res) => {
          if (!cancelled) setMembers(res.members || []);
        })
        .catch(() => {
          if (!cancelled && !controller.signal.aborted) setMembers([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [guildId, memberMentionQuery]);

  useEffect(() => {
    if (!selectedTextId) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchMsgs = () => {
      controller?.abort();
      controller = new AbortController();
      apiFetch<ChatMessage[]>(`/guilds/${guildId}/control/messages?channelId=${selectedTextId}`, {
        signal: controller.signal,
      })
        .then(res => { if (!stopped) setChatMessages(res); })
        .catch(() => {});
    };

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const startPolling = () => {
      stopPolling();
      if (!document.hidden) interval = setInterval(fetchMsgs, 10_000);
    };

    fetchMsgs();
    startPolling();
    const handleVisibilityChange = () => {
      if (document.hidden) stopPolling();
      else {
        fetchMsgs();
        startPolling();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopped = true;
      stopPolling();
      controller?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [guildId, selectedTextId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Attachment too large', 'Maximum upload size is 8MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result && typeof ev.target.result === 'string') {
        setAttachment({
          name: file.name,
          base64: ev.target.result
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const insertMessageSnippet = (before: string, after = '') => {
    const input = messageInputRef.current;
    const start = input?.selectionStart ?? messageText.length;
    const end = input?.selectionEnd ?? messageText.length;
    const selected = messageText.slice(start, end);
    const next = `${messageText.slice(0, start)}${before}${selected}${after}${messageText.slice(end)}`;
    setMessageText(next);
    requestAnimationFrame(() => {
      input?.focus();
      const cursor = selected
        ? start + before.length + selected.length + after.length
        : start + before.length;
      input?.setSelectionRange(cursor, cursor);
    });
  };

  const sendAction = async (action: 'say' | 'summon' | 'leave', options: { skipMentionConfirm?: boolean } = {}) => {
    setActioning(true);
    try {
      if (action === 'say') {
        if (!selectedTextId || (!messageText.trim() && !attachment)) return;
        if (!options.skipMentionConfirm && /(^|\s)@(everyone|here)(\s|$)/i.test(messageText)) {
          setMentionConfirmOpen(true);
          return;
        }
        await apiFetch(`/guilds/${guildId}/control/say`, {
          method: 'POST',
          body: JSON.stringify({ 
            channelId: selectedTextId, 
            message: messageText,
            attachmentBase64: attachment?.base64,
            attachmentName: attachment?.name,
            allowedMentions: { users: true, roles: true, everyone: true },
          })
        });
        setMessageText('');
        setAttachment(null);
        setMentionConfirmOpen(false);
        toast.success('Message sent', 'Bot message was sent to the selected channel.');
      } else {
        await apiFetch(`/guilds/${guildId}/control/action`, {
          method: 'POST',
          body: JSON.stringify({ type: action, channelId: selectedVoiceId || undefined })
        });

        if (action === 'summon') {
          toast.success('Bot summoned', 'Bot joined the selected voice channel.');
        } else if (action === 'leave') {
          toast.success('Bot disconnected', 'Bot left the voice channel.');
        }
      }
    } catch (err) {
      console.error(err);
      const text = err instanceof Error ? err.message : 'Control action failed.';
      toast.error('Control action failed', text);
    } finally {
      setActioning(false);
    }
  };

  if (loading) return (
    <div className="space-y-5 w-full max-w-6xl mx-auto">
      <div className="bg-bg-card rounded-lg border border-border p-5">
        <Skeleton className="h-5 w-1/3 mb-4" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );

  const textChannels = channels.filter(c => c.type === 0 || c.type === 5);
  const voiceChannels = channels.filter(c => c.type === 2 || c.type === 13);
  const memberMentionResults = memberMentionQuery.trim()
    ? members
        .slice(0, 6)
    : [];
  const roleMentionResults = roleMentionQuery.trim()
    ? roles
        .filter((role) => role.name.toLowerCase().includes(roleMentionQuery.trim().toLowerCase()))
        .slice(0, 6)
    : [];

  const renderMessageContent = (message: ChatMessage) => {
    if (!message.content) return null;
    const mentionLabels = new Map<string, string>();
    const mentions = message.mentions || {};
    (mentions.users || []).forEach((user) => mentionLabels.set(`<@${user.id}>`, `@${user.label}`));
    (mentions.users || []).forEach((user) => mentionLabels.set(`<@!${user.id}>`, `@${user.label}`));
    (mentions.roles || []).forEach((role) => mentionLabels.set(`<@&${role.id}>`, `@${role.label}`));
    (mentions.channels || []).forEach((channel) => mentionLabels.set(`<#${channel.id}>`, `#${channel.label}`));

    const pattern = /(<@!?\d+>|<@&\d+>|<#\d+>|https?:\/\/[^\s<]+)/g;
    return message.content.split(pattern).map((part, index) => {
      if (!part) return null;
      const mentionLabel = mentionLabels.get(part);
      if (mentionLabel) {
        return (
          <span key={index} className="inline-flex items-center rounded bg-accent/15 px-1 py-0.5 font-medium text-accent">
            {mentionLabel}
          </span>
        );
      }
      if (/^https?:\/\//i.test(part)) {
        return (
          <a key={index} href={part} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const isImageAttachment = (attachment: NonNullable<ChatMessage['attachments']>[number]) =>
    attachment.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(attachment.url);
  const isVideoAttachment = (attachment: NonNullable<ChatMessage['attachments']>[number]) =>
    attachment.contentType?.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(attachment.url);

  return (
    <div className="grid grid-cols-1 gap-4 w-full max-w-6xl mx-auto lg:grid-cols-2 lg:items-stretch lg:gap-6">
      <div className="space-y-4 lg:space-y-6">
        <Section title="Send Message">
          <div className="flex min-h-0 flex-col gap-3 sm:gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Destination Channel</label>
            <select
              value={selectedTextId}
              onChange={(e) => setSelectedTextId(e.target.value)}
              className={selectClass + " w-full"}
            >
              {textChannels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Message Content</label>
            <div className="mb-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => insertMessageSnippet('**', '**')}
                title="Bold"
                className="p-2 rounded-md border border-border bg-bg-input text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer"
              >
                <Bold size={14} />
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('*', '*')}
                title="Italic"
                className="p-2 rounded-md border border-border bg-bg-input text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer"
              >
                <Italic size={14} />
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('`', '`')}
                title="Inline code"
                className="p-2 rounded-md border border-border bg-bg-input text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer"
              >
                <Code2 size={14} />
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('```\n', '\n```')}
                title="Code block"
                className="px-2 py-2 rounded-md border border-border bg-bg-input text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer sm:px-2.5"
              >
                ```
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('||', '||')}
                title="Spoiler"
                className="px-2 py-2 rounded-md border border-border bg-bg-input text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer sm:px-2.5"
              >
                ||
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('> ')}
                title="Quote"
                className="px-2 py-2 rounded-md border border-border bg-bg-input text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer sm:px-2.5"
              >
                &gt;
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet(`<#${selectedTextId}>`)}
                title="Mention selected channel"
                className="p-2 rounded-md border border-border bg-bg-input text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer"
              >
                <Hash size={14} />
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('@everyone')}
                title="Mention everyone"
                className="px-2 py-2 rounded-md border border-border bg-bg-input text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer sm:px-2.5"
              >
                @everyone
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('@here')}
                title="Mention online members"
                className="px-2 py-2 rounded-md border border-border bg-bg-input text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer sm:px-2.5"
              >
                @here
              </button>
            </div>
            <div className="mb-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="relative">
                <div className="relative">
                  <AtSign size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    value={memberMentionQuery}
                    onChange={(e) => setMemberMentionQuery(e.target.value)}
                    placeholder="Search user to mention"
                    className="w-full rounded-md border border-border bg-bg-input text-text-primary pl-8 pr-3 py-2 text-xs outline-none focus:border-accent transition-colors placeholder:text-text-muted"
                  />
                </div>
                {memberMentionResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-bg-card shadow-xl overflow-hidden">
                    {memberMentionResults.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => {
                          insertMessageSnippet(`<@${member.id}>`);
                          setMemberMentionQuery('');
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                      >
                        {member.avatar ? (
                          <img src={member.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                        ) : (
                          <span className="w-5 h-5 rounded-full bg-bg-hover flex items-center justify-center text-[10px]">{member.displayName.charAt(0).toUpperCase()}</span>
                        )}
                        <span className="truncate">{member.displayName}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <div className="relative">
                  <AtSign size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    value={roleMentionQuery}
                    onChange={(e) => setRoleMentionQuery(e.target.value)}
                    placeholder="Search role to mention"
                    className="w-full rounded-md border border-border bg-bg-input text-text-primary pl-8 pr-3 py-2 text-xs outline-none focus:border-accent transition-colors placeholder:text-text-muted"
                  />
                </div>
                {roleMentionResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-bg-card shadow-xl overflow-hidden">
                    {roleMentionResults.map((role) => (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => {
                          insertMessageSnippet(`<@&${role.id}>`);
                          setRoleMentionQuery('');
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color || '#6b7280' }} />
                        <span className="truncate">{role.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <textarea
              ref={messageInputRef}
              rows={4}
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              placeholder="Type a message for the bot to send..."
              className="max-h-44 min-h-24 w-full rounded-md border border-border bg-bg-input text-text-primary px-4 py-3 text-sm outline-none focus:border-accent transition-colors placeholder:text-text-muted font-[inherit] resize-y sm:max-h-48 sm:min-h-28"
            />
          </div>

          {attachment && (
            <div className="flex min-w-0 items-center gap-2 px-3 py-2 bg-accent/10 border border-accent/20 rounded-md text-sm text-text-primary">
              <span className="min-w-0 truncate flex-1 font-medium"><span className="text-accent">Attachment:</span> {attachment.name}</span>
              <button 
                onClick={() => setAttachment(null)} 
                className="shrink-0 hover:text-danger transition-colors cursor-pointer"
                type="button"
                title="Remove attachment"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto] gap-3 pt-1">
            <button
              type="button"
              onClick={() => sendAction('say')}
              disabled={actioning || (!messageText.trim() && !attachment)}
              className="inline-flex min-w-0 items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-accent/20 sm:px-5"
            >
              <MessageSquare size={16} />
              {actioning ? 'Sending...' : 'Send as Bot'}
            </button>
            <label className="flex items-center justify-center px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-secondary hover:text-text-primary hover:border-accent transition-colors cursor-pointer group">
              <Paperclip size={16} className="group-hover:scale-110 transition-transform" />
              <input type="file" className="hidden" onChange={handleFileChange} accept="*/*" />
            </label>
          </div>
        </div>
      </Section>

      {mentionConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-bg-card shadow-2xl">
            <div className="border-b border-border bg-bg-secondary px-5 py-4">
              <h3 className="text-base font-semibold text-text-primary">Send server-wide mention?</h3>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-sm leading-relaxed text-text-secondary">
                This message contains <span className="font-semibold text-accent">@everyone</span> or <span className="font-semibold text-accent">@here</span>.
                It may notify many people in the selected channel.
              </p>
              <div className="rounded-md border border-border bg-bg-input px-3 py-2 text-xs text-text-muted">
                #{textChannels.find((channel) => channel.id === selectedTextId)?.name || 'selected channel'}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-3 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={() => setMentionConfirmOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => sendAction('say', { skipMentionConfirm: true })}
                disabled={actioning}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {actioning ? 'Sending...' : 'Send anyway'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Section title="Voice Connection">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Voice Channel</label>
            <select
              value={selectedVoiceId}
              onChange={(e) => setSelectedVoiceId(e.target.value)}
              className={selectClass + " w-full"}
            >
              {voiceChannels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
             <button
              onClick={() => sendAction('summon')}
              disabled={actioning || !selectedVoiceId}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all shadow-lg shadow-accent/20 disabled:opacity-50 cursor-pointer sm:px-6"
            >
              <Mic size={16} />
              Summon Bot
            </button>
            <button
              onClick={() => sendAction('leave')}
              disabled={actioning}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-danger/10 text-danger text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 cursor-pointer sm:px-6"
            >
              Disconnect
            </button>
          </div>
        </div>
      </Section>
    </div>

      <div className="h-[420px] lg:h-[650px] flex flex-col bg-bg-card rounded-lg border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border font-medium flex items-center gap-2">
           <MessageSquare size={16} className="text-accent" /> Live Chat
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col-reverse">
           {chatMessages.length === 0 ? <p className="text-text-muted text-sm text-center my-auto">No messages</p> : null}
           {chatMessages.map((m, i) => (
             <div key={m.id + i} className="flex gap-4">
               <img src={m.author.avatar || '/assets/breadicon.png'} className="w-9 h-9 rounded-full object-cover shrink-0 bg-black" />
               <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[14px] font-semibold truncate ${m.author.bot ? 'text-accent' : 'text-text-primary'}`}>{m.author.username}</span>
                     {m.author.bot && <span className="px-1.5 py-0.5 rounded uppercase text-[10px] font-bold bg-accent/20 text-accent">BOT</span>}
                     <span className="text-xs text-text-muted shrink-0">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-[14px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words">{renderMessageContent(m)}</p>
                  {(m.attachments || []).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(m.attachments || []).map((a, j) => (
                        isImageAttachment(a) ? (
                          <img key={j} src={a.url} alt={a.name} className="max-h-48 max-w-full rounded-md object-contain border border-border bg-bg-body" />
                        ) : isVideoAttachment(a) ? (
                          <video key={j} src={a.url} controls className="max-h-48 max-w-full rounded-md border border-border bg-bg-body" />
                        ) : (
                          <a key={j} href={a.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline break-all">
                            {a.name}
                          </a>
                        )
                      ))}
                    </div>
                  )}
                  {(m.embeds || []).length > 0 && (
                    <div className="space-y-2 mt-2">
                      {(m.embeds || []).map((embed, j) => (
                        <a
                          key={j}
                          href={embed.url || embed.image || undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="block max-w-sm rounded-md border border-border bg-bg-secondary/40 overflow-hidden hover:border-accent/40 transition-colors"
                        >
                          {embed.image && (
                            <img src={embed.image} alt="" className="max-h-56 w-full object-cover bg-bg-body" />
                          )}
                          {(embed.title || embed.description || embed.provider) && (
                            <div className="p-2.5">
                              {embed.provider && <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1">{embed.provider}</p>}
                              {embed.title && <p className="text-sm font-medium text-text-primary line-clamp-2">{embed.title}</p>}
                              {embed.description && <p className="text-xs text-text-secondary mt-1 line-clamp-3">{embed.description}</p>}
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
               </div>
             </div>
           ))}
        </div>
      </div>
    </div>
  );
}
