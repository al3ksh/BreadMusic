const {
  cleanTitle,
  logAutoplay,
  normalizeComparable,
  isYouTubeIdentifier,
  tokenOverlap,
} = require('./normalize');
const { getLastfmClient } = require('./lastfm');

const SEARCH_TIMEOUT = 8000;
const RETRIEVAL_BUDGET_MS = 9000;
const MAX_SEARCH_QUERIES = 6;
const MAX_SEARCH_TRACKS_PER_QUERY = 12;
const MAX_DISCOVERY_TRACKS_PER_ARTIST = 4;
const LASTFM_SEEDS = 2;
const LASTFM_SUGGESTIONS = 8;
const LASTFM_PER_ARTIST = 2;
const LASTFM_FALLBACK_ARTISTS = 4;

async function searchWithTimeout(node, query, requester, timeoutMs = SEARCH_TIMEOUT) {
  let timeout;
  try {
    return await Promise.race([
      node.search({ query }, requester),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runSearch(node, query, requester, limit) {
  try {
    const result = await searchWithTimeout(node, query, requester);
    return { tracks: result?.tracks?.slice(0, limit) ?? [], error: null };
  } catch (error) {
    return { tracks: [], error };
  }
}

// YouTube Music search returns clean song metadata (author = artist, no lyric videos or reuploads),
// so it is preferred; plain YouTube search is the fallback when Music has nothing or fails.
async function searchTracks(node, query, { requester = null, limit = MAX_SEARCH_TRACKS_PER_QUERY, prefer = 'music', fallbackQuery = query } = {}) {
  if (!node?.connected || !query) return [];

  if (prefer === 'music') {
    const music = await runSearch(node, `ytmsearch:${query}`, requester, limit);
    if (music.tracks.length) return music.tracks;
    if (music.error) logAutoplay('debug', `Music search failed for "${query}": ${music.error.message}`);
  }

  const video = await runSearch(node, `ytsearch:${fallbackQuery || query}`, requester, limit);
  if (video.error) logAutoplay('debug', `Search failed for "${fallbackQuery || query}": ${video.error.message}`);
  return video.tracks;
}

async function resolveYouTubeId(node, normalized, requester = null) {
  if (!normalized) return null;
  if (isYouTubeIdentifier(normalized.identifier)) return normalized.identifier;

  const query = `${normalized.artist || normalized.author} ${normalized.cleanTitle || normalized.title}`.trim();
  if (!query) return null;

  const tracks = await searchTracks(node, query, { requester, limit: 1 });
  const identifier = tracks[0]?.info?.identifier;
  return isYouTubeIdentifier(identifier) ? identifier : null;
}

async function fetchRadioMix(node, videoId, requester = null) {
  if (!node?.connected || !videoId) return [];

  const radioUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
  const { tracks, error } = await runSearch(node, radioUrl, requester, Infinity);
  if (error) logAutoplay('debug', `YouTube Radio Mix failed: ${error.message}`);
  return tracks;
}

// Runs every source in parallel and keeps whatever arrived before the budget ran out.
// A failing or late source never blocks or discards the others.
async function collectCandidates(tasks, { budgetMs = RETRIEVAL_BUDGET_MS } = {}) {
  const collected = [];
  let closed = false;
  let timer;

  const all = Promise.allSettled(tasks.map(async (task) => {
    const startedAt = Date.now();
    try {
      const candidates = await task.run();
      if (closed) {
        logAutoplay('info', `Source ${task.name} missed the ${budgetMs}ms budget (${Date.now() - startedAt}ms)`);
        return;
      }
      collected.push(...(candidates ?? []));
      logAutoplay('debug', `Source ${task.name}: ${candidates?.length ?? 0} candidates in ${Date.now() - startedAt}ms`);
    } catch (error) {
      logAutoplay('debug', `Source ${task.name} failed: ${error.message}`);
    }
  }));

  await Promise.race([
    all,
    new Promise((resolve) => {
      timer = setTimeout(resolve, budgetMs);
      timer.unref?.();
    }),
  ]);
  clearTimeout(timer);
  closed = true;
  return collected;
}

function buildSearchQueries(context) {
  const anchors = context.activeSeeds.length ? context.activeSeeds : [context.primary].filter(Boolean);
  const primaryArtist = context.seedArtist;
  const recentArtists = [...new Set(
    context.recent
      .slice(-8)
      .map((entry) => entry.artist)
      .filter(Boolean)
      .filter((entry) => entry !== primaryArtist),
  )];

  const queries = [];
  const add = (query, anchor = null, anchorRank = 0) => {
    const normalized = query.replace(/\s+/g, ' ').trim();
    if (normalized && !queries.some((entry) => entry.query === normalized)) {
      queries.push({
        query: normalized,
        anchorKey: anchor?.key || null,
        anchorRank,
      });
    }
  };

  anchors.forEach((anchor, index) => {
    const artist = anchor.artist;
    const title = cleanTitle(anchor.cleanTitle || anchor.title);
    if (artist && title) add(`${artist} ${title} radio`, anchor, index);
    if (artist) add(`${artist} radio mix`, anchor, index);
  });

  for (const [index, anchor] of anchors.entries()) {
    if (queries.length >= MAX_SEARCH_QUERIES) break;
    if (anchor.artist) add(`${anchor.artist} official audio`, anchor, index);
  }

  for (const recentArtist of recentArtists.slice(0, 2)) {
    if (queries.length >= MAX_SEARCH_QUERIES) break;
    add(`${recentArtist} ${primaryArtist} mix`);
  }

  return queries.slice(0, MAX_SEARCH_QUERIES);
}

// Video-search phrasing ("radio", "official audio") only adds noise to YouTube Music song search.
function toMusicQuery(query) {
  return query
    .replace(/\s+(radio mix|radio|official audio|mix)$/i, '')
    .trim();
}

function buildDiscoveryQueries(artists, context) {
  const coreArtistKeys = new Set(context.manualSeeds
    .map((seed) => normalizeComparable(seed.artist || seed.author))
    .filter(Boolean));
  const seen = new Set();

  return artists
    .map((entry) => ({
      artist: String(entry?.name || '').replace(/\s+/g, ' ').trim(),
      distance: entry?.distance,
    }))
    .filter((entry) => {
      const key = normalizeComparable(entry.artist);
      if (!key || coreArtistKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      query: `${entry.artist} official audio`,
      artist: entry.artist,
      distance: entry.distance,
    }));
}

function radioSource({ node, requester, context, seedNormalized }) {
  return {
    name: 'radio',
    run: async () => {
      let videoId = context.seed?.identifier || context.last?.identifier;
      if (!isYouTubeIdentifier(videoId)) videoId = await resolveYouTubeId(node, seedNormalized, requester);
      if (!videoId) return [];
      const tracks = await fetchRadioMix(node, videoId, requester);
      return tracks.map((track, index) => ({
        track,
        source: 'radio',
        sourceIndex: index,
        anchorKey: context.primary?.key || null,
        anchorRank: 0,
      }));
    },
  };
}

function searchSource({ node, requester, context }) {
  return {
    name: 'search',
    run: async () => {
      const grouped = new Map();
      for (const entry of buildSearchQueries(context)) {
        const musicQuery = toMusicQuery(entry.query);
        const group = grouped.get(musicQuery) ?? { musicQuery, fallbackQuery: entry.query, anchors: [] };
        group.anchors.push(entry);
        grouped.set(musicQuery, group);
      }
      logAutoplay('debug', `Search queries: ${[...grouped.keys()].join(' | ') || 'none'}`);

      const results = await Promise.all([...grouped.values()].map(async (group) => ({
        group,
        tracks: await searchTracks(node, group.musicQuery, { requester, fallbackQuery: group.fallbackQuery }),
      })));

      return results.flatMap(({ group, tracks }) => tracks.flatMap((track, index) => (
        group.anchors.map((anchor) => ({
          track,
          source: 'search',
          sourceIndex: index,
          anchorKey: anchor.anchorKey,
          anchorRank: anchor.anchorRank,
        }))
      )));
    },
  };
}

function discoverySource({ node, requester, context, planPromise }) {
  return {
    name: 'discovery',
    run: async () => {
      const plan = await planPromise;
      const queries = buildDiscoveryQueries(plan ?? [], context);
      if (!queries.length) return [];
      logAutoplay('debug', `Discovery queries: ${queries.map((entry) => `${entry.artist}:${entry.distance}`).join(' | ')}`);

      const results = await Promise.all(queries.map(async (query) => ({
        query,
        tracks: await searchTracks(node, query.artist, {
          requester,
          limit: MAX_DISCOVERY_TRACKS_PER_ARTIST,
          fallbackQuery: query.query,
        }),
      })));

      return results.flatMap(({ query, tracks }) => tracks.map((track, index) => ({
        track,
        source: 'discovery',
        sourceIndex: index,
        anchorKey: null,
        anchorRank: 0,
        discoveryDistance: query.distance,
      })));
    },
  };
}

const squash = (value) => normalizeComparable(value).replace(/ /g, '');

// Last.fm wants the real names: the normalized artist drops letters like "ł", and uploads often
// carry "Artist - Title" in the title with a "VEVO" or "- Topic" channel as the author.
function lastfmSeedQuery(seed) {
  const title = cleanTitle(seed.title || '');
  const author = String(seed.author || '')
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*(vevo|official)$/i, '')
    .trim();
  const parts = title.split(/\s[-–—|]\s/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts.at(-1);
    // "Title - Artist" exists too; the channel name tells which side is the artist.
    if (squash(author).includes(squash(last)) && !squash(author).includes(squash(first))) {
      return { artist: last, title: parts.slice(0, -1).join(' - ') };
    }
    return { artist: first, title: parts.slice(1).join(' - ') };
  }
  return { artist: author || seed.artist, title };
}

// Similar tracks for up to two active seeds, interleaved so both seeds get a share. A seed Last.fm
// does not know falls back to its similar artists. Seed artists, disliked artists and recent tracks
// are left out before spending a search on them.
async function buildLastfmSuggestions(client, context) {
  const seeds = context.activeSeeds.slice(0, LASTFM_SEEDS);
  const recentKeys = new Set(context.recent.map((entry) => `${entry.artistKey}|${normalizeComparable(entry.cleanTitle || entry.title)}`));
  const dislikedArtists = context.taste?.dislikedArtistCounts ?? new Map();
  const queries = seeds.map(lastfmSeedQuery);
  // Radio and search already cover the seed artists; Last.fm is there for the neighbours.
  const seedArtists = new Set(seeds.flatMap((seed, index) => [seed.artistKey, normalizeComparable(queries[index].artist)]).filter(Boolean));

  const perSeed = await Promise.all(seeds.map(async (seed, anchorRank) => {
    const { artist, title } = queries[anchorRank];
    let suggestions = await client.getSimilarTracks({ artist, title });
    if (!suggestions.length) {
      const artists = await client.getSimilarArtists(artist);
      suggestions = artists.slice(0, LASTFM_FALLBACK_ARTISTS).map((entry) => ({
        artist: entry.name,
        title: null,
        match: entry.match * 0.8,
      }));
    }
    return suggestions.map((entry) => ({ ...entry, anchorKey: seed.key || null, anchorRank }));
  }));

  const picked = [];
  const seen = new Set();
  const perArtist = new Map();
  const queues = perSeed.map((list) => [...list]);
  while (picked.length < LASTFM_SUGGESTIONS && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      while (queue.length) {
        const entry = queue.shift();
        const artistKey = normalizeComparable(entry.artist);
        const key = `${artistKey}|${normalizeComparable(entry.title || '')}`;
        if (seen.has(key) || recentKeys.has(key)) continue;
        if (seedArtists.has(artistKey) || dislikedArtists.has(artistKey) || (perArtist.get(artistKey) || 0) >= LASTFM_PER_ARTIST) continue;
        seen.add(key);
        perArtist.set(artistKey, (perArtist.get(artistKey) || 0) + 1);
        picked.push(entry);
        break;
      }
      if (picked.length >= LASTFM_SUGGESTIONS) break;
    }
  }
  return picked;
}

// A music search for "artist title" usually returns that exact song, but an unknown title can
// resolve to something unrelated; such results are dropped.
function matchesSuggestion(track, suggestion) {
  if (!suggestion.title) return true;
  return tokenOverlap(cleanTitle(track?.info?.title || ''), suggestion.title) >= 0.5;
}

function lastfmSource({ node, requester, context, client = getLastfmClient() }) {
  return {
    name: 'lastfm',
    run: async () => {
      if (!client.isEnabled()) return [];
      const suggestions = await buildLastfmSuggestions(client, context);
      if (!suggestions.length) return [];
      logAutoplay('debug', `Last.fm suggestions: ${suggestions.map((entry) => `${entry.artist} - ${entry.title || '*'} (${entry.match.toFixed(2)})`).join(' | ')}`);

      const results = await Promise.all(suggestions.map(async (suggestion) => {
        const query = suggestion.title ? `${suggestion.artist} ${suggestion.title}` : suggestion.artist;
        const tracks = await searchTracks(node, query, { requester, limit: suggestion.title ? 1 : 2 });
        return tracks
          .filter((track) => matchesSuggestion(track, suggestion))
          .map((track, index) => ({
            track,
            source: 'lastfm',
            sourceIndex: index,
            anchorKey: suggestion.anchorKey,
            anchorRank: suggestion.anchorRank,
            lastfmMatch: suggestion.match,
          }));
      }));
      return results.flat();
    },
  };
}

module.exports = {
  RETRIEVAL_BUDGET_MS,
  searchTracks,
  resolveYouTubeId,
  fetchRadioMix,
  collectCandidates,
  buildSearchQueries,
  buildDiscoveryQueries,
  toMusicQuery,
  radioSource,
  searchSource,
  discoverySource,
  lastfmSource,
  buildLastfmSuggestions,
  lastfmSeedQuery,
};
