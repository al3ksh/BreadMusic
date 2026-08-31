const { buildQueryVariants, cleanArtist, cleanTrackTitle, parseSyncedLyrics } = require('../../../src/music/lyrics');
const { readProviderJson } = require('./responseBody.cjs');

function createLyricsService({ request = fetch, now = Date.now } = {}) {
  const cache = new Map();
  let active = 0; let used = 0; let started = now();
  return async ({ artist, title, duration = 0 } = {}) => {
    if (![artist, title].every(value => typeof value === 'string' && value.trim() && value.length <= 200) || !Number.isFinite(duration) || duration < 0 || duration > 86400000) throw Object.assign(new Error('Invalid lyrics query'), { status: 400 });
    if (now() - started >= 60000) { used = 0; started = now(); }
    if (++used > 20) throw Object.assign(new Error('Lyrics limit reached. Try again in a minute.'), { status: 429 });
    const normalized = { artist: cleanArtist(artist), title: cleanTrackTitle(title), duration };
    const key = JSON.stringify(normalized);
    const cached = cache.get(key);
    if (cached?.expires > now()) return cached.result;
    if (active >= 2) throw Object.assign(new Error('Lyrics search is busy. Please retry.'), { status: 429 });
    active++;
    const signal = AbortSignal.timeout(12000);
    const get = async path => {
      const response = await request(`https://lrclib.net/api/${path}`, { signal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'Bread website demo (github.com/al3ksh/BreadMusic)' } });
      if (response.status === 404) return null;
      if (!response.ok) throw Object.assign(new Error('Lyrics provider is unavailable. Please retry.'), { status: 503 });
      return readProviderJson(response, 1024 * 1024);
    };
    try {
      let found = null;
      // Same title/artist normalization and variants as the bot, with a single
      // shared deadline and no background retries for a public-facing preview.
      for (const [index, variant] of buildQueryVariants(normalized).slice(0, 3).entries()) {
        const params = new URLSearchParams({ artist_name: variant.artist, track_name: variant.title });
        const exact = new URLSearchParams(params);
        if (index === 0 && duration) exact.set('duration', String(Math.round(duration / 1000)));
        found = await get(`get?${exact}`);
        if (!found) {
          const entries = await get(`search?${params}`);
          if (Array.isArray(entries)) found = entries.filter(entry => entry.syncedLyrics || entry.plainLyrics || entry.instrumental).sort((a, b) => Math.abs(a.duration * 1000 - duration) - Math.abs(b.duration * 1000 - duration))[0];
        }
        if (found) break;
      }
      const result = found ? {
        plainLyrics: typeof found.plainLyrics === 'string' ? found.plainLyrics.slice(0, 50000) : '',
        lines: parseSyncedLyrics(typeof found.syncedLyrics === 'string' ? found.syncedLyrics.slice(0, 50000) : ''),
        instrumental: !!found.instrumental, provider: 'LRCLIB',
      } : null;
      if (cache.size >= 75) cache.delete(cache.keys().next().value);
      cache.set(key, { result, expires: now() + (result ? 3600000 : 300000) });
      return result;
    } finally { active--; }
  };
}
module.exports = { createLyricsService };
