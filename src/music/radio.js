// Live radio lookup: Radio Browser (community station directory) plus Radio Garden links.
const RADIO_BROWSER_HOSTS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];
const USER_AGENT = 'BreadMusic/1.0 (+https://github.com/al3ksh/BreadMusic)';
const REQUEST_TIMEOUT_MS = 5000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RADIO_GARDEN_PATTERN = /^https?:\/\/(?:www\.)?radio\.garden\/listen\/[^/]+\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i;
// Lavalink's http source cannot play HLS playlists, so those stations are skipped.
const PLAYABLE_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'FLAC', 'OPUS', 'UNKNOWN', '']);

class RadioError extends Error {}

function createRadio({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const searchCache = new Map();

  function request(url, options = {}) {
    return fetchImpl(url, {
      ...options,
      headers: { 'User-Agent': USER_AGENT, ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  // Radio Browser runs several mirrors; try them in turn so one being down does not break /radio.
  async function browserJson(path) {
    let lastError;
    for (const host of RADIO_BROWSER_HOSTS) {
      try {
        const response = await request(`https://${host}${path}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw new RadioError(`Radio directory is unavailable (${lastError?.message ?? 'unknown error'}).`);
  }

  async function searchStations(query, { limit = 10 } = {}) {
    const term = String(query ?? '').trim().slice(0, 80);
    const cacheKey = `${term.toLowerCase()}|${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expires > now()) return cached.stations;

    const params = (extra) => new URLSearchParams({
      limit: String(limit * 2),
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      ...extra,
    });
    // One box for everything: the term is tried as a station name, a genre tag and a country.
    const lookups = term
      ? [
        browserJson(`/json/stations/search?${params({ name: term })}`),
        browserJson(`/json/stations/search?${params({ tag: term.toLowerCase() })}`),
        browserJson(`/json/stations/search?${params({ country: term })}`),
      ]
      : [browserJson(`/json/stations/search?${params({ order: 'votes' })}`)];
    const results = await Promise.allSettled(lookups);
    if (results.every((result) => result.status === 'rejected')) throw results[0].reason;

    const seen = new Set();
    const stations = results
      .flatMap((result) => (result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []))
      .sort((a, b) => (term ? (b.clickcount ?? 0) - (a.clickcount ?? 0) : 0))
      .map(normalizeBrowserStation)
      .filter((station) => {
        if (!station || seen.has(station.id)) return false;
        seen.add(station.id);
        return true;
      })
      .slice(0, limit);

    if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
    searchCache.set(cacheKey, { stations, expires: now() + SEARCH_CACHE_TTL_MS });
    return stations;
  }

  async function getStation(uuid) {
    const rows = await browserJson(`/json/stations/byuuid/${encodeURIComponent(uuid)}`);
    return normalizeBrowserStation(Array.isArray(rows) ? rows[0] : null);
  }

  // Radio Browser asks clients to report plays so its popularity ranking stays useful.
  function reportPlay(station) {
    if (station?.source !== 'radio-browser') return;
    browserJson(`/json/url/${encodeURIComponent(station.id)}`).catch(() => {});
  }

  async function resolveRadioGarden(channelId) {
    const response = await request(`https://radio.garden/api/ara/content/channel/${encodeURIComponent(channelId)}`);
    if (!response.ok) throw new RadioError('That Radio Garden station could not be found.');
    const { data } = await response.json();
    const listenUrl = `https://radio.garden/api/ara/content/listen/${encodeURIComponent(channelId)}/channel.mp3`;
    let streamUrl = listenUrl;
    try {
      const redirect = await request(listenUrl, { redirect: 'manual' });
      const location = redirect.headers.get('location');
      if (location && /^https?:\/\//i.test(location)) streamUrl = location;
    } catch {
      // Lavalink follows the redirect itself if we could not.
    }
    return {
      id: `garden:${channelId}`,
      source: 'radio-garden',
      name: data?.title || 'Radio Garden station',
      url: streamUrl,
      homepage: data?.website || `https://radio.garden${data?.url ?? ''}`,
      country: data?.country?.title || '',
      place: data?.place?.title || '',
      tags: [],
      favicon: '',
      codec: '',
      bitrate: 0,
    };
  }

  // Accepts an autocomplete value (station UUID), a Radio Garden link, a direct stream URL or free text.
  async function resolveStation(input) {
    const value = String(input ?? '').trim();
    if (!value) throw new RadioError('Pick a station or paste a stream link.');
    if (UUID_PATTERN.test(value)) {
      const station = await getStation(value);
      if (!station) throw new RadioError('That station is no longer available.');
      return station;
    }
    const garden = value.match(RADIO_GARDEN_PATTERN);
    if (garden) return resolveRadioGarden(garden[1]);
    if (/^https?:\/\//i.test(value)) {
      let host;
      try {
        host = new URL(value).hostname;
      } catch {
        throw new RadioError('That link does not look valid.');
      }
      return { id: `url:${value}`, source: 'url', name: host, url: value, homepage: '', country: '', place: '', tags: [], favicon: '', codec: '', bitrate: 0 };
    }
    const [first] = await searchStations(value, { limit: 1 });
    if (!first) throw new RadioError(`No station matches **${value.slice(0, 80)}**.`);
    return first;
  }

  return { searchStations, getStation, resolveStation, resolveRadioGarden, reportPlay };
}

function normalizeBrowserStation(raw) {
  if (!raw?.stationuuid) return null;
  const url = raw.url_resolved || raw.url;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (raw.hls === 1 || /\.m3u8(?:$|\?)/i.test(url)) return null;
  if (!PLAYABLE_CODECS.has(String(raw.codec ?? '').toUpperCase())) return null;
  return {
    id: raw.stationuuid,
    source: 'radio-browser',
    name: String(raw.name || 'Unnamed station').trim(),
    url,
    homepage: raw.homepage || '',
    country: raw.country || raw.countrycode || '',
    place: raw.state || '',
    tags: String(raw.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 4),
    favicon: /^https:\/\//i.test(raw.favicon || '') ? raw.favicon : '',
    codec: raw.codec || '',
    bitrate: Number(raw.bitrate) || 0,
  };
}

function describeStationLocation(station) {
  return [station.place, station.country].filter(Boolean).join(', ');
}

// Autocomplete rows are capped at 100 characters by Discord.
function formatStationChoice(station) {
  const details = [describeStationLocation(station), station.tags.slice(0, 2).join(', '), station.bitrate ? `${station.bitrate} kbps` : '']
    .filter(Boolean)
    .join(' · ');
  const label = details ? `${station.name} — ${details}` : station.name;
  return { name: label.length > 100 ? `${label.slice(0, 99)}…` : label, value: station.id.slice(0, 100) };
}

const defaultRadio = createRadio();

module.exports = {
  RadioError,
  createRadio,
  normalizeBrowserStation,
  describeStationLocation,
  formatStationChoice,
  ...defaultRadio,
};
