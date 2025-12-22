const { getConfig, setConfig } = require('../state/guildConfig');

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';

const recentTracks = new Map(); 
const recentArtists = new Map(); 
const similarArtistsCache = new Map(); 

const MAX_RECENT_TRACKS = 15;
const MAX_RECENT_ARTISTS = 5;
const SEARCH_TIMEOUT = 5000;
const LASTFM_TIMEOUT = 3000;
const CACHE_TTL = 24 * 60 * 60 * 1000; 

const TITLE_BLACKLIST = [
  'remix', 'cover', 'karaoke', 'instrumental', 'acoustic version',
  'live', 'concert', 'reaction', 'tutorial', 'lesson', 'how to',
  'slowed', 'reverb', 'sped up', 'nightcore', '8d audio', 'bass boosted',
  'lyrics', 'lyric video', 'letra', 'tłumaczenie', 'napisy', 'set'
];

const FALLBACK_SIMILAR = {
  'taco hemingway': ['quebonafide', 'bedoes', 'mata', 'pezet', 'sokół', 'paluch', 'schafter', 'young leosia'],
  'taconafide': ['quebonafide', 'taco hemingway', 'bedoes', 'mata', 'young leosia', 'szpaku'],
  'quebonafide': ['taco hemingway', 'bedoes', 'mata', 'pezet', 'paluch', 'schafter'],
  'bedoes': ['mata', 'taco hemingway', 'quebonafide', 'white 2115', 'żabson', 'young leosia', 'szpaku'],
  'mata': ['bedoes', 'young leosia', 'taco hemingway', 'quebonafide', 'szpaku', 'otsochodzi'],
  'pezet': ['taco hemingway', 'sokół', 'paluch', 'kękę', 'quebonafide', 'hemp gru'],
  'paluch': ['pezet', 'sokół', 'kękę', 'tede', 'hemp gru', 'białas'],
  'young leosia': ['mata', 'bedoes', 'white 2115', 'żabson', 'szpaku'],
  'szpaku': ['bedoes', 'mata', 'białas', 'young leosia', 'żabson'],
};

function isAutoplayEnabled(guildId) {
  const config = getConfig(guildId);
  return config.autoplay ?? false;
}

function setAutoplay(guildId, enabled) {
  setConfig(guildId, { autoplay: enabled });
  if (!enabled) {
    recentTracks.delete(guildId);
    recentArtists.delete(guildId);
  }
}

function toggleAutoplay(guildId) {
  const current = isAutoplayEnabled(guildId);
  setAutoplay(guildId, !current);
  return !current;
}

function addToRecentTracks(guildId, track) {
  if (!track?.info) return;
  
  const recent = recentTracks.get(guildId) ?? [];
  recent.push({
    title: track.info.title,
    author: track.info.author,
    identifier: track.info.identifier,
  });
  
  if (recent.length > MAX_RECENT_TRACKS) {
    recent.shift();
  }
  recentTracks.set(guildId, recent);
  
  const cleanAuthor = cleanArtistName(track.info.author);
  if (cleanAuthor) {
    const artists = recentArtists.get(guildId) ?? [];
    if (!artists.includes(cleanAuthor)) {
      artists.push(cleanAuthor);
      if (artists.length > MAX_RECENT_ARTISTS) {
        artists.shift();
      }
      recentArtists.set(guildId, artists);
    }
  }
}

function cleanArtistName(author) {
  if (!author) return '';
  return author
    .toLowerCase()
    .replace(/\s*[-]?\s*(topic|vevo|official|music|records)$/gi, '')
    .replace(/\s*(ft\.?|feat\.?|featuring|x|&|,).*$/gi, '')
    .trim();
}

function cleanTitle(title) {
  if (!title) return '';
  return title
    .replace(/\s*\(.*?(official|video|audio|lyric|hd|hq|4k|prod\.?).*?\)/gi, '')
    .replace(/\s*\[.*?(official|video|audio|lyric|hd|hq|4k|prod\.?).*?\]/gi, '')
    .replace(/\s*[-|].*?(official|video|audio).*$/gi, '')
    .trim();
}

function isBlacklisted(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return TITLE_BLACKLIST.some(term => lower.includes(term));
}

async function fetchSimilarArtistsFromLastFm(artist) {
  if (!LASTFM_API_KEY) return [];
  
  const cleanArtist = cleanArtistName(artist);
  
  const cached = similarArtistsCache.get(cleanArtist);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.artists;
  }
  
  try {
    const params = new URLSearchParams({
      method: 'artist.getsimilar',
      artist: cleanArtist,
      api_key: LASTFM_API_KEY,
      format: 'json',
      limit: '20',
    });
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LASTFM_TIMEOUT);
    
    const response = await fetch(`${LASTFM_API_URL}?${params}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    if (!response.ok) return [];
    
    const data = await response.json();
    
    if (data.error || !data.similarartists?.artist) {
      return [];
    }
    
    const similarArtists = data.similarartists.artist
      .map(a => a.name.toLowerCase())
      .slice(0, 15);
    
    similarArtistsCache.set(cleanArtist, {
      artists: similarArtists,
      timestamp: Date.now(),
    });
    
    return similarArtists;
  } catch (error) {
    return [];
  }
}

async function findSimilarArtists(artist) {
  const cleanArtist = cleanArtistName(artist);
  
  const lastFmArtists = await fetchSimilarArtistsFromLastFm(artist);
  if (lastFmArtists.length > 0) {
    return lastFmArtists;
  }
  
  if (FALLBACK_SIMILAR[cleanArtist]) {
    return [...FALLBACK_SIMILAR[cleanArtist]];
  }
  
  for (const [known, similar] of Object.entries(FALLBACK_SIMILAR)) {
    if (cleanArtist.includes(known) || known.includes(cleanArtist)) {
      return [...similar];
    }
  }
  
  return [];
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function buildSearchQueries(track, guildId) {
  if (!track?.info) return [];
  
  const { author } = track.info;
  const queries = [];
  const cleanAuthor = cleanArtistName(author);
  const recentArtistsList = recentArtists.get(guildId) ?? [];
  
  // Strategy 1: Find similar artists from Last.fm and pick randomly
  const similarArtists = await findSimilarArtists(author);
  if (similarArtists.length > 0) {
    const availableArtists = similarArtists.filter(a => !recentArtistsList.includes(a.toLowerCase()));
    const artistsToUse = availableArtists.length > 0 ? availableArtists : similarArtists;
    
    const shuffled = shuffleArray(artistsToUse).slice(0, 3);
    for (const artist of shuffled) {
      queries.push(artist);
    }
  }
  
  // Strategy 2: Same artist's other songs
  if (cleanAuthor && cleanAuthor !== 'unknown') {
    queries.push(cleanAuthor);
  }
  
  return queries;
}

function isTrackRecent(guildId, track) {
  if (!track?.info?.identifier) return false;
  
  const recent = recentTracks.get(guildId) ?? [];
  return recent.some(r => 
    r.identifier === track.info.identifier ||
    (r.title === track.info.title && r.author === track.info.author)
  );
}

function isTrackSuitable(track, guildId, lastTrack) {
  if (!track?.info) return false;
  
  if (track.info.identifier === lastTrack?.info?.identifier) return false;
  
  if (isTrackRecent(guildId, track)) return false;
  
  if (isBlacklisted(track.info.title)) return false;
  
  if (track.info.length && track.info.length < 60000) return false;
  
  if (track.info.length && track.info.length > 600000) return false; 
  
  return true;
}

async function findNextTrack(player, lastTrack, client) {
  if (!player || !lastTrack?.info) return null;
  
  const guildId = player.guildId;
  
  addToRecentTracks(guildId, lastTrack);
  
  const queries = await buildSearchQueries(lastTrack, guildId);
  if (!queries.length) return null;
  
  const node = player.node;
  if (!node?.connected) return null;
  
  for (const query of queries) {
    try {
      const searchQuery = `ytsearch:${query}`;
      
      const result = await Promise.race([
        node.search({ query: searchQuery }, client.user),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('timeout')), SEARCH_TIMEOUT)
        ),
      ]);
      
      if (!result?.tracks?.length) continue;
      
      for (const track of result.tracks.slice(0, 15)) {
        if (isTrackSuitable(track, guildId, lastTrack)) {
          return track;
        }
      }
    } catch {

    }
  }
  
  return null;
}

async function handleAutoplay(player, lastTrack, client) {
  if (!isAutoplayEnabled(player.guildId)) return false;
  
  if (player.queue.tracks.length > 0) return false;
  
  if (player.queue.current && player.playing) return false;
  
  const nextTrack = await findNextTrack(player, lastTrack, client);
  if (!nextTrack) return false;
  
  nextTrack.isAutoplay = true;
  
  try {
    await player.queue.add(nextTrack);
    
    if (!player.playing && !player.paused) {
      await player.play();
    }
    return true;
  } catch {
    return false;
  }
}

function clearAutoplayState(guildId) {
  recentTracks.delete(guildId);
  recentArtists.delete(guildId);
}

setInterval(() => {
  const now = Date.now();
  for (const [artist, data] of similarArtistsCache) {
    if (now - data.timestamp > CACHE_TTL) {
      similarArtistsCache.delete(artist);
    }
  }
}, 60 * 60 * 1000); 

module.exports = {
  isAutoplayEnabled,
  setAutoplay,
  toggleAutoplay,
  handleAutoplay,
  clearAutoplayState,
  addToRecentTracks,
};
