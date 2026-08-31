import contract from './bot-contract.json';
import { artwork, demoTracks, type DemoTrack } from './demo';

export type Embed = { title: string; description?: string; color: number; fields?: { name: string; value: string; inline?: boolean }[]; footer?: { text: string }; thumbnail?: { url: string } };
export type Playback = { current: DemoTrack | null; queue: DemoTrack[]; previous: DemoTrack[]; paused: boolean; position: number; volume: number; loop: 'off' | 'track' | 'queue' };
export type Message = { id: number; command?: string; kind: 'player' | 'embed' | 'text' | 'slots'; embed?: Embed; text?: string; snapshot: Playback; private?: boolean; round?: number };
export type DemoState = Playback & { messages: Message[]; sequence: number; playerId: number };
export const duration = (track: DemoTrack) => track.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0);
export const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const trackUrl = (track: DemoTrack) => track.uri || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.artist} ${track.title}`)}`;
const link = (track: DemoTrack) => `[${track.title}](${trackUrl(track)})`;

export function trackEmbed(kind: 'nowPlaying' | 'added', track: DemoTrack, state: Playback): Embed {
  const embed: Embed = structuredClone(track.embeds?.[kind] || contract[kind]);
  embed.description = embed.description!.replaceAll('TRACK_ARTIST', track.artist).replaceAll('TRACK_TITLE', track.title).replaceAll('https://example.invalid/track', trackUrl(track));
  embed.thumbnail = { url: artwork(track) };
  embed.fields![0].value = track.artist;
  embed.fields![1].value = track.duration;
  if (kind === 'nowPlaying') {
    const index = Math.round(Math.min(1, state.position / Math.max(1, duration(track))) * 18);
    embed.description = `${embed.description.split('\n')[0]}\n${'\u25ac'.repeat(index)}\uD83D\uDD18${'\u25ac'.repeat(18 - index)}\n${time(state.position)} / ${track.duration}`;
    embed.color = state.paused ? contract.empty.color : contract.nowPlaying.color;
    embed.fields![2].value = `${state.volume}%`;
    embed.fields![3].value = state.loop[0].toUpperCase() + state.loop.slice(1);
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

function post(state: DemoState, message: Omit<Message, 'id' | 'snapshot'>): DemoState {
  const id = state.sequence + 1;
  const { current, queue, previous, paused, position, volume, loop } = state;
  const snapshot = { current, queue: [...queue], previous: [...previous], paused, position, volume, loop };
  return { ...state, sequence: id, playerId: message.kind === 'player' ? id : state.playerId, messages: [...state.messages, { ...message, id, snapshot }].slice(-40) };
}
export function initialState(): DemoState {
  const state: DemoState = { current: demoTracks[0], queue: demoTracks.slice(1), previous: [], paused: false, position: 84, volume: 100, loop: 'off', messages: [], sequence: 0, playerId: 0 };
  return post(state, { kind: 'player', command: '/play Daft Punk - Instant Crush' });
}
function advance(state: DemoState, natural = false): DemoState {
  if (natural && state.loop === 'track') return { ...state, position: 0 };
  const queue = [...state.queue];
  if (state.current && state.loop === 'queue') queue.push(state.current);
  const current = queue.shift() || null;
  return post({ ...state, current, queue, paused: false, position: 0, previous: state.current ? [...state.previous, state.current].slice(-20) : state.previous }, { kind: 'player' });
}
export type DemoAction = { type: 'command'; value: string; random?: number } | { type: 'tick' } | { type: 'reset' } | { type: 'resolved'; tracks: DemoTrack[]; command?: string; mode?: 'now' | 'queue' } | { type: 'error'; message: string; command?: string } | { type: 'remove'; index: number } | { type: 'move'; from: number; to: number } | { type: 'seek'; position: number };
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
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
  if (action.type === 'resolved') {
    if (!action.tracks.length) return post(state, { kind: 'text', text: 'No results found. Try another title or artist.', command: action.command, private: true });
    if (state.queue.length + action.tracks.length > 50) return post(state, { kind: 'text', text: 'Preview queue is full (50 tracks). Remove tracks before adding more.', private: true });
    const [track, ...rest] = action.tracks;
    const start = !state.current || action.mode === 'now';
    const next = start ? { ...state, current: track, queue: [...state.queue, ...rest], previous: state.current ? [...state.previous, state.current].slice(-20) : state.previous, position: 0, paused: false } : { ...state, queue: [...state.queue, ...action.tracks] };
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
  const query = parts.join(' ').replace(/^(query|value|mode|position):\s*/i, '');
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
  if (name === '/slots') return query ? response('This preview only supports /slots without a bet. No real balance is used.') : post(state, { kind: 'slots', command, round: Math.floor((action.random ?? 0) * 4) });
  if (name === '/help') return response('Preview commands: /play, /queue, /nowplaying, /pause, /resume, /skip, /stop, /volume, /seek, /loop, /shuffle, /slots.');
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
    return post({ ...state, current: previous, queue: [state.current, ...state.queue], previous: state.previous.slice(0, -1), position: 0, paused: false }, { kind: 'player' });
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
