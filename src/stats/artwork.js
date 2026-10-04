const net = require('node:net');
const sharp = require('sharp');

// Cover art for the /stats images, fetched once and kept small as data URIs.
const FETCH_TIMEOUT_MS = 2500;
const MAX_BYTES = 2 * 1024 * 1024;
const CACHE_LIMIT = 200;
const cache = new Map();

function isSafeArtworkUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  return net.isIP(host) === 0;
}

function remember(url, value) {
  cache.set(url, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return value;
}

async function fetchArtwork(url, { fetchImpl = fetch } = {}) {
  if (!isSafeArtworkUrl(url)) return null;
  if (cache.has(url)) return cache.get(url);
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'error' });
    if (!response.ok) return remember(url, null);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) return remember(url, null);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) return remember(url, null);
    const png = await sharp(buffer).resize(128, 128, { fit: 'cover' }).png().toBuffer();
    return remember(url, `data:image/png;base64,${png.toString('base64')}`);
  } catch {
    // Timeouts are not cached so a slow CDN gets another chance next time.
    return null;
  }
}

async function attachArtwork(tracks, options) {
  const art = await Promise.all(tracks.map((track) => fetchArtwork(track.artwork, options)));
  return tracks.map((track, index) => ({ ...track, art: art[index] }));
}

module.exports = { attachArtwork, fetchArtwork, isSafeArtworkUrl };
