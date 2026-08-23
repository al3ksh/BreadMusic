'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { apiFetch, type GuildConfig, type PlayerStatus, type QueueTrack, type GuildHealth, type GuildInsights, type GuildInsightsRange, type FilterPreset, type EconomyLeaderboardEntry, type EconomyMember, type DashboardCapabilities, type HistoryPage, type LyricsResult, formatDuration } from '@/lib/api';
import { Settings, Play, Search, ChevronLeft, ChevronRight, ArrowLeft, Terminal, MessageSquare, Mic, Paperclip, X, Coins, Upload, FileAudio, Bold, Italic, Code2, AtSign, Hash, History, BookOpenText, Clock3 } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { CtrlBtn, Row, Section, Skeleton, Spinner, ToggleSwitch } from '@/components/dashboard/DashboardPrimitives';
import { DashboardPlayerControls } from '@/components/dashboard/DashboardPlayerControls';
import { DashboardQueue } from '@/components/dashboard/DashboardQueue';
import { DashboardSettings } from '@/components/dashboard/DashboardSettings';
import { DashboardStatus, Music2 } from '@/components/dashboard/DashboardStatus';
import { DashboardHistory } from '@/components/dashboard/DashboardHistory';
import { DashboardLyrics } from '@/components/dashboard/DashboardLyrics';
import { DashboardEconomy } from '@/components/dashboard/DashboardEconomy';
import { DashboardControl } from '@/components/dashboard/DashboardControl';

type Tab = 'settings' | 'status' | 'player' | 'history' | 'lyrics' | 'economy' | 'control';

export default function GuildPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const guildId = params.guildId as string;
  const rawView = searchParams.get('view');
  const [capabilities, setCapabilities] = useState<DashboardCapabilities | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const toast = useToast();

  const requeueFromHistory = useCallback(async (uri: string, mode: 'queue' | 'now') => {
    try {
      await apiFetch(`/guilds/${guildId}/player/${mode === 'now' ? 'playnow' : 'play'}`, {
        method: 'POST',
        body: JSON.stringify({ query: uri }),
      });
      toast.success(mode === 'now' ? 'Playing from history' : 'Added to queue from history');
    } catch (error) {
      toast.error('Replay failed', error instanceof Error ? error.message : 'Request failed.');
    }
  }, [guildId, toast]);
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

      {!invalidView && !restrictedView && activeTab === 'settings' && <DashboardSettings guildId={guildId} />}
      {!invalidView && activeTab === 'status' && <DashboardStatus guildId={guildId} />}
      {!invalidView && activeTab === 'player' && <PlayerTab guildId={guildId} capabilities={capabilities} />}
      {!invalidView && activeTab === 'history' && (
                  <DashboardHistory
                    guildId={guildId}
                    canQueue={capabilities?.canControlPlayer === true}
                    onRequeue={requeueFromHistory}
                  />
                )}
      {!invalidView && activeTab === 'lyrics' && <DashboardLyrics guildId={guildId} />}
      {!invalidView && !restrictedView && activeTab === 'economy' && <DashboardEconomy guildId={guildId} />}
      {!invalidView && !restrictedView && activeTab === 'control' && <DashboardControl guildId={guildId} />}

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

function PlayerTab({ guildId, capabilities }: { guildId: string; capabilities: DashboardCapabilities }) {
  const toast = useToast();
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [queue, setQueue] = useState<{ current: QueueTrack | null; tracks: QueueTrack[]; total: number; page: number; totalPages: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ encoded?: string; title: string; author: string; uri: string; duration: number; artwork?: string; source?: string | null; seekable?: boolean; isStream?: boolean }[]>([]);
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
  const volumeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekLastCommitRef = useRef<number | null>(null);
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

  const fetchData = useCallback(async () => {
    await Promise.allSettled([
      apiFetch<PlayerStatus>(`/guilds/${guildId}/status`).then(applyIncomingStatus),
      apiFetch<NonNullable<typeof queue>>(`/guilds/${guildId}/queue?page=${queuePage}`).then(setQueue),
    ]);
  }, [applyIncomingStatus, guildId, queuePage]);

  useEffect(() => {
    let source: EventSource | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let usingFallback = false;
    let streamErrors = 0;

    const startFallback = () => {
      if (usingFallback) return;
      usingFallback = true;
      fallbackInterval = setInterval(fetchData, 3000);
    };

    const stopFallback = () => {
      usingFallback = false;
      if (fallbackInterval) clearInterval(fallbackInterval);
      fallbackInterval = null;
    };

    fetchData();

    const connect = () => {
      if (stopped) return;
      source = new EventSource(`/api/guilds/${guildId}/player/events?page=${queuePage}`);
      source.onopen = () => {
        streamErrors = 0;
        stopFallback();
      };
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
        streamErrors += 1;
        source?.close();
        source = null;
        if (streamErrors >= 3) startFallback();
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
      // Confirm the optimistic state from the server before releasing slider drafts.
      await fetchData();

      if (!silentActions.has(action)) {
        const description = action === 'skip' && result.message
          ? result.message
          : actionDescriptions[action] || 'Player action completed.';
        toast.success(result.voteSkip ? 'Vote registered' : 'Action applied', description);
      }
      return true;
    } catch (err) {
      console.error('Player action failed:', err);
      const errorText = err instanceof Error ? err.message : 'Unknown player action error.';
      toast.error('Player action failed', errorText);
      await fetchData(); // revert on fail
      return false;
    }
  }, [guildId, fetchData, status, toast]);

  const handleSearch = useCallback(async (queryOverride?: string) => {
    const query = (queryOverride ?? searchQuery).trim();
    if (!query) return;
    setSearching(true);
    try {
      const res = await apiFetch<{ tracks: { encoded?: string; title: string; author: string; uri: string; duration: number; artwork?: string; source?: string | null; seekable?: boolean; isStream?: boolean }[] }>(
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

  const handleVolumeCommit = useCallback(async (vol: number) => {
    if (volumeCommitTimerRef.current) clearTimeout(volumeCommitTimerRef.current);
    const applied = await playerAction('volume', { volume: vol });
    if (!applied) {
      setLocalVolume(null);
      return;
    }
    volumeCommitTimerRef.current = setTimeout(() => {
      setLocalVolume(null);
      volumeCommitTimerRef.current = null;
    }, 1500);
  }, [playerAction]);

  const handleSeekCommit = useCallback(async (pos: number) => {
    if (seekLastCommitRef.current === pos) return;
    seekLastCommitRef.current = pos;
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
    if (seekCommitTimerRef.current) clearTimeout(seekCommitTimerRef.current);
    const applied = await playerAction('seek', { position: pos });
    if (!applied) {
      seekLastCommitRef.current = null;
      setLocalSeek(null);
      return;
    }
    seekCommitTimerRef.current = setTimeout(() => {
      seekLastCommitRef.current = null;
      setLocalSeek(null);
      seekCommitTimerRef.current = null;
    }, 1500);
  }, [playerAction, status?.currentTrack]);

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
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerUp={(e) => {
                          handleSeekCommit(Number(e.currentTarget.value));
                          setSeekPreview(null);
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                        }}
                        onPointerCancel={(e) => {
                          handleSeekCommit(Number(e.currentTarget.value));
                          setSeekPreview(null);
                        }}
                        onKeyUp={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') handleSeekCommit(Number(e.currentTarget.value));
                        }}
                        onBlur={(e) => {
                          if (localSeek !== null) handleSeekCommit(Number(e.currentTarget.value));
                        }}
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

          <DashboardPlayerControls
            status={status}
            canUseDJControls={canUseDJControls}
            canUsePlayerControls={canUsePlayerControls}
            canControlTrack={canControlTrack}
            queueHasTracks={Boolean(queue?.tracks.length)}
            selectedFilter={selectedFilter}
            filterOptions={filterPresets}
            applyingFilter={applyingFilter}
            volume={localVolume !== null ? localVolume : status.volume}
            onAction={playerAction}
            onVolumeChange={setLocalVolume}
            onVolumeCommit={handleVolumeCommit}
            onFilterChange={setSelectedFilter}
            onApplyFilter={handleApplyFilter}
          />
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
                          source: track.source,
                          seekable: track.seekable,
                          isStream: track.isStream,
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
        <DashboardQueue
          queue={queue}
          queuePage={queuePage}
          canUseDJControls={canUseDJControls}
          draggedIdx={draggedIdx}
          dropTargetIdx={dropTargetIdx}
          onClear={handleClearQueue}
          onPageChange={setQueuePage}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={resetDragState}
          onRemove={(index) => playerAction('remove', { start: queuePage * 20 + index })}
        />
      )}
    </div>
  );
}
