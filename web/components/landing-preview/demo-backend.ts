import type { ActivityBackend } from '@/components/activity/ActivityApp';
import { DEFAULT_SOUND, type SavedSound } from '@/components/activity/ActivitySoundPanel';
import type { DashboardCapabilities, HistoryEntry, LyricsResult, PlayerStatus, SoundState } from '@/lib/api';
import { artwork, autoplayPool, demoStations, demoTracks, soundPresets, stationTrack, type DemoTrack } from './demo';
import { autoplayNext, demoReducer, duration, initialState, trackKey, type DemoAction, type DemoState } from './demo-state';

// The landing page owns the shared demo state; the Activity iframe reads and changes it through this bridge.
export type DemoHost = {
  getState: () => DemoState;
  dispatch: (action: DemoAction) => void;
  subscribe: (listener: () => void) => () => void;
  lyricsRequest: () => number;
  epoch: () => number;
};

declare global {
  interface Window {
    __BREAD_ACTIVITY_DEMO_HOST__?: DemoHost;
  }
}

// Used when /activity/demo is opened on its own, outside the landing page.
export function createLocalHost(): DemoHost {
  let state = initialState();
  let timer: number | undefined;
  const listeners = new Set<() => void>();
  const dispatch = (action: DemoAction) => {
    const next = demoReducer(state, action);
    if (next === state) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getState: () => state,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      timer ??= window.setInterval(() => dispatch({ type: 'tick' }), 1000);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && timer !== undefined) {
          window.clearInterval(timer);
          timer = undefined;
        }
      };
    },
    lyricsRequest: () => 0,
    epoch: () => 0,
  };
}

type Body = Record<string, unknown>;
type Entry = DemoTrack & { addedAt: number };
type Playlist = { id: string; name: string; tracks: Entry[]; updatedAt: number };

class DemoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const STATION_DETAILS: Record<string, { country: string; place: string; tags: string[]; codec: string; bitrate: number }> = {
  lofi: { country: '', place: '', tags: ['lofi', 'chill', 'study'], codec: 'MP3', bitrate: 128 },
  jazz: { country: 'The United States', place: 'New Orleans', tags: ['jazz', 'soul'], codec: 'AAC', bitrate: 192 },
  synth: { country: '', place: '', tags: ['synthwave', 'retro'], codec: 'MP3', bitrate: 128 },
  indie: { country: 'Poland', place: 'Warsaw', tags: ['indie', 'alternative'], codec: 'MP3', bitrate: 320 },
};
const radioStations = demoStations.map((station) => ({ id: station.id, source: 'radio-browser', name: station.name, homepage: '', favicon: station.artwork, ...STATION_DETAILS[station.id] }));
const LIMITS = { liked: 500, playlists: 25, tracks: 500, name: 40, stations: 25 };
const QUEUE_PAGE = 20;
const ACCESS: DashboardCapabilities = {
  accessLevel: 'admin', dashboardAccess: 'members', canAccess: true, canView: true, canControlPlayer: true, canQueue: true,
  canUpload: false, canManageConfig: false, canManageEconomy: false, canUseRemoteControl: true, maxVolume: 100,
};
const LOOP_ORDER = ['off', 'track', 'queue'] as const;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const uriOf = (track: DemoTrack) => track.uri || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.artist} ${track.title}`)}`;
const ms = (track: DemoTrack) => track.live ? 0 : duration(track) * 1000;
const requester = (track: DemoTrack) => track.autoplay ? 'Autoplay' : 'You';
const queueTrack = (track: DemoTrack) => ({
  title: track.title, author: track.artist, uri: uriOf(track), duration: ms(track), artwork: artwork(track), requester: requester(track),
  source: track.source || 'youtube', seekable: track.seekable !== false && !track.live, isStream: Boolean(track.live),
});
const revision = (tracks: DemoTrack[]) => {
  let hash = tracks.length;
  for (const char of tracks.map(uriOf).join('\0')) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `demo-${(hash >>> 0).toString(36)}`;
};
// Keys that change with every chat message; a command that only touched these did nothing.
const CHAT_KEYS = new Set(['messages', 'sequence', 'playerId', 'soundId']);
const unchanged = (before: DemoState, after: DemoState) => (Object.keys(after) as (keyof DemoState)[]).every((key) => CHAT_KEYS.has(key) || before[key] === after[key]);
const toLrc = (lines: { time: number; text: string }[]) => lines.map(({ time, text }) => {
  const seconds = time / 1000;
  return `[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}]${text}`;
}).join('\n');
const text = (value: unknown, max = 200) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
const index = (value: unknown, length: number) => Number.isInteger(value) && (value as number) >= 0 && (value as number) < length ? value as number : null;

// A browser-only stand-in for the bot API. It answers every /api request the real Activity makes from the
// landing demo state, and sends everything else (including /demo/api search and lyrics) to the real network.
export function createDemoBackend(host: DemoHost, originalFetch: typeof fetch = window.fetch.bind(window)): ActivityBackend {
  const registry = new Map<string, DemoTrack>();
  const addedAt = new Map<string, number>();
  const playedAt = new WeakMap<DemoTrack, number>();
  const searchPlaylists = new Map<string, { name: string; tracks: DemoTrack[] }>();
  const panelListeners = new Set<(panel: 'lyrics') => void>();
  let playlists: Playlist[] = [];
  let sounds: SavedSound[] = [];
  let sound: SoundState = { ...DEFAULT_SOUND };
  let syncedPreset = host.getState().preset;
  let epoch = host.epoch();
  let lyricsSeen = 0;
  let lastCurrent: DemoTrack | null = null;
  let sequence = 0;

  const register = (track: DemoTrack) => { registry.set(uriOf(track), track); return track; };
  [...demoTracks, ...autoplayPool, ...demoStations.map(stationTrack)].forEach(register);

  const sync = () => {
    const state = host.getState();
    if (host.epoch() !== epoch) {
      epoch = host.epoch();
      playlists = [];
      sounds = [];
      sound = { ...DEFAULT_SOUND };
      addedAt.clear();
    }
    if (state.preset !== syncedPreset) {
      syncedPreset = state.preset;
      sound = { ...sound, preset: state.preset === 'off' ? null : state.preset };
    }
    if (state.current && state.current !== lastCurrent) {
      playedAt.set(state.current, Date.now());
      register(state.current);
    }
    lastCurrent = state.current;
    if (host.lyricsRequest() > lyricsSeen) {
      lyricsSeen = host.lyricsRequest();
      panelListeners.forEach((open) => open('lyrics'));
    }
  };
  host.subscribe(sync);
  sync();

  // Runs an action against the shared state. Commands the reducer answers with only a private error
  // (and no state change) become a 400, like the bot rejecting the request.
  const apply = (action: DemoAction) => {
    const state = host.getState();
    const resolved = action.type === 'command' ? { ...action, random: Math.random() } : action;
    const preview = demoReducer(state, resolved.type === 'command' ? { ...resolved, silent: false } : resolved);
    const newest = preview.messages.at(-1);
    if (preview.sequence !== state.sequence && newest?.private && newest.kind === 'text' && unchanged(state, preview)) throw new DemoError(400, newest.text || 'That did not work.');
    host.dispatch(resolved);
    return demoReducer(state, resolved);
  };
  const command = (value: string, silent = true) => apply({ type: 'command', value, silent });

  const status = (state = host.getState()): PlayerStatus => {
    const track = state.current;
    const live = Boolean(track?.live);
    const next = state.autoplay && track && !live && !state.queue.length ? autoplayNext(state) : null;
    return {
      connected: true,
      playing: Boolean(track),
      paused: state.paused,
      voiceChannelId: 'demo-voice',
      voiceChannelName: 'listening room',
      currentTrack: track ? { ...queueTrack(track), position: live ? 0 : state.position * 1000 } : null,
      queueLength: state.queue.length,
      repeatMode: state.loop,
      volume: state.volume,
      filters: sound.preset,
      sound,
      autoplay: state.autoplay,
      autoplayNext: next ? { title: next.title, author: next.artist, uri: uriOf(next), duration: ms(next), artwork: artwork(next), source: next.source || 'youtube' } : null,
      autoplayFeedback: state.autoplay && track && state.liked.some((entry) => trackKey(entry) === trackKey(track)) ? 'like' : null,
      autoplayRateable: Boolean(state.autoplay && track && !live),
      voteSkip: null,
      sessionHistory: state.previous.slice(-2).reverse().map(queueTrack),
    };
  };

  const queue = (page: number, state = host.getState()) => ({
    current: state.current ? queueTrack(state.current) : null,
    tracks: state.queue.slice(page * QUEUE_PAGE, page * QUEUE_PAGE + QUEUE_PAGE).map(queueTrack),
    total: state.queue.length,
    page,
    totalPages: Math.ceil(state.queue.length / QUEUE_PAGE),
    revision: revision(state.queue),
  });

  const history = (page: number, limit: number) => {
    const state = host.getState();
    const played = [...state.previous, ...(state.current && !state.current.live ? [state.current] : [])].reverse();
    const items: HistoryEntry[] = played.slice(page * limit, page * limit + limit).map((track, offset) => ({
      id: `demo-${page * limit + offset}`,
      playedAt: playedAt.get(track) ?? Date.now() - (page * limit + offset + 1) * 240_000,
      autoplay: Boolean(track.autoplay),
      track: { title: track.title, author: track.artist, uri: uriOf(track), duration: ms(track), artwork: artwork(track), source: track.source || 'youtube' },
      requester: track.autoplay ? null : { userId: 'demo', username: 'you', displayName: 'You', avatar: null },
    }));
    return { items, page, limit, total: played.length, totalPages: Math.ceil(played.length / limit) };
  };

  const entry = (track: DemoTrack) => {
    const key = trackKey(track);
    if (!addedAt.has(key)) addedAt.set(key, Date.now());
    return { key, title: track.title, author: track.artist, uri: uriOf(track), duration: ms(track), artwork: artwork(track), source: track.source || 'youtube', addedAt: addedAt.get(key)! };
  };
  const summary = (playlist: Playlist) => ({
    id: playlist.id, name: playlist.name, trackCount: playlist.tracks.length,
    duration: playlist.tracks.reduce((total, track) => total + ms(track), 0),
    artwork: playlist.tracks[0] ? artwork(playlist.tracks[0]) : null, updatedAt: playlist.updatedAt, shareCode: null,
  });
  const stations = (state = host.getState()) => state.savedStations.flatMap((id) => {
    const station = radioStations.find((entry) => entry.id === id);
    return station ? [{ ...station, addedAt: addedAt.get(`station:${id}`) ?? Date.now() }] : [];
  });
  const snapshot = (state = host.getState()) => ({
    liked: state.liked.map(entry),
    playlists: playlists.map(summary),
    stations: stations(state),
    sounds,
    limits: LIMITS,
  });
  const dislikes = (state = host.getState()) => {
    const blocked = state.disliked.filter((entry) => entry.blockedArtist);
    return {
      artists: [...new Set(blocked.map((entry) => entry.artist))].map((author) => ({
        artistKey: author.toLowerCase(), author, tracks: state.disliked.filter((entry) => entry.artist === author && entry.title).length,
      })),
      tracks: state.disliked.filter((entry) => entry.title).map((entry) => {
        const key = trackKey(entry);
        const known = [...registry.values()].find((track) => trackKey(track) === key);
        if (!addedAt.has(`dislike:${key}`)) addedAt.set(`dislike:${key}`, Date.now());
        return { key, title: entry.title, author: entry.artist, artistKey: entry.artist.toLowerCase(), duration: known ? ms(known) : null, artwork: known ? artwork(known) : null, at: addedAt.get(`dislike:${key}`)! };
      }),
    };
  };
  const findPlaylist = (id: string) => {
    const playlist = playlists.find((entry) => entry.id === id);
    if (!playlist) throw new DemoError(404, 'Playlist not found.');
    return playlist;
  };
  const trackFromBody = (body: Body) => {
    const query = text(body.query, 2048);
    if (body.origin === 'history') {
      const track = query ? registry.get(query) : null;
      if (!track) throw new DemoError(404, 'That track is no longer available in the demo.');
      return track;
    }
    const meta = (body.track || {}) as Body;
    const uri = text(meta.uri, 2048);
    const known = uri ? registry.get(uri) : null;
    if (known) return known;
    if (!text(meta.title) || typeof meta.duration !== 'number') throw new DemoError(400, 'Search for a track first.');
    const seconds = Math.round(meta.duration / 1000);
    return register({ title: String(meta.title), artist: String(meta.author || 'Unknown'), cover: '', duration: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, uri: uri || undefined, artwork: text(meta.artwork, 2048) || undefined, source: text(meta.source) || undefined, seekable: meta.seekable !== false });
  };
  const queueTracks = (tracks: DemoTrack[], name: string, mode: 'queue' | 'now' = 'queue') => {
    if (!tracks.length) throw new DemoError(400, 'There is nothing to queue.');
    apply({ type: 'resolved', tracks, command: `/play ${name}`, mode });
  };

  const search = async (query: string, signal?: AbortSignal | null) => {
    const response = await originalFetch('/demo/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal });
    const data = await response.json().catch(() => ({})) as { error?: string; mode?: string; tracks?: DemoTrack[]; playlist?: { name: string; total: number; truncated: boolean } | null };
    if (!response.ok) throw new DemoError(response.status, data.error || 'Search failed. Please retry.');
    const tracks = (data.tracks || []).map(register);
    if (data.mode === 'catalogue' && !tracks.length) throw new DemoError(404, 'Live search is not enabled. Try Daft Punk, Kendrick Lamar or Quebonafide.');
    let playlist = null;
    if (data.playlist && tracks.length) {
      const key = `demo-playlist-${++sequence}`;
      searchPlaylists.set(key, { name: data.playlist.name, tracks });
      playlist = { key, name: data.playlist.name, trackCount: tracks.length, totalDuration: tracks.reduce((total, track) => total + ms(track), 0), artwork: artwork(tracks[0]), truncated: data.playlist.truncated };
    }
    return { tracks: tracks.map((track) => ({ ...queueTrack(track), origin: 'search' })), playlist };
  };

  const lyrics = async (signal?: AbortSignal | null): Promise<LyricsResult> => {
    const track = host.getState().current;
    if (!track) throw new DemoError(404, 'Nothing is playing.');
    if (track.live) throw new DemoError(404, 'Lyrics are not available for live radio.');
    const response = await originalFetch('/demo/api/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist: track.artist, title: track.title, duration: ms(track) }), signal });
    const data = await response.json().catch(() => ({})) as { error?: string; lyrics?: { plainLyrics: string; lines: { time: number; text: string }[]; instrumental: boolean; provider: string } | null };
    if (!response.ok) throw new DemoError(response.status, data.error || 'Lyrics are unavailable.');
    if (!data.lyrics) throw new DemoError(404, 'No lyrics found for this track.');
    return { id: null, title: track.title, artist: track.artist, album: null, duration: duration(track), instrumental: data.lyrics.instrumental, plainLyrics: data.lyrics.plainLyrics, syncedLyrics: toLrc(data.lyrics.lines), provider: data.lyrics.provider };
  };

  // Live player stream: a fresh frame whenever anything but the clock changes, or the clock drifts.
  const events = (signal?: AbortSignal | null) => {
    const encoder = new TextEncoder();
    let stop = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let lastKey = '';
        let lastPosition = 0;
        let lastAt = 0;
        let lastPaused = true;
        const push = () => {
          const current = status();
          const page = queue(0);
          const position = current.currentTrack?.position ?? 0;
          const key = JSON.stringify([{ ...current, currentTrack: current.currentTrack && { ...current.currentTrack, position: 0 } }, page]);
          const expected = lastPosition + (lastPaused ? 0 : Date.now() - lastAt);
          if (key === lastKey && Math.abs(position - expected) < 1500) return;
          lastKey = key;
          lastPosition = position;
          lastAt = Date.now();
          lastPaused = current.paused;
          try {
            controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify({ status: current, queue: page })}\n\n`));
          } catch {
            stop();
          }
        };
        push();
        const unsubscribe = host.subscribe(push);
        stop = () => {
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        };
        signal?.addEventListener('abort', stop, { once: true });
      },
      cancel() { stop(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
  };

  const player = async (action: string, body: Body, signal?: AbortSignal | null): Promise<unknown> => {
    const state = host.getState();
    switch (action) {
      case 'toggle': command(state.paused ? '/resume' : '/pause'); return { success: true };
      case 'skip': case 'back': case 'stop': case 'shuffle': command(`/${action}`); return { success: true };
      case 'loop': {
        const next = LOOP_ORDER[(LOOP_ORDER.indexOf(state.loop) + 1) % LOOP_ORDER.length];
        command(`/loop ${next}`);
        return { success: true, repeatMode: next };
      }
      case 'autoplay': {
        const enabled = typeof body.enabled === 'boolean' ? body.enabled : !state.autoplay;
        if (enabled !== state.autoplay) command('/autoplay toggle', false);
        return { success: true, autoplay: enabled };
      }
      case 'autoplay_like': {
        const track = state.current;
        if (track && state.liked.some((entry) => trackKey(entry) === trackKey(track))) {
          apply({ type: 'like', track, liked: false });
          return { success: true, liked: false };
        }
        command('/autoplay like');
        return { success: true, liked: true };
      }
      case 'autoplay_dislike': command('/autoplay dislike'); return { success: true };
      case 'autoplay_reroll': command('/autoplay next'); return { success: true };
      case 'radio': {
        const station = demoStations.find((entry) => entry.id === body.stationId);
        if (!station) throw new DemoError(404, 'Station not found.');
        command(`/radio ${station.id}`, false);
        return { success: true };
      }
      case 'seek': {
        if (!state.current || state.current.live || state.current.seekable === false) throw new DemoError(409, 'This track cannot be seeked.');
        if (typeof body.position !== 'number' || body.position < 0) throw new DemoError(400, 'Invalid position');
        apply({ type: 'seek', position: body.position / 1000 });
        return { success: true, position: body.position };
      }
      case 'volume': {
        const volume = Math.round(Number(body.volume));
        if (!Number.isFinite(volume)) throw new DemoError(400, 'Invalid volume');
        if (volume !== state.volume) command(`/volume ${volume}`);
        return { success: true };
      }
      case 'play': case 'playnow': {
        const track = trackFromBody(body);
        queueTracks([track], `${track.artist} - ${track.title}`, action === 'playnow' ? 'now' : 'queue');
        return { success: true };
      }
      case 'playlist': {
        const playlist = searchPlaylists.get(String(body.cacheKey));
        if (!playlist) throw new DemoError(404, 'Search for the playlist again.');
        queueTracks(playlist.tracks, playlist.name);
        return { success: true };
      }
      case 'library': {
        const liked = body.playlistId === 'liked';
        const source = liked ? { name: 'Liked tracks', tracks: state.liked } : findPlaylist(String(body.playlistId));
        const tracks = [...source.tracks];
        if (body.shuffle) for (let i = tracks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; }
        queueTracks(tracks, source.name);
        return { title: source.name, count: tracks.length };
      }
      case 'move': {
        const from = index(body.from, state.queue.length);
        const to = index(body.to, state.queue.length);
        if (from === null || to === null) throw new DemoError(400, 'Invalid index');
        apply({ type: 'move', from, to });
        return { success: true };
      }
      case 'remove': {
        const start = index(body.start, state.queue.length);
        if (start === null) throw new DemoError(400, 'Invalid range');
        apply({ type: 'remove', index: start });
        return { success: true, removed: 1 };
      }
      case 'join': return { success: true };
      case 'sound': {
        const next = body.sound as SoundState | undefined;
        if (!next || !Array.isArray(next.eq)) throw new DemoError(400, 'Invalid sound');
        sound = { preset: next.preset ?? null, eq: next.eq.slice(0, 6).map(Number), speed: Number(next.speed) || 1, pitch: Number(next.pitch) || 1 };
        const preset = sound.preset ?? 'off';
        // Presets the chat knows stay in sync with /sound; the Activity-only ones live here.
        if (preset !== state.preset && soundPresets.some((entry) => entry.id === preset)) {
          syncedPreset = preset;
          apply({ type: 'preset', preset });
        }
        return { sound };
      }
      case 'search': {
        const query = text(body.query);
        if (!query) throw new DemoError(400, 'Enter a title or artist.');
        return search(query, signal);
      }
      case 'upload': throw new DemoError(403, 'Uploads are not available in the demo.');
      default: throw new DemoError(400, `Unknown action: ${action}`);
    }
  };

  const library = (path: string, body: Body | null) => {
    const state = host.getState();
    if (!body) {
      if (path === '') return snapshot();
      if (path === '/dislikes') return dislikes();
      const match = path.match(/^\/playlists\/([^/]+)$/);
      if (match) {
        const playlist = findPlaylist(decodeURIComponent(match[1]));
        return { id: playlist.id, name: playlist.name, tracks: playlist.tracks.map(entry), shareCode: null };
      }
      throw new DemoError(404, 'Not found');
    }
    if (path === '/dislikes/remove') {
      const target = state.disliked.find((entry) => entry.title && trackKey(entry) === body.key);
      return dislikes(target ? apply({ type: 'undislike', title: target.title, artist: target.artist }) : state);
    }
    if (path === '/dislikes/block') return dislikes(apply({ type: 'block', artist: String(body.author || '') }));
    if (path === '/dislikes/unblock') {
      const target = state.disliked.find((entry) => entry.blockedArtist && entry.artist.toLowerCase() === body.artistKey);
      return dislikes(target ? apply({ type: 'unblock', artist: target.artist }) : state);
    }
    if (path === '/liked/add') {
      const track = registry.get(String(body.uri));
      if (!track || track.live) throw new DemoError(404, 'That track can not be liked.');
      apply({ type: 'like', track, liked: true });
      return { title: track.title };
    }
    if (path === '/liked/remove') {
      const track = state.liked.find((entry) => trackKey(entry) === body.key);
      return snapshot(track ? apply({ type: 'like', track, liked: false }) : state);
    }
    if (path === '/playlists') {
      const name = text(body.name, LIMITS.name);
      if (!name) throw new DemoError(400, `Name the playlist (up to ${LIMITS.name} characters).`);
      if (playlists.length >= LIMITS.playlists) throw new DemoError(400, `You can keep up to ${LIMITS.playlists} playlists.`);
      const tracks = body.from === 'queue' ? [state.current, ...state.queue].filter((track): track is DemoTrack => Boolean(track && !track.live)) : [];
      const playlist: Playlist = { id: `demo-${++sequence}`, name, tracks: tracks.slice(0, LIMITS.tracks).map((track) => ({ ...track, autoplay: undefined, addedAt: Date.now() })), updatedAt: Date.now() };
      playlists = [...playlists, playlist];
      return { playlist: summary(playlist), added: playlist.tracks.length };
    }
    if (path === '/import') throw new DemoError(400, 'Importing is not available in the demo. Paste the link into Add music instead.');
    if (path === '/stations/add' || path === '/stations/remove') {
      const id = String(path === '/stations/add' ? body.stationId : body.id);
      if (!demoStations.some((station) => station.id === id)) throw new DemoError(404, 'Station not found.');
      if (state.savedStations.includes(id) === (path === '/stations/add')) return { stations: stations() };
      addedAt.set(`station:${id}`, Date.now());
      return { stations: stations(apply({ type: 'saveStation', id })) };
    }
    if (path === '/sounds/save') {
      const name = text(body.name, LIMITS.name);
      const value = body.sound as SoundState | undefined;
      if (!name || !value) throw new DemoError(400, 'Name the sound first.');
      const replaced = sounds.some((entry) => entry.name.toLowerCase() === name.toLowerCase());
      sounds = [...sounds.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase()), { id: `demo-${++sequence}`, name, sound: value, createdAt: Date.now() }];
      return { sounds, replaced };
    }
    if (path === '/sounds/remove') {
      sounds = sounds.filter((entry) => entry.id !== body.id);
      return { sounds };
    }
    const match = path.match(/^\/playlists\/([^/]+)\/(add|remove|share|delete)$/);
    if (!match) throw new DemoError(404, 'Not found');
    const playlist = findPlaylist(decodeURIComponent(match[1]));
    const update = (tracks: Entry[]) => {
      const next = { ...playlist, tracks, updatedAt: Date.now() };
      playlists = playlists.map((entry) => entry.id === playlist.id ? next : entry);
      return next;
    };
    if (match[2] === 'add') {
      const track = body.from === 'current' ? state.current : registry.get(String(body.uri));
      if (!track || track.live) throw new DemoError(400, 'Play a track first.');
      if (playlist.tracks.some((entry) => trackKey(entry) === trackKey(track))) return { added: 0 };
      if (playlist.tracks.length >= LIMITS.tracks) throw new DemoError(400, 'This playlist is full.');
      update([...playlist.tracks, { ...track, autoplay: undefined, addedAt: Date.now() }]);
      return { added: 1 };
    }
    if (match[2] === 'remove') {
      const at = index(body.index, playlist.tracks.length);
      if (at === null) throw new DemoError(400, 'Invalid index');
      const next = update(playlist.tracks.filter((_, position) => position !== at));
      return { playlist: { id: next.id, name: next.name, tracks: next.tracks.map(entry), shareCode: null } };
    }
    if (match[2] === 'share') throw new DemoError(400, 'Sharing playlists is not available in the demo.');
    playlists = playlists.filter((entry) => entry.id !== playlist.id);
    return { success: true };
  };

  const route = async (url: URL, init: RequestInit | undefined) => {
    const method = (init?.method || 'GET').toUpperCase();
    let body: Body | null = null;
    if (method !== 'GET' && typeof init?.body === 'string' && init.body) {
      try { body = JSON.parse(init.body) as Body; } catch { throw new DemoError(400, 'Invalid request'); }
    }
    const path = url.pathname;
    if (path === '/api/activity/config') return json({ enabled: true, clientId: 'demo' });
    if (path === '/api/activity/token') return json({ access_token: 'demo' });
    if (path === '/api/healthz') return json({ discord: { ok: true }, lavalink: { ok: true } });
    const match = path.match(/^\/api\/guilds\/demo(\/.*)$/);
    if (!match) throw new DemoError(404, 'Not found');
    const rest = match[1];
    if (rest === '/access') return json(ACCESS);
    if (rest === '/status') return json(status());
    if (rest === '/queue') return json(queue(Math.max(0, Number(url.searchParams.get('page')) || 0)));
    if (rest === '/history') return json(history(Math.max(0, Number(url.searchParams.get('page')) || 0), Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 25))));
    if (rest === '/lyrics') return json(await lyrics(init?.signal));
    if (rest === '/radio/search') {
      const query = (url.searchParams.get('q') || '').trim().toLowerCase();
      return json({ stations: radioStations.filter((station) => !query || `${station.name} ${station.tags.join(' ')} ${station.place} ${station.country}`.toLowerCase().includes(query)) });
    }
    if (rest === '/player/events') return events(init?.signal);
    const action = rest.match(/^\/player\/([a-z_]+)$/);
    if (action && method === 'POST') return json(await player(action[1], body || {}, init?.signal));
    if (rest === '/library' || rest.startsWith('/library/')) return json(library(rest.slice('/library'.length), method === 'POST' ? body || {} : null));
    throw new DemoError(404, 'Not found');
  };

  const demoFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
    try {
      return await route(url, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof DemoError) return json({ error: error.message }, error.status);
      return json({ error: error instanceof Error ? error.message : 'Demo request failed' }, 500);
    }
  };

  return {
    fetch: demoFetch,
    uploadsDisabled: true,
    subscribePanel(open) {
      panelListeners.add(open);
      sync();
      return () => { panelListeners.delete(open); };
    },
    sdk: {
      ready: async () => {},
      guildId: 'demo',
      channelId: 'demo-voice',
      commands: {
        authorize: async () => ({ code: 'demo' }),
        authenticate: async () => ({ access_token: 'demo' }),
        openExternalLink: async ({ url }) => ({ opened: Boolean(window.open(url, '_blank', 'noopener')) }),
        setActivity: async () => null,
      },
    },
  };
}
