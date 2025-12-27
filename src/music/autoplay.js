const { getConfig, setConfig } = require('../state/guildConfig');

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';

const recentTracks = new Map();
const similarArtistsCache = new Map();
const preferredSeed = new Map();
const autoplayInProgress = new Set(); 

const MAX_RECENT_TRACKS = 30;
const MAX_RECENT_ARTISTS = 10;
const MAX_SAME_ARTIST_IN_ROW = 2;
const SEARCH_TIMEOUT = 8000;
const LASTFM_TIMEOUT = 3000;
const CACHE_TTL = 24 * 60 * 60 * 1000; 

const TITLE_BLACKLIST = [
  'remix', 'cover', 'karaoke', 'instrumental', 'acoustic version',
  'live', 'concert', 'reaction', 'tutorial', 'lesson', 'how to',
  'slowed', 'reverb', 'sped up', 'nightcore', '8d audio', 'bass boosted',
  'lyrics', 'lyric video', 'letra', 'tłumaczenie', 'napisy', 'set',
  'podcast', 'interview', 'vlog', 'challenge', 'compilation', 'best of',
  'top 10', 'top 5', 'review', 'unboxing', 'trailer', 'teaser',
  'behind the scenes', 'making of', 'explained', 'breakdown'
];

function isAutoplayEnabled(guildId) {
  const config = getConfig(guildId);
  return config.autoplay ?? false;
}

function setAutoplay(guildId, enabled) {
  setConfig(guildId, { autoplay: enabled });
  if (!enabled) {
    recentTracks.delete(guildId);
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
  
  if (recent.some(r => r.identifier === track.info.identifier)) return;
  
  recent.push({
    title: track.info.title,
    author: track.info.author,
    identifier: track.info.identifier,
    artistName: extractArtistName(track.info.title, track.info.author),
  });
  
  if (recent.length > MAX_RECENT_TRACKS) {
    recent.shift();
  }
  recentTracks.set(guildId, recent);
}

function extractArtistName(title, author) {
  const separators = [' - ', ' – ', ' — ', ' | '];
  for (const sep of separators) {
    if (title?.includes(sep)) {
      const artist = title.split(sep)[0]
        .replace(/\s*(ft\.?|feat\.?|featuring|x|&|,).*$/gi, '')
        .replace(/\s*\(.*?\)/g, '')
        .trim()
        .toLowerCase();
      if (artist && artist.length > 1 && artist.length < 40) {
        return artist;
      }
    }
  }
  
  if (title) {
    const match = title.match(/^([A-Za-z0-9\s&]+?)(?:\s*[('"]|\s*\()/i);
    if (match && match[1]) {
      const artist = match[1].trim().toLowerCase();
      if (artist.length > 1 && artist.length < 30) {
        return artist;
      }
    }
  }
  
  return cleanArtistName(author);
}

function isArtistOverplayed(guildId, artistName) {
  if (!artistName) return false;
  
  const recent = recentTracks.get(guildId) ?? [];
  const lastTracks = recent.slice(-5); 
  
  const sameArtistCount = lastTracks.filter(t => 
    t.artistName?.toLowerCase() === artistName.toLowerCase()
  ).length;
  
  return sameArtistCount >= MAX_SAME_ARTIST_IN_ROW;
}

function cleanArtistName(author) {
  if (!author) return '';
  return author
    .toLowerCase()
    .replace(/\s*[-]?\s*(topic|vevo|official|music|records|label|entertainment)$/gi, '')
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
  if (!LASTFM_API_KEY) {
    console.log('[Autoplay] No Last.fm API key configured');
    return [];
  }
  
  const cleanArtist = artist?.toLowerCase().trim();
  if (!cleanArtist) return [];
  
  const cached = similarArtistsCache.get(cleanArtist);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[Autoplay] Using cached similar artists for "${cleanArtist}"`);
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
    
    if (!response.ok) {
      console.log(`[Autoplay] Last.fm API returned ${response.status} for "${cleanArtist}"`);
      return [];
    }
    
    const data = await response.json();
    
    if (data.error || !data.similarartists?.artist) {
      console.log(`[Autoplay] Last.fm found no similar artists for "${cleanArtist}"`);
      return [];
    }
    
    const similarArtists = data.similarartists.artist
      .map(a => a.name.toLowerCase())
      .slice(0, 15);
    
    console.log(`[Autoplay] Last.fm found ${similarArtists.length} similar artists for "${cleanArtist}": ${similarArtists.slice(0, 5).join(', ')}...`);
    
    similarArtistsCache.set(cleanArtist, {
      artists: similarArtists,
      timestamp: Date.now(),
    });
    
    return similarArtists;
  } catch (error) {
    console.log(`[Autoplay] Last.fm API error for "${cleanArtist}":`, error.message);
    return [];
  }
}

async function findSimilarArtists(artistName) {
  if (!artistName) return [];
  
  const lastFmArtists = await fetchSimilarArtistsFromLastFm(artistName);
  if (lastFmArtists.length > 0) {
    return lastFmArtists;
  }
  
  console.log(`[Autoplay] No similar artists found for "${artistName}"`);
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
  
  const artistName = extractArtistName(track.info.title, track.info.author);
  
  if (!artistName) {
    console.log('[Autoplay] Could not determine artist name');
    return [];
  }
  
  console.log(`[Autoplay] Building queries for artist: "${artistName}"`);
  
  const queries = [];
  const recent = recentTracks.get(guildId) ?? [];
  const recentArtists = recent.slice(-10).map(r => r.artistName?.toLowerCase()).filter(Boolean);
  
  const similarArtists = await findSimilarArtists(artistName);
  
  if (similarArtists.length > 0) {
    const availableArtists = similarArtists.filter(a => 
      !recentArtists.includes(a.toLowerCase())
    );
    
    const artistsToSearch = shuffleArray(
      availableArtists.length > 0 ? availableArtists : similarArtists
    ).slice(0, 4);
    
    for (const artist of artistsToSearch) {
      queries.push(`${artist} music`);
    }
  }
  
  if (!recentArtists.slice(-3).includes(artistName.toLowerCase())) {
    queries.push(`${artistName} music`);
  }
  
  console.log(`[Autoplay] Generated ${queries.length} queries: ${queries.slice(0, 3).join(', ')}...`);
  
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
  
  if (track.info.length && track.info.length > 720000) return false;
  
  return true;
}

async function getYouTubeRadioMix(node, videoId, client) {
  if (!node?.connected || !videoId) return [];
  
  try {
    const radioUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
    
    console.log(`[Autoplay] Fetching YouTube Radio Mix for ${videoId}`);
    
    const result = await Promise.race([
      node.search({ query: radioUrl }, client.user),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), SEARCH_TIMEOUT)
      ),
    ]);
    
    if (result?.tracks?.length) {
      console.log(`[Autoplay] YouTube Radio Mix returned ${result.tracks.length} tracks`);
      return result.tracks;
    }
    
    return [];
  } catch (error) {
    console.log(`[Autoplay] YouTube Radio Mix failed: ${error.message}`);
    return [];
  }
}

async function findNextTrack(player, lastTrack, client) {
  if (!player || !lastTrack?.info) return null;
  
  const guildId = player.guildId;
  const node = player.node;
  
  const savedSeed = preferredSeed.get(guildId);
  let seedTrack = lastTrack;
  
  if (savedSeed) {
    console.log(`[Autoplay] Using preferred seed: "${savedSeed.title}" instead of "${lastTrack.info.title}"`);
    seedTrack = { info: savedSeed };
    preferredSeed.delete(guildId); 
  } else if (!lastTrack.isAutoplay) {
    console.log(`[Autoplay] New seed track detected: "${lastTrack.info.title}" - resetting history for fresh recommendations`);
    recentTracks.delete(guildId);
  }
  
  addToRecentTracks(guildId, lastTrack);
  
  if (!node?.connected) {
    console.log('[Autoplay] Node not connected');
    return null;
  }
  
  const seedArtist = extractArtistName(seedTrack.info.title, seedTrack.info.author);
  const isLooping = isArtistOverplayed(guildId, seedArtist);
  
  if (isLooping) {
    console.log(`[Autoplay] Loop detected! Artist "${seedArtist}" played too many times, forcing variety`);
  }
  
  const radioTracks = await getYouTubeRadioMix(node, seedTrack.info.identifier, client);
  
  const shuffledRadio = radioTracks
    .filter(t => t.info.identifier !== seedTrack.info.identifier && t.info.identifier !== lastTrack.info.identifier)
    .sort(() => Math.random() - 0.5);
  
  for (const track of shuffledRadio) {
    const trackArtist = extractArtistName(track.info.title, track.info.author);
    
    if (isLooping && trackArtist?.toLowerCase() === seedArtist?.toLowerCase()) {
      continue;
    }
    
    if (isTrackSuitable(track, guildId, lastTrack, false)) {
      console.log(`[Autoplay] Selected from Radio Mix: "${track.info.title}" by ${track.info.author}`);
      return track;
    }
  }
  
  console.log('[Autoplay] Radio Mix had no good tracks, trying Last.fm...');
  
  const queries = await buildSearchQueries(seedTrack, guildId);
  
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
      
      const shuffled = result.tracks.slice(0, 15).sort(() => Math.random() - 0.5);
      
      for (const track of shuffled) {
        const trackArtist = extractArtistName(track.info.title, track.info.author);
        
        if (isLooping && trackArtist?.toLowerCase() === seedArtist?.toLowerCase()) {
          continue;
        }
        
        if (isTrackSuitable(track, guildId, lastTrack, false)) {
          console.log(`[Autoplay] Selected from search "${query}": "${track.info.title}"`);
          return track;
        }
      }
    } catch {
    }
  }
  
  console.log('[Autoplay] No suitable track found');
  return null;
}

async function handleAutoplay(player, lastTrack, client) {
  const guildId = player.guildId;
  
  if (!isAutoplayEnabled(guildId)) return false;
  
  if (player.queue.tracks.length > 0) return false;
  
  if (player.queue.current && player.playing) return false;
  
  if (autoplayInProgress.has(guildId)) {
    console.log(`[Autoplay] Already in progress for guild ${guildId}, skipping`);
    return false;
  }
  
  autoplayInProgress.add(guildId);
  
  try {
    const nextTrack = await findNextTrack(player, lastTrack, client);
    if (!nextTrack) return false;
    
    nextTrack.isAutoplay = true;
    
    await player.queue.add(nextTrack);
    
    if (!player.playing && !player.paused) {
      await player.play();
    }
    return true;
  } catch {
    return false;
  } finally {
    autoplayInProgress.delete(guildId);
  }
}

function clearAutoplayState(guildId) {
  recentTracks.delete(guildId);
}

function resetSeed(guildId, trackInfo = null) {
  console.log(`[Autoplay] Seed reset for guild ${guildId} - manual track added`);
  recentTracks.delete(guildId);
  if (trackInfo) {
    preferredSeed.set(guildId, trackInfo);
    console.log(`[Autoplay] Preferred seed set: "${trackInfo.title}" by ${trackInfo.author}`);
  }
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
  resetSeed,
};
