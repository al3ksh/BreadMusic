// Read only the presentation modules. Do not import bot startup, storage or config.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const discord = require('../../node_modules/discord.js');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
const allowed = new Set(['src/music/embeds.js', 'src/music/ui.js', 'src/music/queueFormatter.js', 'src/music/sourceNames.js', 'src/utils/time.js', 'src/theme.js']);
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  if (!allowed.has(relative)) throw new Error(`Unexpected presenter dependency: ${relative}`);
  const filename = path.join(root, relative);
  const module = { exports: {} };
  const requirePresenter = (name) => {
    if (name === 'discord.js') return discord;
    if (name === './autoplay') return { isAutoplayEnabled: () => false };
    if (name === './playbackErrors') return {};
    const resolved = path.relative(root, path.resolve(path.dirname(filename), `${name}.js`)).replaceAll('\\', '/');
    return load(resolved);
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: requirePresenter, process: { env: {} } }, { filename });
  cache.set(relative, module.exports);
  return module.exports;
}
const embeds = load('src/music/embeds.js');
const { MusicUI } = load('src/music/ui.js');
const { buildQueueEmbed } = load('src/music/queueFormatter.js');
const track = { info: { title: 'TRACK_TITLE', author: 'TRACK_ARTIST', duration: 337000, uri: 'https://example.invalid/track', sourceName: 'youtube', artworkUrl: 'https://example.invalid/artwork' }, requester: { username: 'You' } };
const player = { guildId: 'preview', voiceChannelId: '123456789012345678', queue: { current: track, tracks: [track] }, position: 84000, volume: 100, repeatMode: 'off', paused: false };
const clean = (embed) => { const data = embed.toJSON(); delete data.timestamp; return data; };
const data = {
  nowPlaying: clean(embeds.buildNowPlayingEmbed(player, track)),
  added: clean(embeds.buildTrackEmbed(track, track.requester, player.voiceChannelId)),
  empty: clean(embeds.buildNowPlayingEmbed(player, null)),
  queue: clean(buildQueueEmbed(player).embed),
  emptyQueue: clean(buildQueueEmbed({ ...player, queue: { ...player.queue, tracks: [] } }).embed),
  controls: new MusicUI(null).buildControlRows(player).map((row) => row.toJSON()),
};
const target = path.join(root, 'web/components/landing-preview/bot-contract.json');
const serialized = `${JSON.stringify(data, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== serialized) throw new Error('Bot presentation changed. Regenerate the preview contract.');
  console.log('Preview contract matches real bot presenters.');
} else {
  fs.writeFileSync(target, serialized);
  console.log('Generated real bot embeds and control rows without starting the bot.');
}
