'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, type GuildConfig } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { Row, Section, Skeleton, ToggleSwitch } from '@/components/dashboard/DashboardPrimitives';

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

const rangeClass = 'w-full min-w-24 h-1.5 rounded-full appearance-none cursor-pointer bg-border accent-accent';
const selectClass = 'rounded-md border border-border bg-bg-input text-text-primary px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-[inherit]';

export function DashboardSettings({ guildId }: { guildId: string }) {
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
      apiFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`),
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
    } catch {
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
            className={selectClass + ' w-full sm:w-64'}
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
            className={selectClass + ' w-full sm:w-64'}
          >
            <option value="">(None - All members can DJ)</option>
            {roles.filter(r => r.name !== '@everyone').map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </Row>
        <Row label="Vote Skip Threshold" desc="Percentage of listeners needed to skip">
          <div className="flex items-center gap-2">
            <input
              type="range" min={10} max={100} step={5}
              value={config.voteSkipPercent * 100}
              onChange={(e) => setConfig({ ...config, voteSkipPercent: Number(e.target.value) / 100 })}
              className={rangeClass}
            />
            <input
              type="number" min={10} max={100} step={1}
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
            <input type="range" min={0} max={100} value={config.defaultVolume} onChange={(e) => setConfig({ ...config, defaultVolume: Number(e.target.value) })} className={rangeClass} />
            <input
              type="number" min={0} max={100} step={1} value={config.defaultVolume}
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
            <input type="range" min={10} max={500} value={config.maxVolume} onChange={(e) => setConfig({ ...config, maxVolume: Number(e.target.value) })} className={rangeClass} />
            <input
              type="number" min={10} max={500} step={1} value={config.maxVolume}
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
        <Row label="Autoplay Mode" desc="Recommendation engine used when autoplay is on">
          <select
            value={config.autoplayMode || 'ai_assisted'}
            onChange={(e) => setConfig({ ...config, autoplayMode: e.target.value as 'classic' | 'ai_assisted' | 'discovery' })}
            className={selectClass + ' w-full sm:w-48'}
          >
            <option value="classic">Classic (no AI)</option>
            <option value="ai_assisted">AI assisted</option>
            <option value="discovery">Discovery radio</option>
          </select>
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
            <input type="range" min={0.5} max={30} step={0.5} value={config.afkTimeout / 60000} onChange={(e) => setConfig({ ...config, afkTimeout: Number(e.target.value) * 60000 })} className={rangeClass} />
            <input
              type="number" min={0.5} max={30} step={0.5} value={Number((config.afkTimeout / 60000).toFixed(1))}
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
          <select value={config.preferredSource || ''} onChange={(e) => setConfig({ ...config, preferredSource: e.target.value || null })} className={selectClass + ' w-full sm:w-48'}>
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
              setConfig({ ...config, playerTextChannelId: value === '__default' ? null : value === '__disabled' ? 'disabled' : value });
            }}
            className={selectClass + ' w-full sm:w-64'}
          >
            <option value="__default">Default (use command/player channel)</option>
            <option value="__disabled">Disabled (do not send player message)</option>
            {channels.filter(c => c.type === 0 || c.type === 5).map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </Row>
        <Row label="24/7 Voice Channel" desc={config.twentyFourSevenChannelName || 'Not set'}>
          <select value={config.twentyFourSevenChannelId || ''} onChange={(e) => setConfig({ ...config, twentyFourSevenChannelId: e.target.value || null })} className={selectClass + ' w-full sm:w-64'}>
            <option value="">(None - Disabled)</option>
            {channels.filter(c => c.type === 2 || c.type === 13).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Row>
      </Section>

      <div className="flex flex-col gap-3 pt-4 border-t border-border/50 sm:flex-row sm:items-center sm:gap-4">
        <button onClick={() => save(config as any)} disabled={saving} className="w-full px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all shadow-lg shadow-accent/20 disabled:opacity-50 cursor-pointer sm:w-auto">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button onClick={reset} disabled={saving} className="w-full px-6 py-2.5 rounded-lg bg-danger/10 text-danger text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 cursor-pointer sm:w-auto">
          Reset
        </button>
      </div>
    </div>
  );
}
