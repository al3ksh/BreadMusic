'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { apiFetch, type GuildConfig, type PlayerStatus, type QueueTrack, type GuildHealth, type GuildInsights, type GuildInsightsRange, type FilterPreset, type EconomyLeaderboardEntry, type EconomyMember, formatDuration } from '@/lib/api';
import { Settings, Activity, Play, Pause, SkipForward, Square, Shuffle, Repeat, Volume2, Search, ChevronLeft, ChevronRight, ArrowLeft, Terminal, MessageSquare, Mic, Paperclip, X, Coins, SlidersHorizontal, Trash2, Upload, FileAudio, SkipBack } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';

type Tab = 'settings' | 'status' | 'player' | 'economy' | 'control';

export default function GuildPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const guildId = params.guildId as string;
  const rawView = searchParams.get('view');
  const validTabs: Tab[] = ['settings', 'status', 'player', 'economy', 'control'];
  const invalidView = rawView && !validTabs.includes(rawView as Tab) ? rawView : null;
  const activeTab = invalidView ? 'settings' : ((rawView as Tab) || 'settings');

  return (
    <div className="animate-fade-up">
      {/* Page header */}
      <div className="bg-bg-secondary border-b border-border px-6 py-5 -m-5 md:-m-8 mb-6 md:mb-8 md:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings size={22} className="text-text-secondary" />
            <div>
              <h2 className="text-[22px] font-medium">
                {invalidView && 'View Not Found'}
                {activeTab === 'settings' && 'Server Settings'}
                {activeTab === 'status' && 'Server Status'}
                {activeTab === 'player' && 'Music Player'}
                {activeTab === 'economy' && 'Economy'}
                {activeTab === 'control' && 'Remote Control'}
              </h2>
              <p className="text-text-secondary text-[13px] mt-1">
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

      {!invalidView && activeTab === 'settings' && <SettingsTab guildId={guildId} />}
      {!invalidView && activeTab === 'status' && <StatusTab guildId={guildId} />}
      {!invalidView && activeTab === 'player' && <PlayerTab guildId={guildId} />}
      {!invalidView && activeTab === 'economy' && <EconomyTab guildId={guildId} />}
      {!invalidView && activeTab === 'control' && <ControlTab guildId={guildId} />}

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
const rangeClass = "w-24 h-1.5 rounded-full appearance-none cursor-pointer bg-border accent-accent";
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
      <div className="bg-bg-secondary px-5 py-3.5 border-b border-border">
        <h3 className="text-[15px] font-medium flex items-center gap-2">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {desc && <p className="text-xs text-text-secondary mt-0.5">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
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

  return (
    <div className="space-y-5 w-full max-w-5xl mx-auto">

      <Section title="DJ & Permissions">
        <Row label="DJ Role" desc={config.djRoleName || 'All members can DJ'}>
          <select
            value={config.djRoleId || ''}
            onChange={(e) => setConfig({ ...config, djRoleId: e.target.value || null })}
            className={selectClass + " w-64 max-w-full"}
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
            className={selectClass}
          >
            <option value="">Auto</option>
            <option value="ytsearch">YouTube</option>
            <option value="scsearch">SoundCloud</option>
            <option value="spsearch">Spotify</option>
          </select>
        </Row>
        <Row label="Player Text Channel" desc={config.playerTextChannelName || 'Disabled (no player message)'}>
          <select
            value={config.playerTextChannelId || ''}
            onChange={(e) => setConfig({ ...config, playerTextChannelId: e.target.value || null })}
            className={selectClass + " w-64 max-w-full"}
          >
            <option value="">(Disabled - do not send player message)</option>
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
            className={selectClass + " w-64 max-w-full"}
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

      <div className="flex items-center gap-4 pt-4 border-t border-border/50">
        <button
          onClick={() => save(config as any)}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all shadow-lg shadow-accent/20 disabled:opacity-50 cursor-pointer"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          onClick={reset}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-danger/10 text-danger text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 cursor-pointer"
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
  const max = 150;
  const segments = 15;
  const isDragging = useRef(false);

  const getHoverIndex = (e: React.MouseEvent | React.TouchEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const progress = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    // Index from 0 to segments (where 0 is no volume, 1 is first segment, etc.)
    return Math.round(progress * segments);
  };

  return (
    <div 
      className="flex items-end justify-between h-6 w-36 gap-[3px] cursor-pointer group py-1"
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
      {Array.from({ length: segments }).map((_, i) => {
        const segValue = (i + 1) * (max / segments);
        const isActive = value >= segValue - (max/segments)/2;
        const isHovered = hoverIdx !== null && hoverIdx >= i + 1;
        
        return (
          <div
            key={i}
            className={`flex-1 rounded-[1px] transition-all duration-75 ${
              isHovered ? 'bg-accent' : isActive ? 'bg-accent/80 shadow-[0_0_8px_rgba(107,99,255,0.3)]' : 'bg-border group-hover:bg-border/70'
            }`}
            style={{ height: `${30 + (i / (segments - 1)) * 70}%` }}
          />
        );
      })}
    </div>
  );
}

function PlayerTab({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [queue, setQueue] = useState<{ current: QueueTrack | null; tracks: QueueTrack[]; total: number; page: number; totalPages: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ title: string; author: string; uri: string; duration: number; artwork?: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [queuePage, setQueuePage] = useState(0);
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  const [selectedFilter, setSelectedFilter] = useState('');
  const [applyingFilter, setApplyingFilter] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Local state for smooth sliders
  const [localVolume, setLocalVolume] = useState<number | null>(null);
  const [localSeek, setLocalSeek] = useState<number | null>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const lastTrackSeenAtRef = useRef(0);
  const pausedTrackKeyRef = useRef<string | null>(null);
  const pausedTrackPositionRef = useRef<number | null>(null);

  const fetchData = useCallback(() => {
    apiFetch<PlayerStatus>(`/guilds/${guildId}/status`).then((incomingStatus) => {
      setStatus((prev) => {
        let s = incomingStatus;

        if (s.currentTrack) {
          const trackKey = `${s.currentTrack.uri}|${s.currentTrack.title}|${s.currentTrack.author}`;

          if (s.paused) {
            if (pausedTrackKeyRef.current !== trackKey || pausedTrackPositionRef.current === null) {
              pausedTrackKeyRef.current = trackKey;
              pausedTrackPositionRef.current = s.currentTrack.position || 0;
            }

            s = {
              ...s,
              currentTrack: {
                ...s.currentTrack,
                position: pausedTrackPositionRef.current,
              },
            };
          } else {
            pausedTrackKeyRef.current = trackKey;
            pausedTrackPositionRef.current = null;
          }

          lastTrackSeenAtRef.current = Date.now();
          return s;
        }

        const withinGraceWindow = Date.now() - lastTrackSeenAtRef.current < TRACK_TRANSITION_GRACE_MS;
        if (s.connected && withinGraceWindow && prev?.currentTrack) {
          return { ...s, currentTrack: prev.currentTrack };
        }

        if (!s.connected) {
          lastTrackSeenAtRef.current = 0;
        }

        pausedTrackKeyRef.current = null;
        pausedTrackPositionRef.current = null;

        return s;
      });
    }).catch(() => {});
    apiFetch<NonNullable<typeof queue>>(`/guilds/${guildId}/queue?page=${queuePage}`).then(setQueue).catch(() => {});
  }, [guildId, queuePage]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

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
      await apiFetch(`/guilds/${guildId}/player/${action}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      // Fetch data immediately after API completes instead of timeout
      fetchData();

      if (!silentActions.has(action)) {
        toast.success('Action applied', actionDescriptions[action] || 'Player action completed.');
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
      const res = await apiFetch<{ tracks: { title: string; author: string; uri: string; duration: number; artwork?: string }[] }>(
        `/guilds/${guildId}/player/search`,
        { method: 'POST', body: JSON.stringify({ query }) },
      );
      setSearchResults(res.tracks || []);
    } catch {
      setSearchResults([]);
      toast.error('Search failed', 'Could not load search results for this query.');
    } finally {
      setSearching(false);
    }
  }, [guildId, searchQuery, toast]);

  const isLikelyLink = (value: string) => /^https?:\/\//i.test(value.trim());

  const handleInputSubmit = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;

    if (isLikelyLink(query)) {
      setSearching(true);
      try {
        await playerAction('play', { query });
        setSearchQuery('');
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
      return;
    }

    await handleSearch(query);
  }, [handleSearch, playerAction, searchQuery]);

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
          'X-File-Name': uploadFile.name,
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
    playerAction('seek', { position: pos });
    setTimeout(() => setLocalSeek(null), 100);
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    
    // Optimistic UI update
    const newQueue = [...queue!.tracks];
    const item = newQueue.splice(draggedIdx, 1)[0];
    newQueue.splice(targetIdx, 0, item);
    setQueue({ ...queue!, tracks: newQueue });
    
    // API Call
    playerAction('move', { from: queuePage * 20 + draggedIdx, to: queuePage * 20 + targetIdx });
    setDraggedIdx(null);
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
  const currentPos = localSeek !== null ? localSeek : (status.currentTrack?.position || 0);
  const hasCurrentTrack = Boolean(status.connected && status.currentTrack);
  const canUsePlayerControls = Boolean(status.connected);
  const canControlTrack = Boolean(status.connected && status.currentTrack);

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
                    <input
                      type="range"
                      min={0}
                      max={currentDuration}
                      value={currentPos}
                      onChange={(e) => setLocalSeek(Number(e.target.value))}
                      onMouseUp={(e) => handleSeekCommit(Number((e.target as HTMLInputElement).value))}
                      onTouchEnd={(e) => handleSeekCommit(Number((e.target as HTMLInputElement).value))}
                      disabled={!canControlTrack}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-border transition-all duration-200 hover:h-2 disabled:cursor-not-allowed disabled:opacity-60
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(107,99,255,0.6)] [&::-webkit-slider-thumb]:opacity-0 hover:[&::-webkit-slider-thumb]:opacity-100 [&::-webkit-slider-thumb]:transition-opacity
                        [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:shadow-[0_0_10px_rgba(107,99,255,0.6)] [&::-moz-range-thumb]:opacity-0 hover:[&::-moz-range-thumb]:opacity-100"
                      style={{ background: `linear-gradient(to right, #6b63ff ${currentDuration > 0 ? (currentPos / currentDuration) * 100 : 0}%, rgba(255,255,255,0.05) 0)` }}
                    />
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
              disabled={!canUsePlayerControls || !queue || queue.tracks.length === 0}
            >
              <Shuffle size={16} />
            </CtrlBtn>
            <CtrlBtn onClick={() => playerAction('back')} title="Previous" disabled={!canControlTrack}>
              <SkipBack size={16} />
            </CtrlBtn>
            <CtrlBtn onClick={() => playerAction('toggle')} title={status.paused ? 'Play' : 'Pause'} primary disabled={!canControlTrack}>
              {status.paused ? <Play size={18} /> : <Pause size={18} />}
            </CtrlBtn>
            <CtrlBtn onClick={() => playerAction('skip')} title="Skip" disabled={!canControlTrack}>
              <SkipForward size={16} />
            </CtrlBtn>
            <CtrlBtn onClick={() => playerAction('stop')} title="Stop" disabled={!canControlTrack}>
              <Square size={14} />
            </CtrlBtn>
            <CtrlBtn onClick={() => playerAction('loop')} title="Loop" badge={status.repeatMode !== 'off' ? (status.repeatMode === 'track' ? '1' : 'A') : undefined} disabled={!canControlTrack}>
              <Repeat size={16} />
            </CtrlBtn>
          </div>

          <div className={`flex items-center gap-4 mt-5 px-1 ${canUsePlayerControls ? '' : 'opacity-45 pointer-events-none'}`}>
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
              disabled={!canUsePlayerControls}
              className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${status.autoplay ? 'bg-success/15 text-success border border-success/30 hover:bg-success/20' : 'bg-bg-input text-text-secondary border border-border hover:text-text-primary hover:border-accent/30'}`}
            >
              <Activity size={15} />
              Autoplay: {status.autoplay ? 'ON' : 'OFF'}
            </button>

            <div className="flex gap-2">
              <select
                value={selectedFilter}
                onChange={(e) => setSelectedFilter(e.target.value)}
                disabled={!canUsePlayerControls}
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
                disabled={applyingFilter || !selectedFilter || !canUsePlayerControls}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-bg-input border border-border text-text-secondary hover:text-text-primary hover:border-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title="Apply filter preset"
              >
                <SlidersHorizontal size={14} />
                Apply
              </button>
              <button
                onClick={() => playerAction('filter', { preset: 'clear' })}
                disabled={!canUsePlayerControls}
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

            <div className="mt-4 rounded-md border border-border bg-bg-secondary/40 p-3">
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
            </div>

            {searchResults.length > 0 && (
              <div className="mt-3 rounded-md overflow-hidden border border-border">
                {searchResults.map((track, i) => (
                  <button
                    key={`${track.uri}-${i}`}
                    onClick={() => {
                      playerAction('play', { query: track.uri || `${track.author} ${track.title}` });
                      setSearchResults([]);
                      setSearchQuery('');
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
                disabled={queue.total === 0}
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
                  <p className="text-xs text-text-muted truncate">{queue.current.author}</p>
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
                  draggable
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={(e) => handleDrop(e, i)}
                  className={`group flex items-center gap-3 px-3 py-2 border border-transparent rounded-md hover:bg-bg-hover/50 transition-colors cursor-grab active:cursor-grabbing ${draggedIdx === i ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center justify-center w-5 text-text-muted cursor-move opacity-50 hover:opacity-100">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                  </div>
                  {track.artwork ? (
                    <img src={track.artwork} alt="" className="w-8 h-8 rounded shrink-0 object-cover" />
                  ) : (
                    <span className="text-xs text-text-muted w-4 ml-1 tabular-nums flex-shrink-0">{queuePage * 20 + i + 1}</span>
                  )}
                  <div className="flex-1 min-w-0 ml-1">
                    <p className="text-sm truncate select-none">{track.title}</p>
                    <p className="text-xs text-text-muted truncate select-none">{track.author}</p>
                  </div>
                  <span className="text-xs text-text-muted tabular-nums">{formatDuration(track.duration)}</span>
                  
                  {/* Remove Track Button */}
                  <button 
                     onClick={() => playerAction('remove', { start: queuePage * 20 + i })}
                     className="p-1.5 ml-2 text-text-muted hover:text-danger hover:bg-danger/10 rounded-md transition-colors opacity-70 group-hover:opacity-100"
                     title="Remove track"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
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

interface ChatMessage {
  id: string;
  content: string;
  author: {
    username: string;
    avatar: string | null;
    bot: boolean;
  };
  timestamp: number;
  attachments: string[];
}

function ControlTab({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [attachment, setAttachment] = useState<{ name: string, base64: string } | null>(null);
  const [selectedTextId, setSelectedTextId] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState('');

  useEffect(() => {
    apiFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`)
      .then(res => {
        setChannels(res);
        if (res.length > 0) {
          const text = res.find(c => c.type === 0 || c.type === 5);
          const voice = res.find(c => c.type === 2 || c.type === 13);
          if (text) setSelectedTextId(text.id);
          if (voice) setSelectedVoiceId(voice.id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [guildId]);

  useEffect(() => {
    if (!selectedTextId) return;
    const fetchMsgs = () => {
      apiFetch<ChatMessage[]>(`/guilds/${guildId}/control/messages?channelId=${selectedTextId}`)
        .then(res => setChatMessages(res))
        .catch(() => {});
    };
    fetchMsgs();
    const interval = setInterval(fetchMsgs, 3000);
    return () => clearInterval(interval);
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

  const sendAction = async (action: 'say' | 'summon' | 'leave') => {
    setActioning(true);
    try {
      if (action === 'say') {
        if (!selectedTextId || (!messageText.trim() && !attachment)) return;
        await apiFetch(`/guilds/${guildId}/control/say`, {
          method: 'POST',
          body: JSON.stringify({ 
            channelId: selectedTextId, 
            message: messageText,
            attachmentBase64: attachment?.base64,
            attachmentName: attachment?.name
          })
        });
        setMessageText('');
        setAttachment(null);
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-6xl mx-auto lg:items-stretch">
      <div className="space-y-6 lg:h-[650px] lg:flex lg:flex-col lg:gap-6 lg:space-y-0">
        <Section title="Send Message" className="lg:flex-1">
          <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Destination Channel</label>
            <select
              value={selectedTextId}
              onChange={(e) => setSelectedTextId(e.target.value)}
              className={selectClass + " w-full max-w-sm"}
            >
              {textChannels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Message Content</label>
            <textarea
              rows={3}
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              placeholder="Type a message for the bot to send..."
              className="w-full rounded-md border border-border bg-bg-input text-text-primary px-4 py-3 text-sm outline-none focus:border-accent transition-colors placeholder:text-text-muted font-[inherit] resize-y"
            />
          </div>

          {attachment && (
            <div className="flex items-center gap-2 px-3 py-2 bg-accent/10 border border-accent/20 rounded-md text-sm text-text-primary">
              <span className="truncate flex-1 max-w-sm font-medium"><span className="text-accent">Attachment:</span> {attachment.name}</span>
              <button 
                onClick={() => setAttachment(null)} 
                className="hover:text-danger transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => sendAction('say')}
              disabled={actioning || (!messageText.trim() && !attachment)}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-accent/20"
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

      <Section title="Voice Connection">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Voice Channel</label>
            <select
              value={selectedVoiceId}
              onChange={(e) => setSelectedVoiceId(e.target.value)}
              className={selectClass + " w-full max-w-sm"}
            >
              {voiceChannels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
             <button
              onClick={() => sendAction('summon')}
              disabled={actioning || !selectedVoiceId}
              className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all shadow-lg shadow-accent/20 disabled:opacity-50 cursor-pointer"
            >
              <Mic size={16} />
              Summon Bot
            </button>
            <button
              onClick={() => sendAction('leave')}
              disabled={actioning}
              className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-danger/10 text-danger text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Disconnect
            </button>
          </div>
        </div>
      </Section>
    </div>

      <div className="min-h-[420px] lg:h-[650px] flex flex-col bg-bg-card rounded-lg border border-border shadow-sm overflow-hidden">
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
                  <span className={`text-[14px] font-semibold truncate ${m.author.bot ? 'text-accent' : 'text-text-primary'}`}>{m.author.bot ? 'Bread' : m.author.username}</span>
                     {m.author.bot && <span className="px-1.5 py-0.5 rounded uppercase text-[10px] font-bold bg-accent/20 text-accent">BOT</span>}
                     <span className="text-xs text-text-muted shrink-0">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-[14px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words">{m.content}</p>
                  {m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {m.attachments.map((a, j) => <img key={j} src={a} className="max-h-48 max-w-full rounded-md object-contain border border-border bg-bg-body" />)}
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
