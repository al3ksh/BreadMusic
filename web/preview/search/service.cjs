const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { applyPreferredSource } = require('../../../src/music/searchUtils');
const { readProviderJson } = require('./responseBody.cjs');

function validateQuery(value) {
  if (typeof value !== 'string' || value.trim().length < 2 || value.length > 200 || /[\x00-\x1f]/.test(value)) throw new Error('Enter a title, artist or supported music link (2-200 characters).');
  const query = value.trim();
  if (/^[a-z][\w+.-]*:/i.test(query)) {
    if (/^(ytsearch|scsearch):\S.{1,180}$/i.test(query)) return query;
    let url;
    try { url = new URL(query); } catch { throw new Error('Unsupported link. Use YouTube or SoundCloud.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be', 'soundcloud.com', 'www.soundcloud.com'].includes(url.hostname)) throw new Error('This preview supports YouTube and SoundCloud links.');
    return url.href;
  }
  return applyPreferredSource(query);
}

// Only presentation code runs here: no bot startup, database or Discord client.
const root = path.resolve(__dirname, '../../..');
function loadPresenter(relative) {
  if (!['src/music/embeds.js', 'src/music/sourceNames.js', 'src/utils/time.js', 'src/theme.js'].includes(relative)) throw new Error('Unexpected presenter dependency');
  const filename = path.join(root, relative);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, process: { env: {} }, require(name) {
    if (name === 'discord.js') return require('discord.js');
    if (name === './autoplay') return { isAutoplayEnabled: () => false };
    return loadPresenter(path.relative(root, path.resolve(path.dirname(filename), `${name}.js`)).replaceAll('\\', '/'));
  } }, { filename });
  return module.exports;
}
const presenters = loadPresenter('src/music/embeds.js');
const clean = embed => { const result = embed.toJSON(); delete result.timestamp; return result; };

function createSearchService({ request = fetch, address = 'http://lavalink:2333', password = 'local-preview-search-only', now = Date.now } = {}) {
  const cache = new Map();
  const artworks = new Map();
  const images = new Map();
  let imageBytes = 0;
  let imageInFlight = 0;
  let imageWindow = now();
  let imageRequests = 0;
  let inFlight = 0;
  let windowStart = now();
  let requests = 0;
  function artworkUrl(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.port || url.username || url.password || !['i.ytimg.com', 'img.youtube.com', 'i1.sndcdn.com', 'i2.sndcdn.com'].includes(url.hostname)) return undefined;
      const id = crypto.createHash('sha256').update(url.href).digest('hex').slice(0, 32);
      if (artworks.size >= 1000) artworks.delete(artworks.keys().next().value);
      artworks.set(id, url.href);
      return `/demo/api/artwork?id=${id}`;
    } catch { return undefined; }
  }
  return {
    async search(query) {
      const identifier = validateQuery(query);
      if (now() - windowStart >= 60000) { requests = 0; windowStart = now(); }
      if (++requests > 30) throw Object.assign(new Error('Search limit reached. Try again in a minute.'), { status: 429 });
      const cached = cache.get(identifier);
      if (cached && cached.expires > now()) return cached.result;
      if (inFlight >= 2) throw Object.assign(new Error('Search is busy. Try again shortly.'), { status: 429 });
      inFlight++;
      try {
        const response = await request(`${address}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`, { headers: { Authorization: password }, signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (!response.ok) throw new Error('Music search is temporarily unavailable. Please retry.');
        const payload = await readProviderJson(response, 8 * 1024 * 1024);
        if (payload.loadType === 'error') throw new Error('The music source could not resolve this search. Try another query or source.');
        const raw = payload.loadType === 'playlist' ? payload.data.tracks : payload.loadType === 'track' ? [payload.data] : payload.loadType === 'search' ? payload.data : [];
        const tracks = raw.slice(0, payload.loadType === 'playlist' ? 50 : 10).map(track => {
          const info = { ...track.info, duration: track.info.length };
          const item = { info, requester: { username: 'You' } };
          const player = { guildId: 'preview', voiceChannelId: '123456789012345678', queue: { current: item, tracks: [] }, position: 0, volume: 100, repeatMode: 'off', paused: false };
          const artwork = artworkUrl(info.artworkUrl);
          const embeds = { added: clean(presenters.buildTrackEmbed(item, item.requester, player.voiceChannelId)), nowPlaying: clean(presenters.buildNowPlayingEmbed(player, item)) };
          for (const embed of Object.values(embeds)) { if (artwork) embed.thumbnail = { url: artwork }; else delete embed.thumbnail; }
          const seconds = Math.max(0, Math.floor(info.duration / 1000));
          return { title: info.title, artist: info.author, uri: info.uri, source: info.sourceName, seekable: info.isSeekable && !info.isStream, duration: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, artwork, cover: '', embeds };
        });
        const result = { tracks, playlist: payload.loadType === 'playlist' ? { name: payload.data.info.name, total: raw.length, truncated: raw.length > 50 } : null };
        if (cache.size >= 60) cache.delete(cache.keys().next().value);
        cache.set(identifier, { result, expires: now() + 300000 });
        return result;
      } finally { inFlight--; }
    },
    async artwork(id) {
      if (now() - imageWindow >= 60000) { imageWindow = now(); imageRequests = 0; }
      if (++imageRequests > 180) throw Object.assign(new Error('Artwork limit reached'), { status: 429 });
      const url = artworks.get(id);
      if (!url) throw Object.assign(new Error('Artwork not found'), { status: 404 });
      for (const [key, image] of images) if (image.expires <= now()) { imageBytes -= image.body.length; images.delete(key); }
      const cached = images.get(id);
      if (cached) return cached;
      if (imageInFlight >= 4) throw Object.assign(new Error('Artwork busy'), { status: 429 });
      imageInFlight++;
      try {
      const response = await request(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Artwork unavailable');
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) throw new Error('Artwork too large'); chunks.push(Buffer.from(value)); } } finally { await reader.cancel(); }
      const image = { body: Buffer.concat(chunks), type, expires: now() + 300000 };
      if (images.has(id)) { imageBytes -= images.get(id).body.length; images.delete(id); }
      while (images.size >= 32 || imageBytes + size > 16 * 1024 * 1024) {
        const oldest = images.keys().next().value;
        imageBytes -= images.get(oldest).body.length;
        images.delete(oldest);
      }
      images.set(id, image); imageBytes += size;
      return image;
      } finally { imageInFlight--; }
    },
  };
}
module.exports = { createSearchService, validateQuery };
