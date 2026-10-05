export type DemoTrack = { title: string; artist: string; cover: string; duration: string; uri?: string; artwork?: string; source?: string; seekable?: boolean; live?: boolean; autoplay?: boolean; embeds?: { added: import('./demo-state').Embed; nowPlaying: import('./demo-state').Embed } };
export const demoTracks: DemoTrack[] = [
  { title: 'Instant Crush', artist: 'Daft Punk', cover: 'instant-crush', duration: '5:37' },
  { title: 'Not Like Us', artist: 'Kendrick Lamar', cover: 'not-like-us', duration: '4:34' },
  { title: 'BUBBLETEA', artist: 'Quebonafide', cover: 'bubbletea', duration: '4:44' },
];
// Tracks autoplay can pick once the queue runs out.
export const autoplayPool: DemoTrack[] = [
  { title: 'The Less I Know The Better', artist: 'Tame Impala', cover: 'less-i-know', duration: '3:36' },
  { title: 'New Gold', artist: 'Gorillaz', cover: 'new-gold', duration: '3:35' },
  ...demoTracks,
];
const stationArt = (label: string, from: string, to: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" rx="12" fill="url(#g)"/><text x="32" y="40" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></svg>`)}`;
export type DemoStation = { id: string; name: string; details: string; artwork: string };
export const demoStations: DemoStation[] = [
  { id: 'lofi', name: 'Lofi Café', details: 'Online · lofi, chill, study · 128 kbps MP3', artwork: stationArt('LO', '#8b7cf6', '#3b2f7a') },
  { id: 'jazz', name: 'Midnight Jazz', details: 'New Orleans, The United States · jazz, soul · 192 kbps AAC', artwork: stationArt('JZ', '#e9bb63', '#7a4b12') },
  { id: 'synth', name: 'Synthwave City', details: 'Online · synthwave, retro · 128 kbps MP3', artwork: stationArt('SW', '#f472b6', '#4c1d95') },
  { id: 'indie', name: 'Morning Indie', details: 'Warsaw, Poland · indie, alternative · 320 kbps MP3', artwork: stationArt('IN', '#34d399', '#0f5f4a') },
];
export const stationTrack = (station: DemoStation): DemoTrack => ({ title: station.name, artist: 'Live radio', cover: '', duration: '', artwork: station.artwork, source: 'radio', seekable: false, live: true, uri: `https://www.radio-browser.info/search?name=${encodeURIComponent(station.name)}` });
export const soundPresets = [
  { id: 'off', label: 'Off', description: 'Flat sound, no effects.' },
  { id: 'bassboost', label: 'Bassboost', description: 'Deep, punchy bass boost.' },
  { id: 'nightcore', label: 'Nightcore', description: 'Faster tempo (1.25x) + higher pitch.' },
  { id: 'vaporwave', label: 'Vaporwave', description: 'Slower tempo (0.85x) + lower pitch.' },
  { id: 'soft', label: 'Soft', description: 'Warm EQ with enhanced mids for vocals.' },
  { id: '8d', label: '8D Audio', description: 'Rotating stereo panning effect.' },
];
export const statsViews = [
  { id: 'overview', label: 'Overview', description: 'Plays, time listened and the last 14 days', emoji: '📊' },
  { id: 'top', label: 'Top tracks & artists', description: 'Most played songs, artists and requesters', emoji: '🏆' },
  { id: 'sources', label: 'Sources', description: 'Links, search, uploads, autoplay and platforms', emoji: '🔗' },
  { id: 'rhythm', label: 'Rhythm', description: 'Busiest hours and weekdays', emoji: '🕒' },
  { id: 'arcade', label: 'Arcade', description: 'Games, wins and BREAD', emoji: '🎰' },
];
export const artwork = (track: DemoTrack) => track.artwork || (track.cover ? asset(`${track.cover}.jpg`) : '/assets/breadicon.png');
export const asset = (name: string) => `/assets/landing-preview/${name}`;
export type DemoCommand = { input: string; name: string; detail: string; option: string; choices?: { value: string; label: string; detail: string }[] };
export const commands: DemoCommand[] = [
  { input: '/play ', name: '/play', detail: 'Play or queue a track', option: 'query' },
  { input: '/radio ', name: '/radio', detail: 'Play a live radio station', option: 'station', choices: demoStations.map(station => ({ value: station.name, label: station.name, detail: station.details })) },
  { input: '/autoplay toggle', name: '/autoplay toggle', detail: 'Turn autoplay on or off', option: '' },
  { input: '/sound ', name: '/sound', detail: 'Equalizer, presets, speed and pitch', option: 'preset', choices: soundPresets.map(preset => ({ value: preset.id, label: preset.label, detail: preset.description })) },
  { input: '/stats ', name: '/stats', detail: 'Server stats as an image', option: 'view', choices: statsViews.map(view => ({ value: view.id, label: `${view.emoji} ${view.label}`, detail: view.description })) },
  { input: '/queue', name: '/queue', detail: 'Show the queue with pagination', option: '' },
  { input: '/skip', name: '/skip', detail: 'Skip the current track', option: '' },
  { input: '/autoplay like', name: '/autoplay like', detail: 'Like the track so autoplay picks more like it', option: '' },
  { input: '/autoplay dislike', name: '/autoplay dislike', detail: 'Dislike and skip; autoplay avoids it', option: '' },
  { input: '/autoplay next', name: '/autoplay next', detail: 'Pick a different autoplay track', option: '' },
  { input: '/autoplay disliked', name: '/autoplay disliked', detail: 'See what autoplay avoids', option: '' },
  { input: '/nowplaying', name: '/nowplaying', detail: 'Show the current track', option: '' },
  { input: '/pause', name: '/pause', detail: 'Pause playback', option: '' },
  { input: '/resume', name: '/resume', detail: 'Resume playback', option: '' },
  { input: '/volume ', name: '/volume', detail: 'Set volume (0-100)', option: 'value' },
  { input: '/seek ', name: '/seek', detail: 'Seek to a time in the track', option: 'position' },
  { input: '/loop ', name: '/loop', detail: 'Loop the track or queue', option: 'mode' },
  { input: '/shuffle', name: '/shuffle', detail: 'Shuffle upcoming tracks', option: '' },
  { input: '/stop', name: '/stop', detail: 'Stop playback and clear the queue', option: '' },
  { input: '/slots', name: '/slots', detail: 'Play slots without a bet', option: '' },
  { input: '/help', name: '/help', detail: 'List the preview commands', option: '' },
];
// Quick picks under the composer and in the sidebar.
export const quickCommands = ['/play', '/radio', '/autoplay toggle', '/sound', '/stats'];
