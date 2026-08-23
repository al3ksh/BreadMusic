'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle,
  AudioLines,
  Bot,
  CheckCircle2,
  Disc3,
  GripVertical,
  Info,
  KeyRound,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  Trash2,
  VolumeX,
  X,
} from 'lucide-react';
import type { DashboardCapabilities, HistoryPage, LyricsResult, PlayerStatus, QueueTrack } from '@/lib/api';
import { ActivityArtwork, ActivitySpinner } from '@/components/activity/ActivityArtwork';
import { ActivityPlayerControls } from '@/components/activity/ActivityPlayerControls';
import { ActivityPanelNav } from '@/components/activity/ActivityPanelNav';
import { ActivityHistoryPanel } from '@/components/activity/ActivityHistoryPanel';
import { ActivityQueuePanel } from '@/components/activity/ActivityQueuePanel';
import { ActivitySearchPanel } from '@/components/activity/ActivitySearchPanel';
import { ActivityLyricsPanel } from '@/components/activity/ActivityLyricsPanel';
import { activityRequest } from '@/lib/activity/transport';
import { buildActivityRichPresence, type RichPresenceActivity } from '@/lib/activity/richPresence';

type ActivitySdk = {
  ready: () => Promise<void>;
  guildId: string | null;
  channelId: string | null;
  commands: {
    authorize: (options: Record<string, unknown>) => Promise<{ code: string }>;
    authenticate: (options: { access_token: string }) => Promise<{ access_token?: string } | null>;
    openExternalLink: (options: { url: string }) => Promise<{ opened: boolean }>;
    setActivity?: (options: { activity: RichPresenceActivity | null }) => Promise<unknown>;
  };
};

declare global {
  interface Window {
    __BREAD_TEST_ACTIVITY_SDK__?: ActivitySdk;
    __BREAD_TEST_ACTIVITY_SCOPES__?: string[];
    __BREAD_TEST_RICH_PRESENCE_CALLS__?: Array<RichPresenceActivity | null>;
  }
}

type ActivityPhase = 'starting' | 'ready' | 'error' | 'unsupported';
type ActivityErrorKind = 'discord' | 'lavalink' | 'voice' | 'auth' | 'access' | 'generic';

const ACTIVITY_ERROR_VISUALS: Record<ActivityErrorKind, { icon: typeof Bot; title: string }> = {
  discord: { icon: Bot, title: 'Bot is offline' },
  lavalink: { icon: AudioLines, title: 'Audio engine offline' },
  voice: { icon: VolumeX, title: 'Bread is not in a voice channel' },
  auth: { icon: KeyRound, title: 'Session expired' },
  access: { icon: ShieldAlert, title: 'Access denied' },
  generic: { icon: AlertTriangle, title: 'Activity unavailable' },
};
type ActivityPanel = 'queue' | 'search' | 'lyrics' | null;
type ActivityNoticeTone = 'success' | 'error' | 'warning' | 'info';
type ActivityNotice = { id: number; message: string; tone: ActivityNoticeTone };
type ServerNotice = { id: string; message: string; tone: ActivityNoticeTone };
type QueueSnapshot = {
  current: QueueTrack | null;
  tracks: QueueTrack[];
  total: number;
  page: number;
  totalPages: number;
  revision: string;
};
type SearchTrack = QueueTrack & { encoded?: string };
type SearchPlaylist = {
  key: string;
  name: string;
  trackCount: number;
  totalDuration: number;
  artwork?: string | null;
  truncated?: boolean;
};
type SyncedLine = { time: number; text: string };
type PlayerClock = {
  trackKey: string;
  base: number;
  startedAt: number;
  paused: boolean;
};

const EMPTY_STATUS: PlayerStatus = {
  connected: false,
  playing: false,
  paused: false,
  voiceChannelId: null,
  voiceChannelName: null,
  currentTrack: null,
  queueLength: 0,
  repeatMode: 'off',
  volume: 100,
  filters: null,
  autoplay: false,
  voteSkip: null,
  sessionHistory: [],
};

function formatMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function parseSyncedLyrics(value: string | null | undefined): SyncedLine[] {
  if (!value) return [];
  return value
    .split('\n')
    .map((line) => {
      const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (!match) return null;
      return {
        time: (Number(match[1]) * 60 + Number(match[2])) * 1000,
        text: match[3].trim() || '...',
      };
    })
    .filter((line): line is SyncedLine => Boolean(line))
    .sort((a, b) => a.time - b.time);
}

export default function ActivityPage() {
  const sdkRef = useRef<ActivitySdk | null>(null);
  const activityTokenRef = useRef<string | null>(null);
  const drawerCloseTimerRef = useRef<number | null>(null);
  const controlFeedbackFrameRef = useRef<number | null>(null);
  const controlFeedbackTimerRef = useRef<number | null>(null);
  const volumeCommitTimerRef = useRef<number | null>(null);
  const volumeDraggingRef = useRef(false);
  const volumePendingRef = useRef<number | null>(null);
  const volumeControlRef = useRef<HTMLDivElement | null>(null);
  const seekCommitTimerRef = useRef<number | null>(null);
  const seekDraggingRef = useRef(false);
  const seekPendingRef = useRef<number | null>(null);
  const seekRollbackRef = useRef<PlayerClock | null>(null);
  const noticeIdRef = useRef(0);
  const lastServerNoticeIdRef = useRef<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchDebounceTimerRef = useRef<number | null>(null);
  const lastSearchRef = useRef<{ query: string; at: number } | null>(null);
  const lastRichPresenceRef = useRef('');
  const lyricsRequestRef = useRef(0);
  const drawerGestureRef = useRef<{ pointerId: number; startY: number; lastY: number; lastAt: number; velocity: number } | null>(null);
  const clockRef = useRef<PlayerClock>({ trackKey: '', base: 0, startedAt: Date.now(), paused: true });
  const lyricsListRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLParagraphElement | null>(null);
  const queueScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const queueAutoScrollFrameRef = useRef<number | null>(null);
  const queueAutoScrollSpeedRef = useRef(0);
  const [phase, setPhase] = useState<ActivityPhase>('starting');
  const [errorKind, setErrorKind] = useState<ActivityErrorKind>('generic');
  const [summoning, setSummoning] = useState(false);
  const [introExiting, setIntroExiting] = useState(false);
  const [message, setMessage] = useState('Connecting to Discord...');
  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<DashboardCapabilities | null>(null);
  const [status, setStatus] = useState<PlayerStatus>(EMPTY_STATUS);
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const queueLoadedPageRef = useRef(0);
  const queueDesiredPageRef = useRef(0);
  const queueRevisionRef = useRef('empty');
  const queueRestoreIdRef = useRef(0);
  const [queueLoadingMore, setQueueLoadingMore] = useState(false);
  const [queueRestore, setQueueRestore] = useState<{ id: number; revision: string; throughPage: number } | null>(null);
  const [position, setPosition] = useState(0);
  const [activePanel, setActivePanel] = useState<ActivityPanel>(null);
  const [queueView, setQueueView] = useState<'queue' | 'history'>('queue');
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [drawerDragY, setDrawerDragY] = useState<number | null>(null);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const [seekPreview, setSeekPreview] = useState<{
    position: number;
    labelPercent: number;
    arrowOffset: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchTrack[]>([]);
  const [searchPlaylist, setSearchPlaylist] = useState<SearchPlaylist | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchCompletedQuery, setSearchCompletedQuery] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState('');
  const [lyricsTrackUri, setLyricsTrackUri] = useState('');
  const [lyricsSyncEnabled, setLyricsSyncEnabled] = useState(false);
  const [karaokeEnabled, setKaraokeEnabled] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [controlFeedback, setControlFeedback] = useState<string | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [richPresenceRevision, setRichPresenceRevision] = useState(0);
  const [notice, setNotice] = useState<ActivityNotice | null>(null);
  const [noticeClosing, setNoticeClosing] = useState(false);
  const noticeQueueRef = useRef<ActivityNotice[]>([]);

  const notify = useCallback((value: string, tone: ActivityNoticeTone = 'info') => {
    const message = value.trim();
    if (!message) return;
    const next = { id: ++noticeIdRef.current, message, tone };

    setNotice((current) => {
      if (!current) return next;
      if (current.message === message || noticeQueueRef.current.some((entry) => entry.message === message)) return current;
      noticeQueueRef.current = [...noticeQueueRef.current, next].slice(-4);
      return current;
    });
  }, []);

  const getClockPosition = useCallback(() => {
    const clock = clockRef.current;
    return clock.base + (clock.paused ? 0 : Date.now() - clock.startedAt);
  }, []);

  const setClockPosition = useCallback((nextPosition: number) => {
    clockRef.current = { ...clockRef.current, base: nextPosition, startedAt: Date.now() };
    setPosition(nextPosition);
  }, []);

  const activityFetch = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    return activityRequest<T>(path, activityTokenRef.current, options);
  }, []);

  const refreshCapabilities = useCallback(async () => {
    if (!guildId) return null;
    try {
      const access = await activityFetch<DashboardCapabilities>(`/api/guilds/${guildId}/access`);
      setCapabilities(access);
      return access;
    } catch {
      return null;
    }
  }, [activityFetch, guildId]);

  const applySnapshot = useCallback((payload: { status?: PlayerStatus; queue?: QueueSnapshot }) => {
    if (payload.status) {
      const incomingStatus = payload.status;
      const track = incomingStatus.currentTrack;

      if (!track) {
        clockRef.current = { trackKey: '', base: 0, startedAt: Date.now(), paused: true };
        seekRollbackRef.current = null;
        setPosition(0);
        setStatus(incomingStatus);
      } else {
        const now = Date.now();
        const trackKey = `${track.uri}|${track.title}|${track.author}`;
        const previous = clockRef.current;
        const incoming = track.position || 0;
        let stablePosition = incoming;

        if (previous.trackKey && previous.trackKey !== trackKey && (seekDraggingRef.current || seekPendingRef.current !== null)) {
          seekDraggingRef.current = false;
          seekPendingRef.current = null;
          setSeekDraft(null);
          if (seekCommitTimerRef.current) window.clearTimeout(seekCommitTimerRef.current);
          seekCommitTimerRef.current = null;
          seekRollbackRef.current = null;
        }

        if (seekDraggingRef.current || seekPendingRef.current !== null) {
          const target = seekPendingRef.current;
          const confirmed = target !== null && Math.abs(incoming - target) <= 1800;
          if (!confirmed) {
            stablePosition = previous.base;
          } else {
            seekPendingRef.current = null;
            setSeekDraft(null);
            if (seekCommitTimerRef.current) window.clearTimeout(seekCommitTimerRef.current);
            seekCommitTimerRef.current = null;
            seekRollbackRef.current = null;
          }
        }

        if (previous.trackKey === trackKey && !seekDraggingRef.current && seekPendingRef.current === null) {
          const estimated = previous.base + (previous.paused ? 0 : now - previous.startedAt);
          const intentionalBackwardsMove = incoming < estimated - 5000;

          if (incomingStatus.paused && !previous.paused) {
            stablePosition = Math.max(incoming, estimated);
          } else if (incomingStatus.paused && previous.paused && !intentionalBackwardsMove) {
            stablePosition = previous.base;
          } else if (!incomingStatus.paused && !intentionalBackwardsMove) {
            stablePosition = Math.max(incoming, estimated);
          }
        }

        stablePosition = Math.min(track.duration || Infinity, Math.max(0, stablePosition));
        clockRef.current = {
          trackKey,
          base: stablePosition,
          startedAt: now,
          paused: incomingStatus.paused,
        };
        setPosition(stablePosition);
        setStatus({ ...incomingStatus, currentTrack: { ...track, position: stablePosition } });
      }
    }
    if (payload.queue) {
      const incomingQueue = payload.queue;
      const sameRevision = queueRevisionRef.current === incomingQueue.revision;
      const desiredPage = Math.min(queueDesiredPageRef.current, Math.max(0, incomingQueue.totalPages - 1));
      queueRevisionRef.current = incomingQueue.revision;
      if (incomingQueue.page === 0 && queueLoadedPageRef.current > 0 && sameRevision) {
        setQueue((current) => {
          if (!current || current.revision !== incomingQueue.revision) return incomingQueue;
          const retainedPages = current.tracks.slice(incomingQueue.tracks.length);
          return {
            ...incomingQueue,
            page: queueLoadedPageRef.current,
            tracks: [...incomingQueue.tracks, ...retainedPages].slice(0, incomingQueue.total),
          };
        });
      } else if (incomingQueue.page === 0 && sameRevision && desiredPage > 0) {
        // A restore is already rebuilding the requested pages for this revision.
        setQueue(incomingQueue);
      } else if (incomingQueue.page === 0 && !sameRevision && desiredPage > 0) {
        queueLoadedPageRef.current = 0;
        queueDesiredPageRef.current = desiredPage;
        setQueue(incomingQueue);
        setQueueRestore({
          id: ++queueRestoreIdRef.current,
          revision: incomingQueue.revision,
          throughPage: desiredPage,
        });
      } else {
        queueLoadedPageRef.current = incomingQueue.page;
        queueDesiredPageRef.current = incomingQueue.page;
        setQueueRestore(null);
        setQueue(incomingQueue);
      }
    }
  }, []);

  useEffect(() => {
    if (!guildId || !queueRestore) return;
    const restore = queueRestore;
    let cancelled = false;

    async function restoreLoadedQueuePages() {
      try {
        const pages: QueueSnapshot[] = [];
        for (let page = 0; page <= restore.throughPage; page += 1) {
          const snapshot = await activityFetch<QueueSnapshot>(`/api/guilds/${guildId}/queue?page=${page}`);
          if (cancelled || snapshot.revision !== restore.revision) return;
          pages.push(snapshot);
        }

        const first = pages[0];
        const last = pages[pages.length - 1];
        if (!first || !last || cancelled || restore.id !== queueRestoreIdRef.current) return;
        queueLoadedPageRef.current = last.page;
        queueDesiredPageRef.current = last.page;
        setQueue({
          ...first,
          page: last.page,
          tracks: pages.flatMap((page) => page.tracks).slice(0, first.total),
        });
        setQueueRestore((current) => (current?.id === restore.id ? null : current));
      } catch (error) {
        if (cancelled || restore.id !== queueRestoreIdRef.current) return;
        setQueueRestore(null);
        notify(error instanceof Error ? error.message : 'Could not restore loaded queue tracks', 'error');
      }
    }

    restoreLoadedQueuePages();
    return () => {
      cancelled = true;
    };
  }, [activityFetch, guildId, notify, queueRestore]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      let failureKind: ActivityErrorKind = 'generic';
      try {
        setMessage('Preparing Bread...');
        const config = await fetch('/api/activity/config').then(async (response) => {
          if (!response.ok) throw new Error('Activity is not configured');
          return response.json() as Promise<{ enabled: boolean; clientId: string | null; debugFailure?: string | null }>;
        });

        if (config.debugFailure && config.debugFailure in ACTIVITY_ERROR_VISUALS) {
          setErrorKind(config.debugFailure as ActivityErrorKind);
          setMessage('Simulated failure for preview.');
          setPhase('error');
          return;
        }

        if (!config.enabled || !config.clientId) {
          setPhase('error');
          setMessage('Discord Activity is not configured on this deployment.');
          return;
        }        if (typeof window === 'undefined' || window.parent === window) {
          setPhase('unsupported');
          setMessage('Open this page from Discord as a Bread Activity.');
          return;
        }

        setMessage('Connecting to Discord...');
        const { DiscordSDK } = await import('@discord/embedded-app-sdk');
        const injectedSdk = process.env.NODE_ENV !== 'production'
          ? window.__BREAD_TEST_ACTIVITY_SDK__
          : undefined;
        const sdk = injectedSdk || new DiscordSDK(config.clientId) as unknown as ActivitySdk;
        sdkRef.current = sdk;
        await sdk.ready();

        setMessage('Authorizing session...');
        const { code } = await sdk.commands.authorize({
          client_id: config.clientId,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'guilds', 'rpc.activities.write'],
        });
        const tokenResponse = await fetch('/api/activity/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        }).then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            failureKind = 'auth';
            throw new Error(body.error || 'Activity authorization failed');
          }
          return body as { access_token: string };
        });
        const auth = await sdk.commands.authenticate({ access_token: tokenResponse.access_token });
        if (!auth) {
          failureKind = 'auth';
          throw new Error('Discord Activity authentication failed');
        }

        setMessage('Loading your server...');
        activityTokenRef.current = auth.access_token || tokenResponse.access_token;
        if (!sdk.guildId) {
          failureKind = 'voice';
          throw new Error('Open the Activity from a server voice channel');
        }
        if (cancelled) return;

        setGuildId(sdk.guildId);
        // The launch context can be a text channel when the Activity is opened
        // from a player button; playback targeting is resolved server-side.
        setChannelId(sdk.channelId ?? null);
        setMessage('Checking server access...');
        const access = await activityFetch<DashboardCapabilities>(`/api/guilds/${sdk.guildId}/access`);
        if (!access.canAccess) {
          failureKind = 'access';
          throw new Error('You do not have access to Bread on this server');
        }
        if (cancelled) return;
        setCapabilities(access);

        const [initialStatus, initialQueue] = await Promise.allSettled([
          activityFetch<PlayerStatus>(`/api/guilds/${sdk.guildId}/status`),
          activityFetch<QueueSnapshot>(`/api/guilds/${sdk.guildId}/queue?page=0`),
        ]);
        if (cancelled) return;
        applySnapshot({
          status: initialStatus.status === 'fulfilled' ? initialStatus.value : undefined,
          queue: initialQueue.status === 'fulfilled' ? initialQueue.value : undefined,
        });

        setMessage('Activity ready');
        setIntroExiting(true);
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduceMotion) await new Promise((resolve) => window.setTimeout(resolve, 360));
        if (cancelled) return;
        setPhase('ready');
        setMessage('');
      } catch (error) {
        if (cancelled) return;
        const failureMessage = error instanceof Error ? error.message : 'Could not start Bread Activity';

        if (failureKind === 'generic') {
          try {
            const health = await fetch('/api/healthz').then((response) => response.json()) as {
              discord?: { ok?: boolean };
              lavalink?: { ok?: boolean };
            };
            if (health?.discord && health.discord.ok === false) failureKind = 'discord';
            else if (health?.lavalink && health.lavalink.ok === false) failureKind = 'lavalink';
            else if (guildId) {
              const status = await activityFetch<PlayerStatus>(`/api/guilds/${guildId}/status`).catch(() => null);
              if (status && status.connected === false) failureKind = 'voice';
            }
          } catch {
            // Diagnostics are best effort; the generic screen still applies.
          }
        }

        setErrorKind(failureKind);
        setPhase('error');
        setMessage(failureMessage);
      }
    }

    initialize();
    return () => { cancelled = true; };
  }, [activityFetch, applySnapshot]);

  useEffect(() => {
    if (phase !== 'ready' || !guildId) return;
    const refresh = () => { void refreshCapabilities(); };
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [guildId, phase, refreshCapabilities]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const sdk = sdkRef.current;
    if (!sdk?.commands.setActivity) return;

    const activity = buildActivityRichPresence(status, getClockPosition());
    const serialized = JSON.stringify(activity);
    if (serialized === lastRichPresenceRef.current) return;
    lastRichPresenceRef.current = serialized;

    void sdk.commands.setActivity({ activity }).catch((error) => {
      lastRichPresenceRef.current = '';
      console.warn('Could not update Discord Rich Presence:', error);
    });
  }, [
    getClockPosition,
    phase,
    richPresenceRevision,
    status.connected,
    status.currentTrack?.artwork,
    status.currentTrack?.author,
    status.currentTrack?.duration,
    status.currentTrack?.title,
    status.currentTrack?.uri,
    status.paused,
    status.voiceChannelName,
  ]);

  useEffect(() => () => {
    const setActivity = sdkRef.current?.commands.setActivity;
    if (setActivity) void setActivity({ activity: null }).catch(() => undefined);
  }, []);

  const closePanel = useCallback(() => {
    if (!activePanel || drawerClosing) return;
    setDrawerClosing(true);
    if (drawerCloseTimerRef.current) window.clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = window.setTimeout(() => {
      setActivePanel(null);
      setDrawerClosing(false);
      drawerCloseTimerRef.current = null;
    }, 190);
  }, [activePanel, drawerClosing]);

  const togglePanel = useCallback((panel: Exclude<ActivityPanel, null>) => {
    if (drawerCloseTimerRef.current) {
      window.clearTimeout(drawerCloseTimerRef.current);
      drawerCloseTimerRef.current = null;
    }
    if (activePanel === panel && !drawerClosing) {
      setDrawerClosing(true);
      drawerCloseTimerRef.current = window.setTimeout(() => {
        setActivePanel(null);
        setDrawerClosing(false);
        drawerCloseTimerRef.current = null;
      }, 190);
      return;
    }
    setDrawerClosing(false);
    setActivePanel(panel);
  }, [activePanel, drawerClosing]);

  const finishDrawerGesture = useCallback((shouldClose: boolean) => {
    setDrawerDragging(false);
    drawerGestureRef.current = null;

    if (shouldClose) {
      setDrawerClosing(true);
      setDrawerDragY(window.innerHeight);
      if (drawerCloseTimerRef.current) window.clearTimeout(drawerCloseTimerRef.current);
      drawerCloseTimerRef.current = window.setTimeout(() => {
        setActivePanel(null);
        setDrawerClosing(false);
        setDrawerDragY(null);
        drawerCloseTimerRef.current = null;
      }, 220);
      return;
    }

    setDrawerDragY(0);
    window.setTimeout(() => setDrawerDragY(null), 220);
  }, []);

  const handleDrawerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia('(max-width: 700px)').matches || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const now = performance.now();
    drawerGestureRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: now,
      velocity: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawerDragging(true);
    setDrawerDragY(0);
  }, []);

  const handleDrawerPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = drawerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const now = performance.now();
    const elapsed = Math.max(1, now - gesture.lastAt);
    gesture.velocity = ((event.clientY - gesture.lastY) / elapsed) * 1000;
    gesture.lastY = event.clientY;
    gesture.lastAt = now;
    setDrawerDragY(Math.max(0, event.clientY - gesture.startY));
  }, []);

  const handleDrawerPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = drawerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - gesture.startY);
    finishDrawerGesture(distance > 96 || gesture.velocity > 700);
  }, [finishDrawerGesture]);

  useEffect(() => () => {
    if (drawerCloseTimerRef.current) window.clearTimeout(drawerCloseTimerRef.current);
    if (controlFeedbackFrameRef.current) window.cancelAnimationFrame(controlFeedbackFrameRef.current);
    if (controlFeedbackTimerRef.current) window.clearTimeout(controlFeedbackTimerRef.current);
    if (volumeCommitTimerRef.current) window.clearTimeout(volumeCommitTimerRef.current);
    if (seekCommitTimerRef.current) window.clearTimeout(seekCommitTimerRef.current);
    if (searchDebounceTimerRef.current) window.clearTimeout(searchDebounceTimerRef.current);
  }, []);

  useEffect(() => {
    if (!volumeOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!volumeControlRef.current?.contains(event.target as Node)) setVolumeOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setVolumeOpen(false);
    };
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [volumeOpen]);

  const openExternalUrl = useCallback(async (url: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    try {
      await sdkRef.current?.commands.openExternalLink({ url });
    } catch {
      notify('Could not open the link in your browser', 'error');
    }
  }, [notify]);

  useEffect(() => {
    if (phase !== 'ready' || !guildId) return;
    const controller = new AbortController();
    let active = true;
    let retryDelay = 1000;
    let hasReportedDisconnect = false;

    const wait = (delay: number) => new Promise<void>((resolve) => {
      window.setTimeout(resolve, delay);
    });

    async function streamSnapshots() {
      while (active && !controller.signal.aborted) {
        try {
          const response = await fetch(`/api/guilds/${guildId}/player/events?page=0`, {
            headers: { Authorization: `Bearer ${activityTokenRef.current}` },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error('Live player connection failed');

          hasReportedDisconnect = false;
          retryDelay = 1000;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (active) {
            const { value, done } = await reader.read();
            if (done) throw new Error('Live player connection closed');
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split('\n\n');
            buffer = frames.pop() || '';
            for (const frame of frames) {
              const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
              if (!dataLine) continue;
              try {
                const snapshot = JSON.parse(dataLine.slice(5).trim()) as {
                  status?: PlayerStatus;
                  queue?: QueueSnapshot;
                  notice?: ServerNotice | null;
                };
                if (snapshot.notice && snapshot.notice.id !== lastServerNoticeIdRef.current) {
                  lastServerNoticeIdRef.current = snapshot.notice.id;
                  notify(snapshot.notice.message, snapshot.notice.tone);
                }
                applySnapshot(snapshot);
              } catch {
                // The next snapshot repairs malformed or incomplete data.
              }
            }
          }
        } catch (error) {
          if (!active || controller.signal.aborted) return;
          setStatus((current) => ({ ...current, connected: false }));
          if (!hasReportedDisconnect) {
            notify(error instanceof Error ? error.message : 'Live player connection lost', 'warning');
            hasReportedDisconnect = true;
          }
          await wait(retryDelay);
          retryDelay = Math.min(10_000, retryDelay * 2);
        }
      }
    }

    streamSnapshots();
    return () => {
      active = false;
      controller.abort();
    };
  }, [applySnapshot, guildId, notify, phase]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const tick = () => {
      const duration = status.currentTrack?.duration || Infinity;
      if (!seekDraggingRef.current && seekDraft === null) {
        setPosition(Math.min(duration, getClockPosition()));
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [getClockPosition, phase, seekDraft, status.currentTrack?.duration]);

  const playerAction = useCallback(async (action: string, body?: Record<string, unknown>) => {
    if (!guildId) return false;
    const previousClock = { ...clockRef.current };
    const previousStatus = status;

    if (action === 'toggle' && status.currentTrack) {
      const nextPaused = !status.paused;
      const frozenPosition = Math.min(status.currentTrack.duration || Infinity, getClockPosition());
      clockRef.current = { ...clockRef.current, base: frozenPosition, startedAt: Date.now(), paused: nextPaused };
      setPosition(frozenPosition);
      setStatus((current) => ({ ...current, paused: nextPaused, playing: true }));
    }
    if (action === 'autoplay') {
      const nextAutoplay = typeof body?.enabled === 'boolean' ? body.enabled : !status.autoplay;
      setStatus((current) => ({ ...current, autoplay: nextAutoplay }));
    }

    setActionBusy(action);
    try {
      const result = await activityFetch<{ message?: string; voteSkip?: { votes: number; requiredVotes: number } | null }>(`/api/guilds/${guildId}/player/${action}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      if (action === 'skip' && result.message) {
        if (result.voteSkip) notify(result.message, 'info');
      }
      return true;
    } catch (error) {
      if ((error as Error & { status?: number }).status === 403) {
        await refreshCapabilities();
      }
      if (['toggle', 'autoplay', 'seek', 'volume'].includes(action)) {
        const rollbackClock = action === 'seek' ? seekRollbackRef.current || previousClock : previousClock;
        clockRef.current = rollbackClock;
        setStatus(previousStatus);
        setPosition(rollbackClock.base);
        if (action === 'seek') {
          seekPendingRef.current = null;
          setSeekDraft(null);
          seekRollbackRef.current = null;
        }
        if (action === 'volume') {
          volumePendingRef.current = null;
          setVolumeDraft(null);
        }
      }
      notify(error instanceof Error ? error.message : 'Player action failed', 'error');
      return false;
    } finally {
      setActionBusy(null);
    }
  }, [activityFetch, getClockPosition, guildId, notify, refreshCapabilities, status]);

  const flashControl = useCallback((action: string) => {
    if (controlFeedbackFrameRef.current) window.cancelAnimationFrame(controlFeedbackFrameRef.current);
    if (controlFeedbackTimerRef.current) window.clearTimeout(controlFeedbackTimerRef.current);
    setControlFeedback(null);
    controlFeedbackFrameRef.current = window.requestAnimationFrame(() => {
      setControlFeedback(action);
      controlFeedbackFrameRef.current = null;
      controlFeedbackTimerRef.current = window.setTimeout(() => {
        setControlFeedback(null);
        controlFeedbackTimerRef.current = null;
      }, 680);
    });
  }, []);

  const runControlAction = useCallback(async (action: string, body?: Record<string, unknown>) => {
    const applied = await playerAction(action, body);
    if (applied) flashControl(action);
  }, [flashControl, playerAction]);

  const fetchHistoryPage = useCallback((page: number) => {
    return activityFetch<HistoryPage>(`/api/guilds/${guildId}/history?page=${page}&limit=25`);
  }, [activityFetch, guildId]);

  const summonBot = useCallback(async () => {
    if (!guildId || summoning) return;
    setSummoning(true);
    try {
      await activityFetch(`/api/guilds/${guildId}/player/join`, {
        method: 'POST',
        body: JSON.stringify({ channelId: channelId ?? undefined }),
      });
      notify('Bread joined your voice channel', 'success');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Summon failed', 'error');
    } finally {
      setSummoning(false);
    }
  }, [channelId, guildId, notify, summoning]);

  const requeueHistoryTrack = useCallback((uri: string) => {
    const queued = playerAction('play', { query: uri });
    if (queued instanceof Promise) {
      return queued.then((ok) => {
        if (ok) notify('Added to queue from history', 'success');
        return ok;
      });
    }
    return queued;
  }, [notify, playerAction]);

  const playHistoryTrackNow = useCallback((uri: string) => {
    const started = playerAction('playnow', { query: uri });
    if (started instanceof Promise) {
      return started.then((ok) => {
        if (ok) notify('Playing from history', 'success');
        return ok;
      });
    }
    return started;
  }, [notify, playerAction]);

  const commitSeek = useCallback(async (value: number) => {
    const duration = status.currentTrack?.duration || 0;
    const normalized = Math.max(0, Math.min(duration, Math.round(value)));
    seekDraggingRef.current = false;
    if (seekPendingRef.current === normalized) return;
    seekRollbackRef.current = { ...clockRef.current };
    seekPendingRef.current = normalized;
    setClockPosition(normalized);
    setSeekDraft(normalized);

    const applied = await playerAction('seek', { position: normalized });
    if (!applied) {
      seekPendingRef.current = null;
      setSeekDraft(null);
      seekRollbackRef.current = null;
      return;
    }
    setRichPresenceRevision((current) => current + 1);

    if (seekCommitTimerRef.current) window.clearTimeout(seekCommitTimerRef.current);
    seekCommitTimerRef.current = window.setTimeout(() => {
      seekPendingRef.current = null;
      setSeekDraft(null);
      seekRollbackRef.current = null;
      seekCommitTimerRef.current = null;
    }, 1800);
  }, [playerAction, setClockPosition, status.currentTrack?.duration]);

  const volumeLimit = Math.max(1, Math.round(capabilities?.maxVolume ?? 100));
  const commitVolume = useCallback(async (value: number) => {
    const normalized = Math.max(0, Math.min(volumeLimit, Math.round(value)));
    volumeDraggingRef.current = false;
    if (volumePendingRef.current === normalized) return;
    volumePendingRef.current = normalized;

    const applied = await playerAction('volume', { volume: normalized });
    if (!applied) {
      volumePendingRef.current = null;
      setVolumeDraft(null);
      return;
    }

    if (volumeCommitTimerRef.current) window.clearTimeout(volumeCommitTimerRef.current);
    volumeCommitTimerRef.current = window.setTimeout(() => {
      volumePendingRef.current = null;
      setVolumeDraft(null);
      volumeCommitTimerRef.current = null;
    }, 1800);
  }, [playerAction, volumeLimit]);

  useEffect(() => {
    if (volumeDraft === null || volumeDraggingRef.current || volumePendingRef.current === null) return;
    if (status.volume !== volumePendingRef.current) return;
    if (volumeCommitTimerRef.current) window.clearTimeout(volumeCommitTimerRef.current);
    volumePendingRef.current = null;
    volumeCommitTimerRef.current = null;
    setVolumeDraft(null);
  }, [status.volume, volumeDraft]);

  const handleSearch = useCallback(async (queryOverride?: string) => {
    const query = (queryOverride ?? searchQuery).trim();
    if (!query || !guildId) return;
    const now = Date.now();
    if (lastSearchRef.current?.query === query && now - lastSearchRef.current.at < 900) return;
    lastSearchRef.current = { query, at: now };
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true);
    setSearchPlaylist(null);
    setSearchCompletedQuery('');
    try {
      const result = await activityFetch<{ tracks: SearchTrack[]; playlist?: SearchPlaylist | null }>(`/api/guilds/${guildId}/player/search`, {
        method: 'POST',
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setSearchResults(result.tracks || []);
        setSearchPlaylist(result.playlist || null);
        setSearchCompletedQuery(query);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
      setSearchResults([]);
      setSearchPlaylist(null);
      setSearchCompletedQuery('');
      notify(error instanceof Error ? error.message : 'Search failed', 'error');
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setSearching(false);
      }
    }
  }, [activityFetch, guildId, notify, searchQuery]);

  const submitSearch = useCallback(() => {
    if (searchDebounceTimerRef.current) {
      window.clearTimeout(searchDebounceTimerRef.current);
      searchDebounceTimerRef.current = null;
    }
    const query = searchQuery.trim();
    if (!searching && query && searchCompletedQuery !== query) handleSearch(query);
  }, [handleSearch, searchCompletedQuery, searchQuery, searching]);

  useEffect(() => {
    if (activePanel !== 'search') return;
    const query = searchQuery.trim();
    if (!query) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setSearchResults([]);
      setSearchPlaylist(null);
      setSearching(false);
      setSearchCompletedQuery('');
      return;
    }
    searchDebounceTimerRef.current = window.setTimeout(() => {
      searchDebounceTimerRef.current = null;
      handleSearch(query);
    }, 1000);
    return () => {
      if (searchDebounceTimerRef.current) window.clearTimeout(searchDebounceTimerRef.current);
      searchDebounceTimerRef.current = null;
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
    };
  }, [activePanel, handleSearch, searchQuery]);

  const currentTrackUri = status.currentTrack?.uri || '';
  const loadLyrics = useCallback(async () => {
    if (!guildId || !currentTrackUri) return;
    const requestId = ++lyricsRequestRef.current;
    const requestedTrackUri = currentTrackUri;
    setLyricsLoading(true);
    setLyrics(null);
    setLyricsError('');
    setLyricsTrackUri('');
    try {
      const result = await activityFetch<LyricsResult>(`/api/guilds/${guildId}/lyrics`);
      if (requestId !== lyricsRequestRef.current) return;
      setLyrics(result);
      setLyricsTrackUri(requestedTrackUri);
    } catch (error) {
      if (requestId !== lyricsRequestRef.current) return;
      setLyrics(null);
      setLyricsError(error instanceof Error ? error.message : 'Lyrics are unavailable');
      setLyricsTrackUri(requestedTrackUri);
    } finally {
      if (requestId === lyricsRequestRef.current) setLyricsLoading(false);
    }
  }, [activityFetch, currentTrackUri, guildId]);

  useEffect(() => {
    if (activePanel === 'lyrics' || karaokeEnabled) loadLyrics();
    else setLyricsError('');
  }, [activePanel, karaokeEnabled, loadLyrics]);

  useEffect(() => {
    if (!activePanel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePanel, closePanel]);

  useEffect(() => {
    if (!notice) return;
    setNoticeClosing(false);
    const closeTimeout = window.setTimeout(() => setNoticeClosing(true), 4200);
    const removeTimeout = window.setTimeout(() => {
      const next = noticeQueueRef.current.shift() || null;
      setNoticeClosing(false);
      setNotice(next);
    }, 4480);
    return () => {
      window.clearTimeout(closeTimeout);
      window.clearTimeout(removeTimeout);
    };
  }, [notice]);

  const dismissNotice = useCallback(() => {
    if (!notice || noticeClosing) return;
    setNoticeClosing(true);
    window.setTimeout(() => {
      noticeQueueRef.current = [];
      setNotice(null);
      setNoticeClosing(false);
    }, 180);
  }, [notice, noticeClosing]);

  const handleUploadSelection = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    if (!/\.(mp3|flac|wav|ogg|m4a|aac|opus|webm)$/i.test(file.name)) {
      notify('Unsupported audio file type', 'warning');
      event.target.value = '';
      return;
    }
    if (file.size > 256 * 1024 * 1024) {
      notify('Maximum audio upload size is 256 MB', 'warning');
      event.target.value = '';
      return;
    }
    setUploadFile(file);
  }, [notify]);

  const handleUpload = useCallback(async () => {
    if (!guildId || !uploadFile || !activityTokenRef.current) return;
    setUploading(true);
    try {
      const response = await fetch(`/api/guilds/${guildId}/player/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activityTokenRef.current}`,
          'Content-Type': uploadFile.type || 'application/octet-stream',
          // HTTP header values are ASCII-only in browsers; keep the original name encoded.
          'X-File-Name': encodeURIComponent(uploadFile.name),
        },
        body: uploadFile,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Upload failed: ${response.status}`);
      notify(`Queued: ${body.title || uploadFile.name}`, 'success');
      setUploadFile(null);
      setActivePanel('queue');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }, [guildId, notify, uploadFile]);

  const playSearchResult = useCallback(async (track: SearchTrack, mode: 'queue' | 'now') => {
    const startsPlayback = !status.currentTrack;
    const action = mode === 'now' ? 'playnow' : 'play';
    const queued = await playerAction(action, {
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
      channelId,
    });
    if (!queued) return;
    notify(mode === 'now' || startsPlayback ? `Playing now: ${track.title}` : `Added to queue: ${track.title}`, 'success');
    if (mode === 'now' || startsPlayback) {
      setSearchResults([]);
      setSearchQuery('');
      closePanel();
    }
  }, [channelId, closePanel, notify, playerAction, status.currentTrack]);

  const addSearchPlaylist = useCallback(async () => {
    if (!searchPlaylist) return;
    const added = await playerAction('playlist', {
      cacheKey: searchPlaylist.key,
      channelId,
    });
    if (!added) return;
    notify(
      `${status.currentTrack ? 'Added to queue' : 'Playing'}: ${searchPlaylist.name} (${searchPlaylist.trackCount} tracks)`,
      'success',
    );
    setSearchResults([]);
    setSearchPlaylist(null);
    setSearchQuery('');
    closePanel();
  }, [channelId, closePanel, notify, playerAction, searchPlaylist, status.currentTrack]);

  const canDj = capabilities?.canControlPlayer === true;
  const hasTrack = Boolean(status.connected && status.currentTrack);
  const canSeekTrack = Boolean(canDj && status.currentTrack?.seekable);
  const normalizedRepeatMode = String(status.repeatMode || 'off').toLowerCase();
  const loopActive = !['off', 'none', 'false'].includes(normalizedRepeatMode);
  const loopLabel = normalizedRepeatMode === 'track'
    ? 'Loop track'
    : normalizedRepeatMode === 'queue'
      ? 'Loop queue'
      : 'Loop on';
  const displayedVolume = Math.min(volumeLimit, volumeDraft ?? status.volume);
  const currentDuration = status.currentTrack?.duration || 0;
  const displayedPosition = seekDraft ?? position;
  const currentTrackLink = /^https?:\/\//i.test(status.currentTrack?.uri || '') ? status.currentTrack?.uri || '' : '';
  const percent = currentDuration ? Math.min(100, (displayedPosition / currentDuration) * 100) : 0;
  const syncedLyrics = useMemo(() => parseSyncedLyrics(lyrics?.syncedLyrics), [lyrics?.syncedLyrics]);
  const activeLyricIndex = syncedLyrics.reduce((current, line, index) => (line.time <= displayedPosition ? index : current), -1);
  const activeLyric = syncedLyrics[activeLyricIndex]?.text || '';
  const previousLyric = syncedLyrics[activeLyricIndex - 1]?.text || '';
  const nextLyric = syncedLyrics[activeLyricIndex + 1]?.text || '';
  const NoticeIcon = notice?.tone === 'success'
    ? CheckCircle2
    : notice?.tone === 'error' || notice?.tone === 'warning'
      ? AlertTriangle
      : Info;

  useEffect(() => {
    if (!lyricsSyncEnabled || activePanel !== 'lyrics' || activeLyricIndex < 0) return;
    const container = lyricsListRef.current;
    const activeLine = activeLyricRef.current;
    if (!container || !activeLine) return;
    const top = activeLine.offsetTop - container.clientHeight / 2 + activeLine.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [activeLyricIndex, activePanel, lyricsSyncEnabled]);

  useEffect(() => {
    if (!karaokeEnabled || lyricsLoading) return;
    if (lyricsTrackUri !== currentTrackUri || syncedLyrics.length > 0) return;
    setKaraokeEnabled(false);
    setLyricsSyncEnabled(false);
    notify('Synced lyrics are unavailable for this track. Karaoke was closed.', 'warning');
  }, [currentTrackUri, karaokeEnabled, lyricsLoading, lyricsTrackUri, notify, syncedLyrics.length]);

  const stopQueueAutoScroll = useCallback(() => {
    queueAutoScrollSpeedRef.current = 0;
    if (queueAutoScrollFrameRef.current !== null) {
      cancelAnimationFrame(queueAutoScrollFrameRef.current);
      queueAutoScrollFrameRef.current = null;
    }
  }, []);

  const updateQueueAutoScroll = useCallback((clientY: number) => {
    const container = queueScrollContainerRef.current;
    if (!container) return;

    const bounds = container.getBoundingClientRect();
    const edgeSize = Math.min(72, bounds.height * 0.24);
    const distanceFromTop = clientY - bounds.top;
    const distanceFromBottom = bounds.bottom - clientY;
    let speed = 0;

    if (distanceFromTop < edgeSize) {
      speed = -Math.ceil(18 * (1 - Math.max(0, distanceFromTop) / edgeSize));
    } else if (distanceFromBottom < edgeSize) {
      speed = Math.ceil(18 * (1 - Math.max(0, distanceFromBottom) / edgeSize));
    }

    queueAutoScrollSpeedRef.current = speed;
    if (speed === 0 || queueAutoScrollFrameRef.current !== null) return;

    const scroll = () => {
      const scrollContainer = queueScrollContainerRef.current;
      const currentSpeed = queueAutoScrollSpeedRef.current;
      if (!scrollContainer || currentSpeed === 0) {
        queueAutoScrollFrameRef.current = null;
        return;
      }
      scrollContainer.scrollTop += currentSpeed;
      queueAutoScrollFrameRef.current = requestAnimationFrame(scroll);
    };
    queueAutoScrollFrameRef.current = requestAnimationFrame(scroll);
  }, []);

  useEffect(() => stopQueueAutoScroll, [stopQueueAutoScroll]);

  const handleQueueDrop = useCallback(async (targetIndex: number) => {
    stopQueueAutoScroll();
    if (!canDj || dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }
    await playerAction('move', { from: dragIndex, to: targetIndex });
    setDragIndex(null);
    setDropIndex(null);
  }, [canDj, dragIndex, playerAction, stopQueueAutoScroll]);

  const handleQueueRemove = useCallback((index: number) => {
    if (canDj) playerAction('remove', { start: index });
  }, [canDj, playerAction]);

  const loadMoreQueue = useCallback(async () => {
    if (!guildId || !queue || queueLoadingMore || queue.tracks.length >= queue.total) return;
    const nextPage = queueLoadedPageRef.current + 1;
    if (nextPage >= queue.totalPages) return;

    setQueueLoadingMore(true);
    try {
      const nextQueue = await activityFetch<QueueSnapshot>(`/api/guilds/${guildId}/queue?page=${nextPage}`);
      if (nextQueue.revision !== queueRevisionRef.current || nextQueue.revision !== queue.revision) {
        const refreshedQueue = await activityFetch<QueueSnapshot>(`/api/guilds/${guildId}/queue?page=0`);
        queueLoadedPageRef.current = 0;
        queueRevisionRef.current = refreshedQueue.revision;
        setQueue(refreshedQueue);
        notify('Queue changed while loading. Showing the latest tracks.', 'info');
      } else {
        queueLoadedPageRef.current = nextQueue.page;
        queueDesiredPageRef.current = nextQueue.page;
        setQueue((current) => ({
          ...nextQueue,
          tracks: [...(current?.tracks || []), ...nextQueue.tracks],
        }));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load more queue tracks', 'error');
    } finally {
      setQueueLoadingMore(false);
    }
  }, [activityFetch, guildId, notify, queue, queueLoadingMore]);

  const renderSeek = (variant: 'player' | 'karaoke' = 'player') => !hasTrack ? null : (
    <div className={`activity-seek-group activity-seek-group-${variant}`}>
      <div
        className="activity-seek"
        onPointerMove={(event) => {
          if (!canSeekTrack || !currentDuration) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const pointerX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
          const previewPercent = rect.width > 0 ? pointerX / rect.width : 0;
          const labelHalfWidth = Math.min(24, rect.width / 2);
          const labelX = Math.max(labelHalfWidth, Math.min(rect.width - labelHalfWidth, pointerX));
          setSeekPreview({
            position: previewPercent * currentDuration,
            labelPercent: rect.width > 0 ? (labelX / rect.width) * 100 : 0,
            arrowOffset: pointerX - labelX,
          });
        }}
        onPointerLeave={() => setSeekPreview(null)}
      >
        {seekPreview && canSeekTrack && (
          <output
            className="activity-seek-preview"
            style={{
              '--seek-preview-label': `${seekPreview.labelPercent}%`,
              '--seek-preview-arrow-offset': `${seekPreview.arrowOffset}px`,
            } as CSSProperties}
          >
            {formatMs(seekPreview.position)}
          </output>
        )}
        <input
          className="activity-range"
          type="range"
          min={0}
          max={currentDuration || 1}
          value={Math.min(displayedPosition, currentDuration || 1)}
          disabled={!canSeekTrack}
          onPointerDown={(event) => {
            if (seekCommitTimerRef.current) window.clearTimeout(seekCommitTimerRef.current);
            seekCommitTimerRef.current = null;
            seekPendingRef.current = null;
            seekDraggingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            setSeekDraft(Number(event.currentTarget.value));
          }}
          onChange={(event) => setSeekDraft(Number(event.target.value))}
          onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
          onPointerCancel={() => {
            seekDraggingRef.current = false;
            seekPendingRef.current = null;
            setSeekDraft(null);
          }}
          onKeyUp={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
              commitSeek(Number(event.currentTarget.value));
            }
          }}
          onBlur={(event) => {
            if (seekDraft !== null && seekPendingRef.current === null) commitSeek(Number(event.currentTarget.value));
          }}
          style={{ '--range-progress': `${percent}%` } as CSSProperties}
          aria-label={canSeekTrack ? 'Track position' : 'Track position (not seekable)'}
          aria-valuetext={`${formatMs(displayedPosition)} of ${formatMs(currentDuration)}`}
        />
      </div>
      <div className="activity-time-row"><span>{formatMs(displayedPosition)}</span><span>{formatMs(currentDuration)}</span></div>
    </div>
  );

  const renderPlayerControls = (iconOnly = false) => (
    <ActivityPlayerControls
      iconOnly={iconOnly}
      status={status}
      queueTotal={queue?.total || 0}
      canDj={canDj}
      hasTrack={hasTrack}
      actionBusy={actionBusy}
      controlFeedback={controlFeedback}
      loopActive={loopActive}
      runControlAction={runControlAction}
      playerAction={playerAction}
      volumeOpen={volumeOpen}
      setVolumeOpen={setVolumeOpen}
      volumeControlRef={volumeControlRef}
      displayedVolume={displayedVolume}
      volumeLimit={volumeLimit}
      volumeCommitTimerRef={volumeCommitTimerRef}
      volumeDraggingRef={volumeDraggingRef}
      volumePendingRef={volumePendingRef}
      volumeDraft={volumeDraft}
      setVolumeDraft={setVolumeDraft}
      commitVolume={commitVolume}
    />
  );

  if (phase === 'starting') {
    return (
      <main className={'activity-shell activity-intro' + (introExiting ? ' is-leaving' : '')}>
        <div className="activity-intro-backdrop" aria-hidden="true" />
        <div className="activity-intro-content">
          <p className="activity-intro-eyebrow"><span>Bread</span>Music Activity</p>
          <div className="activity-intro-visual" aria-hidden="true">
            <span className="activity-intro-ring" />
            <img src="/assets/breadicon.png?v=3" alt="" />
            <div className="activity-intro-wave">
              <i /><i /><i /><i /><i />
            </div>
          </div>
          <h1>Opening player</h1>
          <p className="activity-intro-message" key={message}>{message}</p>
          <div className="activity-intro-progress" aria-hidden="true"><i /></div>
        </div>
      </main>
    );
  }

  if (phase === 'error') {
    const visual = ACTIVITY_ERROR_VISUALS[errorKind];
    const VisualIcon = visual.icon;
    return (
      <main className="activity-shell activity-centered">
        <div className="activity-status-mark"><VisualIcon size={30} /></div>
        <p className="activity-kicker">Bread Activity</p>
        <h1>{visual.title}</h1>
        <p className="activity-muted">{message}</p>
        <div className="activity-error-actions">
          {errorKind === 'voice' && guildId && (
            <button type="button" className="activity-error-button primary" onClick={summonBot} disabled={summoning}>
              <PlugZap size={16} />{summoning ? 'Summoning…' : 'Summon bot'}
            </button>
          )}
          <button type="button" className="activity-error-button" onClick={() => window.location.reload()}>
            <RefreshCw size={16} />Retry
          </button>
        </div>
      </main>
    );
  }

  if (phase !== 'ready') {
    return (
      <main className="activity-shell activity-centered">
        <div className="activity-status-mark"><Disc3 size={30} /></div>
        <p className="activity-kicker">Bread Activity</p>
        <h1>{phase === 'unsupported' ? 'Open in Discord' : 'Loading Bread'}</h1>
        <p className="activity-muted">{message}</p>
        {phase === 'unsupported' && <a className="activity-link" href="/">Back to Bread</a>}
      </main>
    );
  }

  return (
    <main className="activity-shell activity-workspace-shell">
      <header className="activity-header">
        <button type="button" className="activity-brand" onClick={() => openExternalUrl('https://breadmusic.aleksh.xyz')} aria-label="Open Bread website">
          <img src="/assets/breadicon.png?v=3" alt="" />
          <div><strong>Bread</strong><span>Music Activity</span></div>
        </button>
        <div className="activity-context">
          <span className="activity-live-dot" />
          <span>{status.voiceChannelName || (channelId ? 'Voice channel' : 'Discord')}</span>
          <span className="activity-context-divider" />
          <span>{canDj ? 'DJ controls' : 'View only'}</span>
        </div>
      </header>

      {notice && (
        <div
          key={notice.id}
          className={`activity-notice tone-${notice.tone}${noticeClosing ? ' is-closing' : ''}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <NoticeIcon className="activity-notice-icon" size={17} aria-hidden="true" />
          <span>{notice.message}</span>
          <button type="button" onClick={dismissNotice} aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      <div className="activity-workspace">
        {karaokeEnabled ? (
          <section className={`activity-karaoke-stage ${status.paused ? 'is-paused' : 'is-playing'}`}>
            <div className="activity-karaoke-track">
              <ActivityArtwork src={status.currentTrack?.artwork} />
              <div>
                <div className="activity-mini-brand"><img src="/assets/breadicon.png?v=3" alt="" /><span>{status.paused ? 'Paused' : 'Playing'}</span></div>
                <strong>{status.currentTrack?.title || 'Nothing is playing'}</strong>
                <span className="activity-karaoke-author">{status.currentTrack?.author || 'Bread'}</span>
              </div>
              <button type="button" onClick={() => setKaraokeEnabled(false)} title="Exit karaoke" aria-label="Exit karaoke"><X size={16} /></button>
            </div>
            <div className="activity-karaoke-lines" aria-live="polite" aria-atomic="true">
              {lyricsLoading ? (
                <div className="activity-karaoke-empty"><ActivitySpinner /> Loading lyrics</div>
              ) : lyricsError ? (
                <div className="activity-karaoke-empty">{lyricsError}</div>
              ) : (
                <>
                  <p key={`previous-${activeLyricIndex}`} className="is-previous">{previousLyric}</p>
                  <strong key={`current-${activeLyricIndex}`} className="is-current">{activeLyric || 'Instrumental'}</strong>
                  <p key={`next-${activeLyricIndex}`} className="is-next">{nextLyric}</p>
                </>
              )}
            </div>
            <div className="activity-karaoke-player">
              {renderSeek('karaoke')}
              {renderPlayerControls(true)}
            </div>
          </section>
        ) : (
        <>
        <section className={`activity-compact-player ${status.paused ? 'is-paused' : 'is-playing'}`}>
          <div className="activity-compact-track">
            <div className="activity-compact-art">
              <ActivityArtwork src={status.currentTrack?.artwork} />
              {hasTrack && <span className={`activity-playing-indicator ${status.paused ? 'paused' : ''}`} />}
            </div>
            <div className="activity-compact-copy">
              <div className="activity-compact-brand">
                <img src="/assets/breadicon.png?v=3" alt="" />
                <span>{status.paused ? 'Paused' : 'Playing'}</span>
              </div>
              <h1>
                {currentTrackLink ? (
                  <a href={currentTrackLink} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); openExternalUrl(currentTrackLink); }}>
                    {status.currentTrack?.title}
                  </a>
                ) : status.currentTrack?.title || 'Nothing is playing'}
              </h1>
              <p>{status.currentTrack?.author || 'Bread'}</p>
            </div>
          </div>

          <div className="activity-compact-progress" aria-label={`${formatMs(displayedPosition)} of ${formatMs(currentDuration)}`}>
            <span><i style={{ transform: `scaleX(${percent / 100})` }} /></span>
          </div>

          <div className="activity-compact-badges" aria-label="Playback status">
            <span className={hasTrack && status.paused ? 'paused' : ''}>{hasTrack ? (status.paused ? 'Paused' : 'Now playing') : status.connected ? 'Player idle' : 'Player offline'}</span>
            <span className={status.autoplay ? 'active' : ''}>Autoplay {status.autoplay ? 'on' : 'off'}</span>
            <span className={loopActive ? 'active' : ''}>{loopActive ? loopLabel : 'Loop off'}</span>
            {status.voteSkip && <span className="vote">Skip {status.voteSkip.votes}/{status.voteSkip.requiredVotes}</span>}
          </div>
        </section>

        <section className={`activity-player-stage ${status.paused ? 'is-paused' : 'is-playing'}`}>
          <div className="activity-track-art">
            <ActivityArtwork src={status.currentTrack?.artwork} large />
            {hasTrack && <span className={`activity-playing-indicator ${status.paused ? 'paused' : ''}`} />}
          </div>

          <div className="activity-player-main">
            <div className="activity-track-copy">
              <div className="activity-mini-brand"><img src="/assets/breadicon.png?v=3" alt="" /><span>{status.paused ? 'Paused' : 'Playing'}</span></div>
              <div className="activity-playback-state">
                <span className={hasTrack && status.paused ? 'paused' : ''}>{hasTrack ? (status.paused ? 'Paused' : 'Now playing') : status.connected ? 'Player idle' : 'Player offline'}</span>
                {status.autoplay && <span>Autoplay</span>}
                {loopActive && <span className="loop">{loopLabel}</span>}
                {status.voteSkip && (
                  <span
                    key={`vote-${status.voteSkip.votes}-${status.voteSkip.requiredVotes}`}
                    className="vote"
                  >
                    Skip {status.voteSkip.votes}/{status.voteSkip.requiredVotes}
                  </span>
                )}
              </div>
              <h1>
                {currentTrackLink ? (
                  <a href={currentTrackLink} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); openExternalUrl(currentTrackLink); }}>
                    {status.currentTrack?.title}
                  </a>
                ) : status.currentTrack?.title || 'Nothing is playing'}
              </h1>
              <p>{status.currentTrack?.author || 'Open Add music to start playback.'}</p>
              {hasTrack && <small className="activity-track-requester">Requested by <strong>{status.currentTrack?.requester || 'Unknown'}</strong></small>}
              {hasTrack && (
                <div className="activity-mini-progress" aria-hidden="true">
                  <span><i style={{ transform: `scaleX(${percent / 100})` }} /></span>
                  <time>{formatMs(displayedPosition)} / {formatMs(currentDuration)}</time>
                </div>
              )}
              {renderSeek()}
            </div>

            {hasTrack && renderPlayerControls(true)}
          </div>
        </section>
        </>
        )}

        <ActivityPanelNav
          activePanel={activePanel}
          queueTotal={queue?.total || 0}
          canDj={canDj}
          hasTrack={hasTrack}
          togglePanel={togglePanel}
        />

        {activePanel && (
          <>
            <button type="button" className={`activity-drawer-backdrop ${drawerClosing ? 'is-closing' : ''}`} onClick={closePanel} aria-label="Close panel" />
            <aside
              key={activePanel}
              className={`activity-drawer ${drawerClosing ? 'is-closing' : ''}${drawerDragging ? ' is-dragging' : ''}${drawerClosing && drawerDragY !== null ? ' is-gesture-closing' : ''}`}
              aria-label={`${activePanel} panel`}
              style={drawerDragY === null ? undefined : {
                transform: `translateY(${drawerDragY}px)`,
                transition: drawerDragging ? 'none' : 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <div
                className="activity-drawer-header"
                onPointerDown={handleDrawerPointerDown}
                onPointerMove={handleDrawerPointerMove}
                onPointerUp={handleDrawerPointerEnd}
                onPointerCancel={() => finishDrawerGesture(false)}
              >
                <div>
                  <strong>{activePanel === 'queue' ? 'Queue' : activePanel === 'search' ? 'Add music' : 'Live lyrics'}</strong>
                  <span>
                    {activePanel === 'queue'
                      ? `${queue?.total || 0} tracks - autoplay ${status.autoplay ? 'on' : 'off'}`
                      : activePanel === 'search'
                        ? 'Search or upload audio'
                        : status.currentTrack?.title || 'Current track'}
                  </span>
                </div>
                <button type="button" onClick={closePanel} aria-label="Close panel"><X size={18} /></button>
              </div>

              <div
                className="activity-drawer-body"
                ref={activePanel === 'queue' ? queueScrollContainerRef : undefined}
                onDragOver={(event) => {
                  if (dragIndex === null) return;
                  event.preventDefault();
                  updateQueueAutoScroll(event.clientY);
                }}
                onDragLeave={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) stopQueueAutoScroll();
                }}
              >
                {activePanel === 'queue' && (
                  <>
                    <div className="activity-queue-switch" role="tablist" aria-label="Queue panel view">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={queueView === 'queue'}
                        className={queueView === 'queue' ? 'active' : ''}
                        onClick={() => setQueueView('queue')}
                      >
                        Queue
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={queueView === 'history'}
                        className={queueView === 'history' ? 'active' : ''}
                        onClick={() => setQueueView('history')}
                      >
                        History
                      </button>
                    </div>
                    {queueView === 'history' ? (
                      <ActivityHistoryPanel
                        canDj={canDj}
                        actionBusy={actionBusy}
                        fetchHistoryPage={fetchHistoryPage}
                        onRequeue={requeueHistoryTrack}
                        onPlayNow={playHistoryTrackNow}
                      />
                    ) : (
                      <ActivityQueuePanel
                        queue={queue}
                        status={status}
                        canDj={canDj}
                        actionBusy={actionBusy}
                        queueRestore={queueRestore}
                        dragIndex={dragIndex}
                        dropIndex={dropIndex}
                        queueLoadingMore={queueLoadingMore}
                        setDragIndex={setDragIndex}
                        setDropIndex={setDropIndex}
                        stopQueueAutoScroll={stopQueueAutoScroll}
                        runControlAction={runControlAction}
                        handleQueueDrop={handleQueueDrop}
                        handleQueueRemove={handleQueueRemove}
                        loadMoreQueue={loadMoreQueue}
                      />
                    )}
                  </>
                )}

                {activePanel === 'search' && (
                  <ActivitySearchPanel
                    canDj={canDj}
                    hasTrack={hasTrack}
                    actionBusy={actionBusy}
                    searchQuery={searchQuery}
                    searching={searching}
                    searchPlaylist={searchPlaylist}
                    searchResults={searchResults}
                    searchCompletedQuery={searchCompletedQuery}
                    uploadFile={uploadFile}
                    uploading={uploading}
                    onQueryChange={setSearchQuery}
                    submitSearch={submitSearch}
                    handleUploadSelection={handleUploadSelection}
                    handleUpload={handleUpload}
                    addSearchPlaylist={addSearchPlaylist}
                    playSearchResult={playSearchResult}
                  />
                )}

                {activePanel === 'lyrics' && (
                  <ActivityLyricsPanel
                    lyricsSyncEnabled={lyricsSyncEnabled}
                    karaokeEnabled={karaokeEnabled}
                    lyricsLoading={lyricsLoading}
                    syncedLyrics={syncedLyrics}
                    lyricsError={lyricsError}
                    plainLyrics={lyrics?.plainLyrics}
                    activeLyricIndex={activeLyricIndex}
                    lyricsListRef={lyricsListRef}
                    activeLyricRef={activeLyricRef}
                    onToggleSync={() => setLyricsSyncEnabled((enabled) => !enabled)}
                    onToggleKaraoke={() => {
                      const nextEnabled = !karaokeEnabled;
                      setLyricsSyncEnabled(nextEnabled);
                      setKaraokeEnabled(nextEnabled);
                      closePanel();
                    }}
                    loadLyrics={loadLyrics}
                  />
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </main>
  );
}
