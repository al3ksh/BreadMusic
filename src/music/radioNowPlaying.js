// @ts-check
const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');

const POLL_INTERVAL_MS = 25_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const MAX_METAINT = 64 * 1024;
// A block can come through empty when the title has not changed, so a few are read before giving up.
const MAX_BLOCKS = 3;
const MAX_FAILURES = 3;
const MAX_TITLE_LENGTH = 200;

// Stream URLs come from station lookups and pasted links, so the bot never reads from its own network.
function isPublicStreamUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (net.isIP(host)) return isPublicAddress(host);
  // A single label name (bot, lavalink) is a container on the same network.
  return host.includes('.');
}

function isPublicAddress(address) {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
  }
  if (ipVersion === 6) {
    const lowered = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lowered);
    if (mapped) return isPublicAddress(mapped[1]);
    return !/^(::1?$|f[cd]|fe[89ab])/.test(lowered);
  }
  return false;
}

// A public name can still point at a private address, so the resolved address is checked too.
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = /** @type {Array<{ address: string, family: number }>} */ (/** @type {unknown} */ (addresses));
    if (!list.length || !list.every((entry) => isPublicAddress(entry.address))) {
      return callback(new Error('Stream resolves to a private address'));
    }
    if (options?.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

function parseStreamTitle(metadata) {
  const match = /StreamTitle='(.*?)';/s.exec(metadata);
  return match ? match[1] : null;
}

function decodeMetadata(buffer) {
  const text = buffer.toString('utf8').replace(/\0+$/, '');
  // Older servers still send Latin-1, which comes through UTF-8 as replacement characters.
  return text.includes('�') ? buffer.toString('latin1').replace(/\0+$/, '') : text;
}

// Drops what is not a song: empty titles, the station repeating its own name, links and slogans of dashes.
function cleanTitle(raw, stationName = '') {
  if (typeof raw !== 'string') return null;
  const title = raw.replace(/\s+/g, ' ').replace(/^[\s\-–|]+|[\s\-–|]+$/g, '').trim();
  if (title.length < 2 || !/[\p{L}\p{N}]/u.test(title)) return null;
  if (/https?:\/\/|www\./i.test(title)) return null;
  if (stationName && title.toLowerCase() === String(stationName).trim().toLowerCase()) return null;
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

// Opens the stream just long enough to read its ICY metadata.
// Resolves { supported: false } when the stream carries none, { supported: true, title } otherwise.
function readStreamTitle(streamUrl, { redirects = 0, timeoutMs = REQUEST_TIMEOUT_MS, lookup = publicLookup } = {}) {
  return new Promise((resolve, reject) => {
    if (!isPublicStreamUrl(streamUrl)) {
      resolve({ supported: false });
      return;
    }
    const client = streamUrl.startsWith('https:') ? https : http;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      request.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const request = client.get(streamUrl, { lookup, headers: { 'Icy-MetaData': '1', 'User-Agent': 'Bread/1.0' } }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        if (redirects >= MAX_REDIRECTS) return finish(new Error('Too many redirects'));
        const next = new URL(response.headers.location, streamUrl).toString();
        settled = true;
        request.destroy();
        readStreamTitle(next, { redirects: redirects + 1, timeoutMs, lookup }).then(resolve, reject);
        return;
      }
      if (status !== 200) return finish(new Error(`Stream answered ${status}`));
      const metaint = Number(response.headers['icy-metaint']);
      if (!Number.isInteger(metaint) || metaint <= 0 || metaint > MAX_METAINT) return finish(null, { supported: false });

      let buffer = Buffer.alloc(0);
      let blocks = 0;
      response.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (!settled && buffer.length > metaint) {
          const length = buffer[metaint] * 16;
          if (buffer.length < metaint + 1 + length) return;
          const title = length ? parseStreamTitle(decodeMetadata(buffer.subarray(metaint + 1, metaint + 1 + length))) : null;
          blocks += 1;
          if (title !== null || blocks >= MAX_BLOCKS) return finish(null, { supported: true, title });
          buffer = buffer.subarray(metaint + 1 + length);
        }
      });
      response.on('end', () => finish(new Error('Stream ended')));
      response.on('error', (error) => finish(error));
    });
    request.setTimeout(timeoutMs, () => finish(new Error('Stream timed out')));
    request.on('error', (error) => finish(error));
  });
}

// Follows what a playing radio station is airing and stores it on the track as radioStation.nowPlaying.
// onChange runs only when the title actually changes, so the player message is not edited every poll.
/**
 * @param {{
 *   onChange?: (player: any, track: any) => unknown,
 *   readTitle?: (streamUrl: string) => Promise<{ supported: boolean, title?: string | null }>,
 *   intervalMs?: number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (timer: any) => void,
 * }} [options]
 */
function createRadioNowPlaying({
  onChange,
  readTitle = readStreamTitle,
  intervalMs = POLL_INTERVAL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const watches = new Map();

  function stop(guildId) {
    const watch = watches.get(guildId);
    if (!watch) return;
    if (watch.timer) clearTimer(watch.timer);
    watches.delete(guildId);
  }

  function schedule(watch) {
    watch.timer = setTimer(() => {
      watch.timer = null;
      void poll(watch);
    }, intervalMs);
    watch.timer?.unref?.();
  }

  async function poll(watch) {
    const { player, track } = watch;
    if (watches.get(player.guildId) !== watch) return;
    if (player.queue?.current !== track) {
      stop(player.guildId);
      return;
    }
    let result;
    try {
      result = await readTitle(track.radioStation.url);
      watch.failures = 0;
    } catch {
      watch.failures += 1;
    }
    if (watches.get(player.guildId) !== watch) return;
    if (result && !result.supported) {
      stop(player.guildId);
      return;
    }
    if (watch.failures >= MAX_FAILURES) {
      stop(player.guildId);
      return;
    }
    if (result) {
      const title = cleanTitle(result.title, track.info?.title);
      if (title !== (track.radioStation.nowPlaying ?? null)) {
        if (title) track.radioStation.nowPlaying = title;
        else delete track.radioStation.nowPlaying;
        await Promise.resolve(onChange?.(player, track)).catch(() => {});
      }
    }
    if (watches.get(player.guildId) === watch) schedule(watch);
  }

  // Starts following the current track when it is a station with a known stream; anything else stops it.
  function watch(player) {
    const track = player?.queue?.current;
    if (!player?.guildId) return false;
    if (watches.get(player.guildId)?.track === track) return true;
    stop(player.guildId);
    if (!track?.radioStation?.url) return false;
    const entry = { player, track, timer: null, failures: 0 };
    watches.set(player.guildId, entry);
    void poll(entry);
    return true;
  }

  function stopAll() {
    for (const guildId of [...watches.keys()]) stop(guildId);
  }

  return { watch, stop, stopAll, isWatching: (guildId) => watches.has(guildId) };
}

module.exports = { createRadioNowPlaying, readStreamTitle, cleanTitle, parseStreamTitle, isPublicStreamUrl };
