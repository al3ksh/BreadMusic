export type DemoTrack = { title: string; artist: string; cover: string; duration: string; uri?: string; artwork?: string; source?: string; seekable?: boolean; embeds?: { added: import('./demo-state').Embed; nowPlaying: import('./demo-state').Embed } };
export const demoTracks: DemoTrack[] = [
  { title: 'Instant Crush', artist: 'Daft Punk', cover: 'instant-crush', duration: '5:37' },
  { title: 'Not Like Us', artist: 'Kendrick Lamar', cover: 'not-like-us', duration: '4:34' },
  { title: 'BUBBLETEA', artist: 'Quebonafide', cover: 'bubbletea', duration: '4:44' },
];
export const artwork = (track: DemoTrack) => track.artwork || (track.cover ? asset(`${track.cover}.jpg`) : '/assets/breadicon.png');
export const asset = (name: string) => `/assets/landing-preview/${name}`;
export const commands = [
  { input: '/play ', name: '/play', detail: 'Play or queue a track', option: 'query' },
  { input: '/queue', name: '/queue', detail: 'Show the queue with pagination', option: '' },
  { input: '/nowplaying', name: '/nowplaying', detail: 'Show the current track', option: '' },
  { input: '/skip', name: '/skip', detail: 'Skip the current track', option: '' },
  { input: '/pause', name: '/pause', detail: 'Pause playback', option: '' },
  { input: '/resume', name: '/resume', detail: 'Resume playback', option: '' },
  { input: '/volume ', name: '/volume', detail: 'Set volume (0-100)', option: 'value' },
  { input: '/seek ', name: '/seek', detail: 'Seek to a time in the track', option: 'position' },
  { input: '/loop ', name: '/loop', detail: 'Loop the track or queue', option: 'mode' },
  { input: '/shuffle', name: '/shuffle', detail: 'Shuffle upcoming tracks', option: '' },
  { input: '/stop', name: '/stop', detail: 'Stop playback and clear the queue', option: '' },
  { input: '/slots', name: '/slots', detail: 'Play slots without a bet', option: '' },
];
