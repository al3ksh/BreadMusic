import contract from './bot-contract.json';
import { artwork, autoplayPool, demoStations, demoTracks, soundPresets, stationTrack, statsViews, type DemoTrack } from './demo';

export type Embed = { title: string; description?: string; color: number; fields?: { name: string; value: string; inline?: boolean }[]; footer?: { text: string }; thumbnail?: { url: string } };
export type Playback = { current: DemoTrack | null; queue: DemoTrack[]; previous: DemoTrack[]; paused: boolean; position: number; volume: number; loop: 'off' | 'track' | 'queue' };
export type Message = { id: number; command?: string; kind: 'player' | 'embed' | 'text' | 'slots' | 'stats' | 'sound'; embed?: Embed; text?: string; snapshot: Playback; private?: boolean; round?: number; view?: string; stationId?: string; preset?: string };
export type Dislike = { title: string; artist: string; blockedArtist: boolean };
export type DemoState = Playback & { messages: Message[]; sequence: number; playerId: number; soundId: number; autoplay: boolean; autoplayCursor: number; liked: DemoTrack[]; disliked: Dislike[]; preset: string; savedStations: string[] };
export const trackKey = (track: Pick<DemoTrack, 'artist' | 'title'>) => `${track.artist}|${track.title}`.toLowerCase();
export const duration = (track: DemoTrack) => track.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0);
export const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const trackUrl = (track: DemoTrack) => track.uri || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.artist} ${track.title}`)}`;
const link = (track: DemoTrack) => `[${track.title}](${trackUrl(track)})`;
const VOICE_CHANNEL = '<#123456789012345678>';

// What autoplay would play once the queue runs out, skipping the current track and anything disliked.
export function autoplayNext(state: Pick<DemoState, 'current' | 'disliked' | 'autoplayCursor'>): DemoTrack | null {
  const options = autoplayPool.filter(track => track.title !== state.current?.title && !state.disliked.some(entry => entry.blockedArtist ? entry.artist === track.artist : entry.title === track.title));
  return options.length ? options[state.autoplayCursor % options.length] : null;
}

export function trackEmbed(kind: 'nowPlaying' | 'added', track: DemoTrack, state: Playback, autoplay?: { upNext: DemoTrack | null }): Embed {
  const embed: Embed = structuredClone(track.embeds?.[kind] || contract[kind]);
  embed.description = embed.description!.replaceAll('TRACK_ARTIST', track.artist).replaceAll('TRACK_TITLE', track.title).replaceAll('https://example.invalid/track', trackUrl(track));
  embed.thumbnail = { url: artwork(track) };
  embed.fields![0].value = track.artist;
  embed.fields![1].value = track.live ? 'LIVE' : track.duration;
  if (kind === 'nowPlaying') {
    const index = Math.round(Math.min(1, state.position / Math.max(1, duration(track))) * 18);
    const progress = track.live ? '🔴 LIVE' : `${'▬'.repeat(index)}🔘${'▬'.repeat(18 - index)}\n${time(state.position)} / ${track.duration}`;
    embed.description = `${embed.description.split('\n')[0]}\n${progress}`;
    if (autoplay) embed.title = 'Now Playing [AUTO]';
    embed.color = state.paused ? contract.empty.color : contract.nowPlaying.color;
    embed.fields![2].value = `${state.volume}%`;
    embed.fields![3].value = state.loop[0].toUpperCase() + state.loop.slice(1);
    if (track.live) embed.fields![4].value = 'radio';
    if (track.autoplay) embed.footer = { text: 'Picked by autoplay' };
    // The real bot only shows this while nothing else is queued and the track is not a stream.
    if (autoplay && !state.queue.length && !track.live) {
      const next = autoplay.upNext;
      embed.fields!.push({ name: '📻 Up next', value: next ? `[${next.artist} - ${next.title}](${trackUrl(next)})` : '*Picking a track…*', inline: false });
    }
  }
  return embed;
}

export function queueEmbed(state: Playback, page = 0): Embed {
  const embed: Embed = structuredClone(contract.queue);
  const pages = Math.max(1, Math.ceil(state.queue.length / 10));
  const currentPage = Math.max(0, Math.min(page, pages - 1));
  let eta = state.current ? duration(state.current) - state.position : 0;
  const lines = state.queue.map((track, index) => {
    const line = `\`${index + 1}.\` ${link(track)}\n    Author: ${track.artist} | ETA ${time(eta)} | ${track.duration}`;
    eta += duration(track);
    return line;
  });
  embed.description = lines.slice(currentPage * 10, currentPage * 10 + 10).join('\n') || contract.emptyQueue.description;
  embed.fields![0].value = state.current ? link(state.current) : 'Nothing is playing.';
  embed.fields![1].value = time(eta);
  embed.footer = { text: `Page ${currentPage + 1}/${pages}` };
  return embed;
}

export function soundEmbed(presetId: string): Embed {
  const preset = soundPresets.find(entry => entry.id === presetId) || soundPresets[0];
  return { title: '🎚️ Sound', description: `Preset: **${preset.label}**${preset.id === 'off' ? ' · flat' : ''}\n${preset.description}`, color: contract.empty.color, footer: { text: 'Changes apply live and stay in sync with the Activity and dashboard.' } };
}

function post(state: DemoState, message: Omit<Message, 'id' | 'snapshot'>): DemoState {
  const id = state.sequence + 1;
  const { current, queue, previous, paused, position, volume, loop } = state;
  const snapshot = { current, queue: [...queue], previous: [...previous], paused, position, volume, loop };
  return { ...state, sequence: id, playerId: message.kind === 'player' ? id : state.playerId, soundId: message.kind === 'sound' ? id : state.soundId, messages: [...state.messages, { ...message, id, snapshot }].slice(-40) };
}
export function initialState(): DemoState {
  const state: DemoState = { current: demoTracks[0], queue: demoTracks.slice(1), previous: [], paused: false, position: 84, volume: 100, loop: 'off', messages: [], sequence: 0, playerId: 0, soundId: 0, autoplay: false, autoplayCursor: 0, liked: [], disliked: [], preset: 'off', savedStations: [] };
  return post(state, { kind: 'player', command: '/play Daft Punk - Instant Crush' });
}
const remember = (state: DemoState) => state.current && !state.current.live ? [...state.previous, state.current].slice(-20) : state.previous;
function advance(state: DemoState, natural = false): DemoState {
  if (natural && state.loop === 'track') return { ...state, position: 0 };
  const queue = [...state.queue];
  if (state.current && state.loop === 'queue' && !state.current.live) queue.push(state.current);
  let current = queue.shift() || null;
  let autoplayCursor = state.autoplayCursor;
  if (!current && state.autoplay && state.current && !state.current.live) {
    const pick = autoplayNext(state);
    if (pick) { current = { ...pick, autoplay: true }; autoplayCursor += 1; }
  }
  return post({ ...state, current, queue, autoplayCursor, paused: false, position: 0, previous: remember(state) }, { kind: 'player' });
}
export type DemoAction = { type: 'command'; value: string; random?: number; silent?: boolean } | { type: 'tick' } | { type: 'reset' } | { type: 'resolved'; tracks: DemoTrack[]; command?: string; mode?: 'now' | 'queue' } | { type: 'error'; message: string; command?: string } | { type: 'remove'; index: number } | { type: 'move'; from: number; to: number } | { type: 'seek'; position: number } | { type: 'preset'; preset: string } | { type: 'saveStation'; id: string } | { type: 'like'; track: DemoTrack; liked: boolean } | { type: 'undislike'; title: string; artist: string } | { type: 'block'; artist: string } | { type: 'unblock'; artist: string };
// Activity actions run as commands but answer in the Activity itself, so their private replies stay out of the chat.
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === 'command' && action.silent) {
    const next = reduce(state, { ...action, silent: false });
    return next.messages === state.messages ? next : { ...next, messages: next.messages.filter(message => message.id <= state.sequence || !message.private) };
  }
  return reduce(state, action);
}
function reduce(state: DemoState, action: DemoAction): DemoState {
  if (action.type === 'reset') return initialState();
  if (action.type === 'seek') {
    if (!state.current || state.current.seekable === false || !Number.isFinite(action.position) || !duration(state.current)) return state;
    return { ...state, position: Math.max(0, Math.min(duration(state.current) - .001, action.position)) };
  }
  if (action.type === 'error') return post(state, { kind: 'text', text: action.message, command: action.command, private: true });
  if (action.type === 'remove') return { ...state, queue: state.queue.filter((_, index) => index !== action.index) };
  if (action.type === 'move') {
    if (![action.from, action.to].every(index => Number.isInteger(index) && index >= 0 && index < state.queue.length)) return state;
    const queue = [...state.queue]; queue.splice(action.to, 0, queue.splice(action.from, 1)[0]);
    return { ...state, queue };
  }
  if (action.type === 'like') {
    const rest = state.liked.filter(track => trackKey(track) !== trackKey(action.track));
    return { ...state, liked: action.liked ? [{ ...action.track, autoplay: undefined }, ...rest] : rest };
  }
  // A track dislike under a blocked artist keeps the block; only the track entry goes.
  if (action.type === 'undislike') return { ...state, disliked: state.disliked.flatMap(entry => entry.title !== action.title || entry.artist !== action.artist ? [entry] : entry.blockedArtist ? [{ ...entry, title: '' }] : []) };
  if (action.type === 'block') return state.disliked.some(entry => entry.blockedArtist && entry.artist === action.artist) ? state : { ...state, disliked: [...state.disliked, { title: '', artist: action.artist, blockedArtist: true }] };
  if (action.type === 'unblock') return { ...state, disliked: state.disliked.flatMap(entry => !entry.blockedArtist || entry.artist !== action.artist ? [entry] : entry.title ? [{ ...entry, blockedArtist: false }] : []) };
  if (action.type === 'preset') return soundPresets.some(preset => preset.id === action.preset) ? { ...state, preset: action.preset } : state;
  if (action.type === 'saveStation') {
    const station = demoStations.find(entry => entry.id === action.id);
    if (!station) return state;
    if (state.savedStations.includes(station.id)) return post({ ...state, savedStations: state.savedStations.filter(id => id !== station.id) }, { kind: 'text', text: 'Removed the station from your saved stations.', private: true });
    return post({ ...state, savedStations: [...state.savedStations, station.id] }, { kind: 'text', text: `⭐ Saved **${station.name}**. Find it at the top of \`/radio\` and in the Activity radio tab.`, private: true });
  }
  if (action.type === 'resolved') {
    if (!action.tracks.length) return post(state, { kind: 'text', text: 'No results found. Try another title or artist.', command: action.command, private: true });
    if (state.queue.length + action.tracks.length > 50) return post(state, { kind: 'text', text: 'Preview queue is full (50 tracks). Remove tracks before adding more.', private: true });
    const [track, ...rest] = action.tracks;
    const start = !state.current || action.mode === 'now';
    const next = start ? { ...state, current: track, queue: [...state.queue, ...rest], previous: remember(state), position: 0, paused: false } : { ...state, queue: [...state.queue, ...action.tracks] };
    const added = post(next, { kind: 'embed', command: action.command, embed: trackEmbed('added', track, next) });
    return start ? post(added, { kind: 'player' }) : added;
  }
  if (action.type === 'tick') {
    if (!state.current || state.paused || !duration(state.current)) return state;
    return state.position + 1 >= duration(state.current) ? advance(state, true) : { ...state, position: state.position + 1 };
  }
  const command = action.value.trim();
  const [raw, ...parts] = command.split(/\s+/);
  const name = raw.toLowerCase();
  const query = parts.join(' ').replace(/^(query|value|mode|position|station|preset|view):\s*/i, '');
  const response = (text: string) => post(state, { kind: 'text', command, text, private: true });
  if (name === '/play') {
    const normalized = query.toLowerCase().replace(/\s*-\s*/g, ' ');
    const track = demoTracks.find((entry) => normalized && `${entry.artist} ${entry.title}`.toLowerCase().includes(normalized)) || demoTracks.find((entry) => normalized && `${entry.title} ${entry.artist}`.toLowerCase().includes(normalized));
    if (!track) return response('No match in the preview catalog. Choose a track from the /play suggestions.');
    if (state.queue.length >= 50) return response('Preview queue is full (50 tracks). Skip or clear a track first.');
    const next = state.current ? { ...state, queue: [...state.queue, track] } : { ...state, current: track, paused: false, position: 0 };
    const added = post(next, { kind: 'embed', command, embed: trackEmbed('added', track, next) });
    return state.current ? added : post(added, { kind: 'player' });
  }
  if (name === '/radio') {
    const wanted = query.toLowerCase();
    const playing = demoStations.findIndex(station => state.current?.live && station.name === state.current.title);
    const station = wanted ? demoStations.find(entry => entry.id === wanted || entry.name.toLowerCase().includes(wanted)) : demoStations[(playing + 1) % demoStations.length];
    if (!station) return response('No station matched. Choose one from the /radio suggestions.');
    const replaced = Boolean(state.current?.live);
    const next = { ...state, current: stationTrack(station), previous: remember(state), position: 0, paused: false };
    const embed: Embed = { title: replaced ? '📻 Switched station' : '📻 Live radio', description: `**${station.name}**\n${station.details}`, color: contract.nowPlaying.color, fields: [{ name: 'Voice channel', value: VOICE_CHANNEL, inline: true }], footer: { text: 'Requested by You · autoplay and lyrics pause on radio' }, thumbnail: { url: station.artwork } };
    return post(post(next, { kind: 'embed', command, embed, stationId: station.id }), { kind: 'player' });
  }
  if (name === '/sound') {
    const wanted = query.toLowerCase();
    const preset = wanted ? soundPresets.find(entry => entry.id === wanted || entry.label.toLowerCase() === wanted) : null;
    if (wanted && !preset) return response('Choose a preset from the /sound suggestions.');
    return post({ ...state, preset: preset?.id ?? state.preset }, { kind: 'sound', command, preset: preset?.id ?? state.preset });
  }
  if (name === '/stats') {
    const wanted = query.toLowerCase();
    const view = wanted ? statsViews.find(entry => entry.id === wanted || entry.label.toLowerCase().startsWith(wanted)) : statsViews[0];
    if (!view) return response('Choose a view from the /stats suggestions.');
    return post(state, { kind: 'stats', command, view: view.id });
  }
  if (name === '/autoplay') {
    const [sub = 'toggle', ...options] = parts.map(part => part.toLowerCase());
    if (sub === 'toggle') {
      const enabled = !state.autoplay;
      return post({ ...state, autoplay: enabled }, { kind: 'embed', command, embed: { title: enabled ? 'Autoplay Enabled' : 'Autoplay Disabled', description: enabled ? 'When the queue ends, I\'ll automatically find and play similar tracks based on the last played song.' : 'Autoplay has been turned off. Playback will stop when the queue is empty.', color: enabled ? 0x22c55e : 0xef4444 } });
    }
    if (sub === 'disliked') {
      const artists = [...new Set(state.disliked.filter(entry => entry.blockedArtist).map(entry => entry.artist))].map(artist => `🚫 ${artist}`);
      const tracks = state.disliked.filter(entry => entry.title && !entry.blockedArtist).map(entry => `👎 ${entry.title} — ${entry.artist}`);
      const lines = [...(artists.length ? ['**Blocked artists**', ...artists] : []), ...(artists.length && tracks.length ? [''] : []), ...(tracks.length ? ['**Disliked tracks**', ...tracks] : [])];
      return post(state, { kind: 'embed', command, private: true, embed: { title: '👎 Disliked', description: lines.length ? lines.join('\n') : 'Nothing here. Use `/autoplay dislike` on a track autoplay should avoid.', color: contract.empty.color, footer: { text: 'Autoplay avoids these for you. Two dislikes of one artist block the artist.' } } });
    }
    if (sub === 'next') {
      if (!state.autoplay) return response('Autoplay is off.');
      if (state.queue.length || state.current?.live) return response('Autoplay only picks the next track once the queue is empty.');
      const rerolled = { ...state, autoplayCursor: state.autoplayCursor + 1 };
      const next = autoplayNext(rerolled);
      return next ? post(rerolled, { kind: 'text', command, text: `🎲 Up next: **${next.title}** by ${next.artist}.`, private: true }) : response('Autoplay couldn\'t find another fitting track right now.');
    }
    if (sub !== 'like' && sub !== 'dislike') return response('Use /autoplay toggle, like, dislike, next or disliked.');
    if (!state.current) return response('Nothing playing. Add a track with /play.');
    if (state.current.live) return response(`This track cannot be ${sub}d.`);
    const track = state.current;
    if (sub === 'like') return post(demoReducer(state, { type: 'like', track, liked: true }), { kind: 'text', command, text: `👍 Liked **${track.title}**. Autoplay will pick more like it, and it is in your \`/liked\` list.`, private: true });
    const blockedArtist = options.some(option => /^(artist(:true)?|true)$/.test(option));
    const disliked = [...state.disliked.filter(entry => blockedArtist ? !(entry.blockedArtist && entry.artist === track.artist) : entry.title !== track.title), { title: track.title, artist: track.artist, blockedArtist }];
    const what = blockedArtist ? `Blocked **${track.artist}** for your autoplay` : `Disliked **${track.title}**`;
    return post(advance({ ...state, disliked }), { kind: 'text', command, text: `👎 ${what} and skipped the track. Undo it with \`/autoplay disliked\`.`, private: true });
  }
  if (name === '/slots') return query ? response('This preview only supports /slots without a bet. No real balance is used.') : post(state, { kind: 'slots', command, round: Math.floor((action.random ?? 0) * 4) });
  if (name === '/help') return response('Preview commands: /play, /radio, /autoplay, /sound, /stats, /queue, /nowplaying, /pause, /resume, /skip, /back, /stop, /volume, /seek, /loop, /shuffle, /slots.');
  if (!['/queue', '/nowplaying', '/pause', '/resume', '/skip', '/stop', '/volume', '/seek', '/loop', '/shuffle', '/back', '/lyrics'].includes(name)) return response('This command is not in the local preview. Type /help for the available commands.');
  if (!state.current) return response(name === '/queue' ? 'The queue is empty.' : 'Nothing playing. Add a track with /play.');
  if (name === '/queue') return post(state, { kind: 'embed', command, embed: queueEmbed(state), private: true });
  if (name === '/nowplaying') return post(state, { kind: 'player', command, private: true });
  if (name === '/pause' || name === '/resume') {
    const paused = name === '/pause';
    if (paused === state.paused) return response(paused ? 'Playback is already paused.' : 'Nothing is paused right now.');
    return { ...state, paused };
  }
  if (name === '/skip') return advance(state);
  if (name === '/back') {
    const previous = state.previous.at(-1);
    if (!previous) return response('No previous track available.');
    return post({ ...state, current: previous, queue: state.current.live ? state.queue : [state.current, ...state.queue], previous: state.previous.slice(0, -1), position: 0, paused: false }, { kind: 'player' });
  }
  if (name === '/stop') return post({ ...state, current: null, queue: [], previous: [], paused: false, position: 0, loop: 'off' }, { kind: 'player', command });
  if (name === '/volume') {
    if (!/^-?\d+$/.test(query)) return response('Enter a whole number, for example /volume 50.');
    const volume = Math.max(0, Math.min(100, Number(query)));
    return post({ ...state, volume }, { kind: 'text', command, text: `Volume set to ${volume}% (limit: 100%).`, private: true });
  }
  if (name === '/seek') {
    if (state.current.seekable === false) return response('This track cannot be seeked.');
    if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(query)) return response('Use mm:ss or hh:mm:ss format.');
    const position = query.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    if (position >= duration(state.current)) return response(`Seek position must be before ${state.current.duration}.`);
    return { ...state, position };
  }
  if (name === '/loop') {
    if (!['off', 'track', 'queue'].includes(query)) return response('Choose /loop off, /loop track or /loop queue.');
    return { ...state, loop: query as Playback['loop'] };
  }
  if (name === '/shuffle') {
    const queue = [...state.queue];
    // Fisher-Yates with a per-command seed keeps the reducer deterministic.
    let seed = Math.floor((action.random ?? .5) * 2147483646) + 1;
    for (let i = queue.length - 1; i > 0; i--) { seed = seed * 16807 % 2147483647; const j = seed % (i + 1); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    return post({ ...state, queue }, { kind: 'embed', command, embed: queueEmbed({ ...state, queue }), private: true });
  }
  return response('Lyrics are not included in this preview catalog. Live lyrics are available in Bread.');
}
