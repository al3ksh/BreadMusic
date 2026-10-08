'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch, type GuildConfig, type LastfmStatus } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { Row, Section, SectionSkeleton, ToggleSwitch } from '@/components/dashboard/DashboardPrimitives';
import { Select } from '@/components/dashboard/DashboardSelect';

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

const rangeClass = 'w-full min-w-24 h-1.5 rounded-full appearance-none cursor-pointer bg-border accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function NumberInput({
  value,
  min,
  max,
  step,
  onCommit,
  ariaLabel,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
  ariaLabel: string;
  className: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(parsed)) {
      onCommit(clamp(parsed, min, max));
    }
    setDraft(null);
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft ?? value}
      aria-label={ariaLabel}
      className={className}
      onFocus={(event) => {
        setDraft(String(value));
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function LastfmBadge({ status }: { status?: LastfmStatus }) {
  const state = !status?.enabled
    ? { dot: 'bg-text-muted', label: 'Not configured', hint: 'Set LASTFM_API_KEY on the bot to enable it' }
    : status.available
      ? { dot: 'bg-success', label: 'Connected', hint: null }
      : { dot: 'bg-warning', label: 'Paused', hint: 'Rate limited, retrying shortly' };
  return (
    <div className="text-sm sm:w-48">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${state.dot}`} />
        <span className="text-text-primary">{state.label}</span>
      </div>
      {state.hint && <p className="mt-0.5 text-xs text-text-muted">{state.hint}</p>}
    </div>
  );
}

export function DashboardSettings({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [config, setConfig] = useState<GuildConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<GuildConfig | null>(null);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const compactValueInputClass = 'w-14 h-7 rounded-md border border-border bg-bg-input text-text-primary px-2 text-xs text-right tabular-nums outline-none focus:border-accent transition-colors font-[inherit]';

  useEffect(() => {
    Promise.all([
      apiFetch<GuildConfig>(`/guilds/${guildId}/config`),
      apiFetch<DiscordRole[]>(`/guilds/${guildId}/roles`),
      apiFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`),
    ])
      .then(([confRes, rolesRes, channelsRes]) => {
        setConfig(confRes);
        setSavedConfig(confRes);
        setRoles(rolesRes || []);
        setChannels(channelsRes || []);
      })
      .catch(() => {
        toast.error('Failed to load settings', 'Could not load server configuration.');
      })
      .finally(() => setLoading(false));
  }, [guildId, toast]);

  // Only the fields edited here are sent, so saving cannot undo a change made elsewhere since
  // the page loaded (autoplay toggled from the player, for one).
  const save = useCallback(async () => {
    if (!config) return;
    const updates = Object.fromEntries(Object.entries(config).filter(([key, value]) => (
      JSON.stringify(value) !== JSON.stringify(savedConfig?.[key as keyof GuildConfig])
    )));
    setSaving(true);
    try {
      if (Object.keys(updates).length) {
        await apiFetch(`/guilds/${guildId}/config`, {
          method: 'PUT',
          body: JSON.stringify(updates),
        });
      }
      setSavedConfig(config);
      toast.success('Settings saved', 'Server configuration has been updated.');
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to save';
      toast.error('Save failed', text);
    } finally {
      setSaving(false);
    }
  }, [config, savedConfig, guildId, toast]);

  const reset = useCallback(async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ success: boolean; config: GuildConfig }>(`/guilds/${guildId}/config/reset`, { method: 'POST' });
      setConfig(res.config);
      setSavedConfig(res.config);
      toast.success('Settings reset', 'Default values have been restored.');
    } catch {
      toast.error('Reset failed', 'Could not reset server configuration.');
    } finally {
      setSaving(false);
    }
  }, [guildId, toast]);

  const rebuildAutoplay = useCallback(async () => {
    setRebuilding(true);
    try {
      const res = await apiFetch<{ success: boolean; seeds: number }>(`/guilds/${guildId}/autoplay/rebuild`, { method: 'POST' });
      if (res.seeds > 0) toast.success('Autoplay rebuilt', `Autoplay now follows ${res.seeds} recently queued or liked tracks.`);
      else toast.error('Nothing to rebuild from', 'Queue a few tracks first, then try again.');
    } catch (err) {
      toast.error('Rebuild failed', err instanceof Error ? err.message : 'Could not rebuild autoplay.');
    } finally {
      setRebuilding(false);
    }
  }, [guildId, toast]);

  const isDirty = Boolean(
    config && savedConfig && JSON.stringify(config) !== JSON.stringify(savedConfig),
  );

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (loading) return (
    <div className="space-y-5 w-full max-w-5xl mx-auto">
      <SectionSkeleton rows={4} />
      <SectionSkeleton rows={3} />
      <SectionSkeleton rows={2} />
    </div>
  );
  if (!config) return <p className="text-text-secondary">Failed to load config.</p>;

  const roleOptions = roles.filter(r => r.name !== '@everyone').map(r => ({ value: r.id, label: r.name }));
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
        <Row label="Dashboard Access" desc="Who can open the dashboard. Moderators use the Mod Role below">
          <Select
            ariaLabel="Dashboard Access"
            value={config.dashboardAccess}
            onChange={(value) => setConfig({ ...config, dashboardAccess: value as GuildConfig['dashboardAccess'] })}
            options={[
              { value: 'admin', label: 'Administrators only' },
              { value: 'mod', label: 'Administrators and moderators' },
              { value: 'members', label: 'All server members' },
            ]}
            className="w-full sm:w-64"
          />
        </Row>
        <Row label="Mod Role" desc={config.modRoleName || 'Not set'}>
          <Select
            ariaLabel="Mod Role"
            value={config.modRoleId || ''}
            onChange={(value) => setConfig({ ...config, modRoleId: value || null })}
            options={[{ value: '', label: '(None)' }, ...roleOptions]}
            className="w-full sm:w-64"
          />
        </Row>
        <Row label="Activity Control" desc="Who can control playback inside the Activity (must be in the bot voice channel)">
          <Select
            ariaLabel="Activity Control"
            value={config.activityControl || 'inherit'}
            onChange={(value) => setConfig({ ...config, activityControl: value as GuildConfig['activityControl'] })}
            options={[
              { value: 'inherit', label: 'Inherit (follow Dashboard Access)' },
              { value: 'admin', label: 'Administrators only' },
              { value: 'mod', label: 'Admins and moderators' },
              { value: 'dj', label: 'Admins, moderators and DJs' },
              { value: 'members', label: 'All members' },
            ]}
            className="w-full sm:w-64"
          />
        </Row>
        <Row label="DJ Role" desc={config.djRoleName || 'All members can DJ'}>
          <Select
            ariaLabel="DJ Role"
            value={config.djRoleId || ''}
            onChange={(value) => setConfig({ ...config, djRoleId: value || null })}
            options={[{ value: '', label: '(None - All members can DJ)' }, ...roleOptions]}
            className="w-full sm:w-64"
          />
        </Row>
        <Row label="Vote Skip Threshold" desc="Percentage of listeners needed to skip">
          <div className="flex items-center gap-2">
            <input
              type="range" min={10} max={100} step={5}
              aria-label="Vote skip threshold"
              value={config.voteSkipPercent * 100}
              onChange={(e) => setConfig({ ...config, voteSkipPercent: Number(e.target.value) / 100 })}
              className={rangeClass}
            />
            <NumberInput
              value={Math.round(config.voteSkipPercent * 100)}
              min={10}
              max={100}
              step={1}
              onCommit={(value) => setConfig({ ...config, voteSkipPercent: value / 100 })}
              ariaLabel="Vote skip percent"
              className={compactValueInputClass}
            />
            <span className="text-xs text-text-secondary">%</span>
          </div>
        </Row>
        {config.djRoleId && (
          <Row label="Open Controls Without a DJ" desc="While no DJ is in the voice channel, everyone listening there can pause, skip and change the volume">
            <ToggleSwitch label="Open Controls Without a DJ" checked={config.openWithoutDJ} onChange={(v) => setConfig({ ...config, openWithoutDJ: v })} />
          </Row>
        )}
      </Section>

      <Section title="Volume">
        <Row label="Default Volume">
          <div className="flex items-center gap-2">
            <input type="range" aria-label="Default volume" min={0} max={100} value={config.defaultVolume} onChange={(e) => setConfig({ ...config, defaultVolume: Number(e.target.value) })} className={rangeClass} />
            <NumberInput
              value={config.defaultVolume}
              min={0}
              max={100}
              step={1}
              onCommit={(value) => setConfig({ ...config, defaultVolume: value })}
              ariaLabel="Default volume"
              className={compactValueInputClass}
            />
            <span className="text-xs text-text-secondary">%</span>
          </div>
        </Row>
        <Row label="Maximum Volume">
          <div className="flex items-center gap-2">
            <input type="range" aria-label="Maximum volume" min={10} max={500} value={config.maxVolume} onChange={(e) => setConfig({ ...config, maxVolume: Number(e.target.value) })} className={rangeClass} />
            <NumberInput
              value={config.maxVolume}
              min={10}
              max={500}
              step={1}
              onCommit={(value) => setConfig({ ...config, maxVolume: value })}
              ariaLabel="Maximum volume"
              className={compactValueInputClass}
            />
            <span className="text-xs text-text-secondary">%</span>
          </div>
        </Row>
      </Section>

      <Section title="Behavior">
        <Row label="Autoplay" desc="Play similar tracks when queue ends">
          <ToggleSwitch label="Autoplay" checked={config.autoplay} onChange={(v) => setConfig({ ...config, autoplay: v })} />
        </Row>
        <Row label="Rebuild Autoplay" desc="Drifted off? Re-seed autoplay from what people queued here recently and from the liked tracks of people listening now">
          <button
            type="button"
            onClick={rebuildAutoplay}
            disabled={rebuilding}
            className="w-full px-3 py-2 rounded-md border border-border text-sm font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50 cursor-pointer transition-colors sm:w-48"
          >
            {rebuilding ? 'Rebuilding...' : 'Rebuild from history'}
          </button>
        </Row>
        <Row label="Last.fm" desc="Similar-track suggestions from Last.fm listening data">
          <LastfmBadge status={config.lastfm} />
        </Row>
        <Row label="Stay in Channel (24/7)" desc="Bot stays connected even when idle">
          <ToggleSwitch label="Stay in Channel (24/7)" checked={config.stayInChannel} onChange={(v) => setConfig({ ...config, stayInChannel: v })} />
        </Row>
        <Row label="Persistent Queue" desc="Save queue between bot restarts">
          <ToggleSwitch label="Persistent Queue" checked={config.persistentQueue} onChange={(v) => setConfig({ ...config, persistentQueue: v })} />
        </Row>
        <Row label="Take Turns" desc="Alternate queued tracks between the people who asked for them">
          <ToggleSwitch label="Take Turns" checked={config.fairQueue} onChange={(v) => setConfig({ ...config, fairQueue: v })} />
        </Row>
        <Row label="Voice Channel Status" desc="Show the current track below the voice channel name">
          <ToggleSwitch label="Voice Channel Status" checked={config.voiceChannelStatus} onChange={(v) => setConfig({ ...config, voiceChannelStatus: v })} />
        </Row>
        <Row label="AFK Timeout">
          <div className="flex items-center gap-2">
            <input type="range" aria-label="AFK timeout in minutes" min={0.5} max={30} step={0.5} value={config.afkTimeout / 60000} onChange={(e) => setConfig({ ...config, afkTimeout: Number(e.target.value) * 60000 })} className={rangeClass} />
            <NumberInput
              value={Number((config.afkTimeout / 60000).toFixed(1))}
              min={0.5}
              max={30}
              step={0.5}
              onCommit={(value) => setConfig({ ...config, afkTimeout: value * 60000 })}
              ariaLabel="AFK timeout minutes"
              className={compactValueInputClass}
            />
            <span className="text-xs text-text-secondary">m</span>
          </div>
        </Row>
        <Row label="Preferred Source">
          <Select
            ariaLabel="Preferred Source"
            value={config.preferredSource || ''}
            onChange={(value) => setConfig({ ...config, preferredSource: value || null })}
            options={[
              { value: '', label: 'Auto' },
              { value: 'ytsearch', label: 'YouTube' },
              { value: 'scsearch', label: 'SoundCloud' },
              { value: 'spsearch', label: 'Spotify' },
            ]}
            className="w-full sm:w-48"
          />
        </Row>
        <Row label="Player Text Channel" desc={playerTextChannelDescription}>
          <Select
            ariaLabel="Player Text Channel"
            value={playerTextChannelValue}
            onChange={(value) => setConfig({ ...config, playerTextChannelId: value === '__default' ? null : value === '__disabled' ? 'disabled' : value })}
            options={[
              { value: '__default', label: 'Default (use command/player channel)' },
              { value: '__disabled', label: 'Disabled (do not send player message)' },
              ...channels.filter(c => c.type === 0 || c.type === 5).map(c => ({ value: c.id, label: `#${c.name}` })),
            ]}
            className="w-full sm:w-64"
          />
        </Row>
        <Row label="24/7 Voice Channel" desc={config.twentyFourSevenChannelName || 'Not set'}>
          <Select
            ariaLabel="24/7 Voice Channel"
            value={config.twentyFourSevenChannelId || ''}
            onChange={(value) => setConfig({ ...config, twentyFourSevenChannelId: value || null })}
            options={[
              { value: '', label: '(None - Disabled)' },
              ...channels.filter(c => c.type === 2 || c.type === 13).map(c => ({ value: c.id, label: c.name })),
            ]}
            className="w-full sm:w-64"
          />
        </Row>
      </Section>

      <div className="flex flex-col gap-3 pt-4 border-t border-border/50 sm:flex-row sm:items-center sm:gap-4">
        <button onClick={save} disabled={saving} className="w-full px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all shadow-lg shadow-accent/20 disabled:opacity-50 cursor-pointer sm:w-auto">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button onClick={reset} disabled={saving} className="w-full px-6 py-2.5 rounded-lg bg-danger/10 text-danger text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 cursor-pointer sm:w-auto">
          Reset
        </button>
      </div>

      {isDirty && createPortal(
        <div className="fixed bottom-5 right-5 z-[100] flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-bg-card/95 backdrop-blur px-4 py-3 shadow-2xl animate-fade-up">
          <span className="text-sm text-text-secondary">You have unsaved changes</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => savedConfig && setConfig(savedConfig)}
            className="px-3 py-1.5 rounded-md border border-border text-xs font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="px-4 py-1.5 rounded-md bg-accent text-white text-xs font-semibold hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
