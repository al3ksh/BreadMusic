const { getConfig, setConfig } = require('../state/guildConfig');

const recentTracks = new Map();
const skippedAutoplayTracks = new Map();
const preferredSeed = new Map();
const currentAutoplaySeed = new Map();
const autoplayInProgress = new Set();

const MAX_RECENT_TRACKS = 40;
const MAX_SKIPPED_TRACKS = 40;
const MAX_SAME_ARTIST_IN_ROW = 2;
const SEARCH_TIMEOUT = 8000;
const SKIP_MEMORY_TTL = 2 * 60 * 60 * 1000;
const MIN_SCORE = 35;
const TOP_PICK_POOL = 7;
const PICK_SCORE_WINDOW = 20;
const SELECTION_JITTER = 6;
const MAX_SEARCH_QUERIES = 6;
const MAX_SEARCH_TRACKS_PER_QUERY = 12;
const SKIPPED_ARTIST_REJECT_THRESHOLD = 2;
const SKIPPED_AUTHOR_REJECT_THRESHOLD = 1;
const QUICK_SKIP_MAX_MS = 75_000;
const QUICK_SKIP_MAX_RATIO = 0.35;
const ACCEPTED_PLAY_MIN_MS = 90_000;
const ACCEPTED_PLAY_MIN_RATIO = 0.65;

const HARD_REJECT_TERMS = [
  'karaoke',
  'reaction',
  'tutorial',
  'lesson',
  'how to',
  'podcast',
  'interview',
  'vlog',
  'challenge',
  'compilation',
  'best of',
  'top 10',
  'top 5',
  'review',
  'unboxing',
  'trailer',
  'teaser',
  'behind the scenes',
  'making of',
  'explained',
  'breakdown',
  'full album',
  'album completo',
  'hour mix',
  '1 hour',
  '10 hours',
];

const SOFT_PENALTIES = [
  ['remix', 24],
  ['cover', 22],
  ['live', 18],
  ['concert', 18],
  ['lyrics', 14],
  ['lyric video', 16],
  ['letra', 14],
  ['tlumaczenie', 14],
  ['napisy', 14],
  ['instrumental', 8],
  ['acoustic', 10],
  ['slowed', 28],
  ['reverb', 24],
  ['sped up', 28],
  ['nightcore', 30],
  ['8d audio', 24],
  ['bass boosted', 24],
  ['visualizer', 8],
];

const POSITIVE_TERMS = [
  ['official audio', 12],
  ['audio', 6],
  ['topic', 8],
  ['provided to youtube', 8],
];

function isAutoplayEnabled(guildId) {
  const config = getConfig(guildId);
  return config.autoplay ?? false;
}

function setAutoplay(guildId, enabled) {
  setConfig(guildId, { autoplay: enabled });
  if (!enabled) {
    recentTracks.delete(guildId);
    skippedAutoplayTracks.delete(guildId);
    preferredSeed.delete(guildId);
    currentAutoplaySeed.delete(guildId);
  }
}

function toggleAutoplay(guildId) {
  const current = isAutoplayEnabled(guildId);
  setAutoplay(guildId, !current);
  return !current;
}

function addToRecentTracks(guildId, track) {
  const normalized = normalizeTrack(track);
  if (!guildId || !normalized) return;

  const recent = recentTracks.get(guildId) ?? [];
  if (recent.some((entry) => entry.key === normalized.key)) return;

  recent.push(normalized);
  if (recent.length > MAX_RECENT_TRACKS) {
    recent.splice(0, recent.length - MAX_RECENT_TRACKS);
  }

  recentTracks.set(guildId, recent);
}

function recordAutoplaySkip(guildId, track, playback = {}) {
  if (!guildId || !track?.isAutoplay) return;

  const feedback = classifyAutoplaySkip(track, playback);
  if (!feedback?.normalized) return;

  const { normalized } = feedback;
  if (!feedback.record) {
    console.log(
      `[Autoplay] Skip ignored for feedback after accepted listen: "${normalized.title}" (${formatPlaybackFeedback(feedback)})`,
    );
    return false;
  }

  const skipped = pruneSkippedEntries(skippedAutoplayTracks.get(guildId) ?? []);
  const next = skipped.filter((entry) => entry.key !== normalized.key);
  next.push({
    ...normalized,
    skippedAt: Date.now(),
    strength: feedback.strength,
    position: feedback.position,
    ratio: feedback.ratio,
  });

  if (next.length > MAX_SKIPPED_TRACKS) {
    next.splice(0, next.length - MAX_SKIPPED_TRACKS);
  }

  skippedAutoplayTracks.set(guildId, next);
  console.log(
    `[Autoplay] ${feedback.strength} negative feedback saved for "${normalized.title}" by ${normalized.artist || 'unknown'} (${formatPlaybackFeedback(feedback)})`,
  );
  return true;
}

function classifyAutoplaySkip(track, playback = {}) {
  const normalized = normalizeTrack(track);
  if (!normalized) return null;

  const position = normalizePlaybackPosition(playback.position);
  const duration = normalized.duration || 0;
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const accepted = duration > 0
    ? ratio >= ACCEPTED_PLAY_MIN_RATIO || (position >= ACCEPTED_PLAY_MIN_MS && ratio >= QUICK_SKIP_MAX_RATIO)
    : position >= ACCEPTED_PLAY_MIN_MS;

  if (accepted) {
    return { normalized, record: false, position, ratio };
  }

  const quick = position <= QUICK_SKIP_MAX_MS || (duration > 0 && ratio <= QUICK_SKIP_MAX_RATIO);
  return {
    normalized,
    record: true,
    strength: quick ? 'strong' : 'normal',
    position,
    ratio,
  };
}

function normalizePlaybackPosition(position) {
  const value = Number(position);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function formatPlaybackFeedback(feedback) {
  const seconds = Math.round((feedback.position || 0) / 1000);
  const ratio = Number.isFinite(feedback.ratio) ? Math.round(feedback.ratio * 100) : 0;
  return `${seconds}s/${ratio}%`;
}

function normalizeTrack(track) {
  if (!track?.info) return null;

  const info = track.info;
  const title = typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'Unknown';
  const author = typeof info.author === 'string' && info.author.trim() ? info.author.trim() : '';
  const artist = extractArtistName(title, author);
  const clean = cleanTitle(title);
  const identifier = typeof info.identifier === 'string' ? info.identifier : '';
  const uri = typeof info.uri === 'string' ? info.uri : '';
  const duration = getDurationMs(info);
  const key = makeTrackKey({ identifier, uri, title: clean || title, artist });

  return {
    key,
    title,
    cleanTitle: clean,
    author,
    authorKey: normalizeComparable(author),
    artist,
    artistKey: normalizeComparable(artist),
    identifier,
    uri,
    duration,
    sourceName: typeof info.sourceName === 'string' ? info.sourceName : '',
  };
}

function makeTrackKey({ identifier = '', uri = '', title = '', artist = '' }) {
  if (identifier) return `id:${identifier}`;
  if (uri) return `uri:${uri}`;
  return `meta:${normalizeComparable(artist)}:${normalizeComparable(title)}`;
}

function getDurationMs(info = {}) {
  const duration = info.duration ?? info.length ?? 0;
  return Number.isFinite(duration) ? duration : 0;
}

function normalizeComparable(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanArtistName(author) {
  if (!author) return '';
  return normalizeComparable(author)
    .replace(/\b(topic|vevo|official|music|records|recordings|label|entertainment)\b$/gi, '')
    .replace(/\b(ft|feat|featuring|prod)\b.*$/gi, '')
    .trim();
}

function cleanTitle(title) {
  if (!title) return '';
  return String(title)
    .replace(/\s*\([^)]*(official|video|audio|lyric|hd|hq|4k|prod|visualizer)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(official|video|audio|lyric|hd|hq|4k|prod|visualizer)[^\]]*\]/gi, '')
    .replace(/\s*[-|]\s*(official|video|audio|lyrics?|visualizer).*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractArtistName(title, author) {
  const fromAuthor = cleanArtistName(author);
  const titleParts = String(title || '').split(/\s[-\u2013\u2014|]\s/);

  if (titleParts.length >= 2) {
    const fromTitle = cleanArtistName(titleParts[0]);
    if (fromTitle && fromTitle.length > 1 && fromTitle.length < 45) {
      return fromTitle;
    }
  }

  if (fromAuthor && fromAuthor.length > 1 && fromAuthor.length < 45) {
    return fromAuthor;
  }

  const fallback = normalizeComparable(title).match(/^([a-z0-9 ]{2,35})\s+(official|audio|video|lyrics?)\b/i);
  return fallback ? fallback[1].trim() : '';
}

function hasTerm(text, term) {
  const normalizedText = ` ${normalizeComparable(text)} `;
  const normalizedTerm = ` ${normalizeComparable(term)} `;
  return normalizedText.includes(normalizedTerm);
}

function hasHardRejectTerm(track) {
  const haystack = `${track.title} ${track.author}`;
  return HARD_REJECT_TERMS.some((term) => hasTerm(haystack, term));
}

function getSoftPenalty(track) {
  const haystack = `${track.title} ${track.author}`;
  return SOFT_PENALTIES.reduce((total, [term, penalty]) => (
    hasTerm(haystack, term) ? total + penalty : total
  ), 0);
}

function getPositiveTermScore(track) {
  const haystack = `${track.title} ${track.author}`;
  return POSITIVE_TERMS.reduce((total, [term, score]) => (
    hasTerm(haystack, term) ? total + score : total
  ), 0);
}

function tokenSet(text) {
  const normalized = normalizeComparable(text);
  if (!normalized) return new Set();
  return new Set(
    normalized
      .split(' ')
      .filter((token) => token.length > 2 && !['the', 'and', 'feat', 'ft', 'official'].includes(token)),
  );
}

function tokenOverlap(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }

  return shared / Math.min(left.size, right.size);
}

function isTrackRecent(guildId, track) {
  const normalized = normalizeTrack(track);
  if (!normalized) return false;

  const recent = recentTracks.get(guildId) ?? [];
  return recent.some((entry) => (
    entry.key === normalized.key ||
    (
      entry.artist &&
      normalized.artist &&
      entry.artist === normalized.artist &&
      normalizeComparable(entry.cleanTitle) === normalizeComparable(normalized.cleanTitle)
    )
  ));
}

function pruneSkippedEntries(entries) {
  const cutoff = Date.now() - SKIP_MEMORY_TTL;
  return entries.filter((entry) => Number.isFinite(entry.skippedAt) && entry.skippedAt >= cutoff);
}

function getSkippedEntries(guildId) {
  const skipped = pruneSkippedEntries(skippedAutoplayTracks.get(guildId) ?? []);
  skippedAutoplayTracks.set(guildId, skipped);
  return skipped;
}

function wasRecentlySkipped(guildId, track) {
  const normalized = normalizeTrack(track);
  if (!normalized) return false;
  return getSkippedEntries(guildId).some((entry) => entry.key === normalized.key);
}

function snapshotTrackInfo(trackOrInfo) {
  const info = trackOrInfo?.info ?? trackOrInfo;
  if (!info) return null;

  return {
    title: info.title,
    author: info.author,
    identifier: info.identifier,
    uri: info.uri,
    duration: info.duration ?? info.length,
    sourceName: info.sourceName,
  };
}

function isArtistOverplayed(guildId, artistName) {
  if (!artistName) return false;

  const recent = recentTracks.get(guildId) ?? [];
  const lastTracks = recent.slice(-5);
  const sameArtistCount = lastTracks.filter((track) => track.artist === artistName).length;

  return sameArtistCount >= MAX_SAME_ARTIST_IN_ROW;
}

function buildContext(guildId, seedTrack, lastTrack) {
  const seed = normalizeTrack(seedTrack);
  const last = normalizeTrack(lastTrack);
  const root = preferredSeed.has(guildId) ? normalizeTrack({ info: preferredSeed.get(guildId) }) : null;
  const current = currentAutoplaySeed.has(guildId) ? normalizeTrack({ info: currentAutoplaySeed.get(guildId) }) : null;
  const primary = current || seed || root || last;
  const recent = recentTracks.get(guildId) ?? [];
  const skipped = getSkippedEntries(guildId);

  return {
    guildId,
    seed,
    last,
    root,
    current,
    primary,
    recent,
    skipped,
    seedArtist: primary?.artist || last?.artist || '',
    seedTitle: primary?.cleanTitle || primary?.title || last?.cleanTitle || last?.title || '',
    seedDuration: primary?.duration || last?.duration || 0,
  };
}

function buildSearchQueries(context) {
  const artist = context.seedArtist;
  const title = cleanTitle(context.seedTitle);
  const rootArtist = context.root?.artist || '';
  const recentArtists = [...new Set(
    context.recent
      .slice(-8)
      .map((entry) => entry.artist)
      .filter(Boolean)
      .filter((entry) => entry !== artist),
  )];

  const queries = [];
  const add = (query) => {
    const normalized = query.replace(/\s+/g, ' ').trim();
    if (normalized && !queries.includes(normalized)) queries.push(normalized);
  };

  if (artist && title) {
    add(`${artist} ${title} radio`);
  }
  if (artist) {
    add(`${artist} radio mix`);
    add(`${artist} official audio`);
    add(`${artist} topic`);
    add(`${artist} music`);
  }
  if (rootArtist && rootArtist !== artist) {
    if (artist) add(`${artist} ${rootArtist} mix`);
    add(`${rootArtist} radio mix`);
  }

  for (const recentArtist of recentArtists.slice(0, 2)) {
    add(`${recentArtist} ${artist} mix`);
  }

  return queries.slice(0, MAX_SEARCH_QUERIES);
}

async function searchWithTimeout(node, query, requester) {
  return Promise.race([
    node.search({ query }, requester),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), SEARCH_TIMEOUT);
    }),
  ]);
}

async function searchTracks(node, query, client) {
  if (!node?.connected || !query) return [];

  try {
    const result = await searchWithTimeout(node, `ytsearch:${query}`, client.user);
    return result?.tracks?.slice(0, MAX_SEARCH_TRACKS_PER_QUERY) ?? [];
  } catch (error) {
    console.log(`[Autoplay] Search failed for "${query}": ${error.message}`);
    return [];
  }
}

async function getYouTubeRadioMix(node, videoId, client) {
  if (!node?.connected || !videoId) return [];

  try {
    const radioUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
    console.log(`[Autoplay] Fetching YouTube Radio Mix for ${videoId}`);

    const result = await searchWithTimeout(node, radioUrl, client.user);
    const tracks = result?.tracks ?? [];
    console.log(`[Autoplay] YouTube Radio Mix returned ${tracks.length} tracks`);
    return tracks;
  } catch (error) {
    console.log(`[Autoplay] YouTube Radio Mix failed: ${error.message}`);
    return [];
  }
}

function isYouTubeIdentifier(identifier) {
  return typeof identifier === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(identifier);
}

async function resolveYouTubeId(node, track, client) {
  const normalized = normalizeTrack(track);
  if (!normalized) return null;
  if (isYouTubeIdentifier(normalized.identifier)) return normalized.identifier;

  const query = `${normalized.artist || normalized.author} ${normalized.cleanTitle || normalized.title}`.trim();
  if (!query) return null;

  console.log(`[Autoplay] Resolving YouTube ID for "${query}"`);

  try {
    const result = await searchWithTimeout(node, `ytsearch:${query}`, client.user);
    const identifier = result?.tracks?.[0]?.info?.identifier;
    if (isYouTubeIdentifier(identifier)) {
      console.log(`[Autoplay] Resolved to YouTube ID: ${identifier}`);
      return identifier;
    }
  } catch (error) {
    console.log(`[Autoplay] YouTube ID resolve failed: ${error.message}`);
  }

  return null;
}

function addCandidate(candidates, track, source, index = 0) {
  const normalized = normalizeTrack(track);
  if (!normalized) return;

  const existing = candidates.get(normalized.key);
  const candidate = {
    track,
    normalized,
    source,
    sourceIndex: index,
  };

  if (!existing || sourcePriority(source) > sourcePriority(existing.source)) {
    candidates.set(normalized.key, candidate);
  }
}

function sourcePriority(source) {
  if (source === 'radio') return 3;
  if (source === 'search') return 2;
  return 1;
}

function scoreCandidate(candidate, context) {
  const track = candidate.normalized;
  const reasons = [];
  let score = 50;

  if (!track.title || track.title === 'Unknown') {
    return { score: -Infinity, rejected: true, reason: 'missing title' };
  }

  if (context.last && track.key === context.last.key) {
    return { score: -Infinity, rejected: true, reason: 'same as last track' };
  }

  if (context.seed && track.key === context.seed.key) {
    return { score: -Infinity, rejected: true, reason: 'same as seed track' };
  }

  if (isTrackRecent(context.guildId, candidate.track)) {
    return { score: -Infinity, rejected: true, reason: 'recent duplicate' };
  }

  if (hasHardRejectTerm(track)) {
    return { score: -Infinity, rejected: true, reason: 'blocked title pattern' };
  }

  if (track.duration > 0 && track.duration < 55_000) {
    return { score: -Infinity, rejected: true, reason: 'too short' };
  }

  if (track.duration > 13 * 60_000) {
    return { score: -Infinity, rejected: true, reason: 'too long' };
  }

  if (candidate.source === 'radio') {
    score += 22;
    reasons.push('radio');
  } else if (candidate.source === 'search') {
    score += 6;
  }

  const positive = getPositiveTermScore(track);
  if (positive) {
    score += positive;
    reasons.push(`positive:${positive}`);
  }

  const penalty = getSoftPenalty(track);
  if (penalty) {
    score -= penalty;
    reasons.push(`soft-penalty:${penalty}`);
  }

  if (context.seedArtist && track.artist) {
    if (track.artist === context.seedArtist) {
      score += 8;
      reasons.push('same-artist');
    } else {
      score += 10;
      reasons.push('artist-variety');
    }
  }

  const recentSameArtist = context.recent.filter((entry) => entry.artist && entry.artist === track.artist).length;
  if (recentSameArtist > 0) {
    score -= Math.min(24, recentSameArtist * 8);
    reasons.push(`recent-artist:${recentSameArtist}`);
  }

  if (isArtistOverplayed(context.guildId, context.seedArtist) && track.artist === context.seedArtist) {
    score -= 45;
    reasons.push('loop-guard');
  }

  if (context.seedDuration > 0 && track.duration > 0) {
    const ratio = track.duration / context.seedDuration;
    if (ratio >= 0.65 && ratio <= 1.55) {
      score += 10;
      reasons.push('duration-match');
    } else if (ratio >= 0.45 && ratio <= 2.2) {
      score += 2;
    } else {
      score -= 12;
      reasons.push('duration-drift');
    }
  }

  const overlap = tokenOverlap(track.cleanTitle || track.title, context.seedTitle);
  if (overlap >= 0.82 && track.artist === context.seedArtist) {
    return { score: -Infinity, rejected: true, reason: 'same song variant' };
  }
  if (overlap >= 0.55) {
    score -= 14;
    reasons.push('title-overlap');
  }

  for (const skipped of context.skipped) {
    if (skipped.key === track.key) {
      return { score: -Infinity, rejected: true, reason: 'recently skipped' };
    }
  }

  const skippedArtistMatches = context.skipped.filter((skipped) => (
    skipped.artistKey && track.artistKey && skipped.artistKey === track.artistKey
  ));
  const strongSkippedSameArtist = skippedArtistMatches.filter((skipped) => skipped.strength !== 'normal').length;
  if (strongSkippedSameArtist >= SKIPPED_ARTIST_REJECT_THRESHOLD) {
    return { score: -Infinity, rejected: true, reason: 'recently skipped artist' };
  }
  if (skippedArtistMatches.length > 0) {
    const normalSkippedSameArtist = skippedArtistMatches.length - strongSkippedSameArtist;
    score -= (strongSkippedSameArtist * 28) + (normalSkippedSameArtist * 14);
    reasons.push(`skipped-artist:${skippedArtistMatches.length}`);
  }

  const skippedAuthorMatches = context.skipped.filter((skipped) => (
    skipped.authorKey && track.authorKey && skipped.authorKey === track.authorKey
  ));
  const strongSkippedSameAuthor = skippedAuthorMatches.filter((skipped) => skipped.strength !== 'normal').length;
  if (strongSkippedSameAuthor >= SKIPPED_AUTHOR_REJECT_THRESHOLD) {
    return { score: -Infinity, rejected: true, reason: 'recently skipped channel' };
  }
  if (skippedAuthorMatches.length > 0) {
    const normalSkippedSameAuthor = skippedAuthorMatches.length - strongSkippedSameAuthor;
    score -= (strongSkippedSameAuthor * 32) + (normalSkippedSameAuthor * 16);
    reasons.push(`skipped-channel:${skippedAuthorMatches.length}`);
  }

  score -= Math.min(10, candidate.sourceIndex);

  return {
    score,
    rejected: score < MIN_SCORE,
    reason: score < MIN_SCORE ? 'low score' : reasons.join(', ') || 'ok',
  };
}

function pickCandidate(scoredCandidates) {
  const eligible = scoredCandidates
    .filter((candidate) => !candidate.rejected)
    .sort((a, b) => b.score - a.score);

  if (!eligible.length) return null;

  const bestScore = eligible[0].score;
  const pool = eligible
    .filter((candidate) => candidate.score >= Math.max(MIN_SCORE, bestScore - PICK_SCORE_WINDOW))
    .map((candidate) => ({
      ...candidate,
      selectionScore: candidate.score + (Math.random() * SELECTION_JITTER),
    }))
    .sort((a, b) => b.selectionScore - a.selectionScore)
    .slice(0, TOP_PICK_POOL);

  const totalWeight = pool.reduce((sum, candidate) => sum + Math.max(1, candidate.selectionScore - MIN_SCORE + 1), 0);
  let roll = Math.random() * totalWeight;

  for (const candidate of pool) {
    roll -= Math.max(1, candidate.selectionScore - MIN_SCORE + 1);
    if (roll <= 0) return candidate;
  }

  return pool[0];
}

function logCandidateSummary(scoredCandidates, selected) {
  const top = scoredCandidates
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((candidate) => `${candidate.score}:${candidate.normalized.artist || '?'} - ${candidate.normalized.title}`)
    .join(' | ');

  if (top) console.log(`[Autoplay] Top candidates: ${top}`);
  if (selected) {
    console.log(
      `[Autoplay] Selected (${selected.score}) from ${selected.source}: "${selected.normalized.title}" by ${selected.normalized.artist || selected.normalized.author || 'unknown'} (${selected.reason})`,
    );
  }
}

async function findNextTrack(player, lastTrack, client) {
  if (!player || !lastTrack?.info) return null;

  const guildId = player.guildId;
  const node = player.node;

  if (lastTrack.isAutoplay) {
    if (wasRecentlySkipped(guildId, lastTrack)) {
      console.log(`[Autoplay] Skipped autoplay track will not become the next seed: "${lastTrack.info.title}"`);
    } else {
      const acceptedSeed = snapshotTrackInfo(lastTrack);
      if (acceptedSeed) {
        currentAutoplaySeed.set(guildId, acceptedSeed);
        console.log(`[Autoplay] Accepted autoplay seed promoted: "${acceptedSeed.title}"`);
      }
    }
  } else {
    const manualSeed = snapshotTrackInfo(lastTrack);
    if (manualSeed) {
      preferredSeed.set(guildId, manualSeed);
      currentAutoplaySeed.delete(guildId);
      skippedAutoplayTracks.delete(guildId);
      console.log(`[Autoplay] New manual seed detected: "${manualSeed.title}"`);
    }
    recentTracks.delete(guildId);
  }

  const activeSeed = currentAutoplaySeed.get(guildId) || preferredSeed.get(guildId) || snapshotTrackInfo(lastTrack);
  const seedTrack = activeSeed ? { info: activeSeed } : lastTrack;
  if (activeSeed && activeSeed.title !== lastTrack.info.title) {
    console.log(`[Autoplay] Using active seed: "${activeSeed.title}" instead of "${lastTrack.info.title}"`);
  }

  addToRecentTracks(guildId, lastTrack);

  if (!node?.connected) {
    console.log('[Autoplay] Node not connected');
    return null;
  }

  const context = buildContext(guildId, seedTrack, lastTrack);
  if (!context.seedArtist && !context.seedTitle) {
    console.log('[Autoplay] Could not build seed context');
    return null;
  }

  const candidates = new Map();
  let videoId = context.seed?.identifier || context.last?.identifier;

  if (!isYouTubeIdentifier(videoId)) {
    console.log('[Autoplay] Non-YouTube seed detected, resolving YouTube ID...');
    videoId = await resolveYouTubeId(node, seedTrack, client);
  }

  if (videoId) {
    const radioTracks = await getYouTubeRadioMix(node, videoId, client);
    radioTracks.forEach((track, index) => addCandidate(candidates, track, 'radio', index));
  }

  const queries = buildSearchQueries(context);
  console.log(`[Autoplay] Search queries: ${queries.join(' | ') || 'none'}`);

  for (const query of queries) {
    const tracks = await searchTracks(node, query, client);
    tracks.forEach((track, index) => addCandidate(candidates, track, 'search', index));
  }

  if (!candidates.size) {
    console.log('[Autoplay] No candidates found');
    return null;
  }

  const scoredCandidates = [...candidates.values()].map((candidate) => ({
    ...candidate,
    ...scoreCandidate(candidate, context),
  }));

  const selected = pickCandidate(scoredCandidates);
  logCandidateSummary(scoredCandidates, selected);

  if (!selected) {
    console.log('[Autoplay] No candidate reached minimum score');
  }

  return selected?.track ?? null;
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
  } catch (error) {
    console.log(`[Autoplay] Failed: ${error.message}`);
    return false;
  } finally {
    autoplayInProgress.delete(guildId);
  }
}

function clearAutoplayState(guildId) {
  recentTracks.delete(guildId);
  skippedAutoplayTracks.delete(guildId);
  preferredSeed.delete(guildId);
  currentAutoplaySeed.delete(guildId);
}

function resetSeed(guildId, trackInfo = null) {
  console.log(`[Autoplay] Seed reset for guild ${guildId} - manual track added`);
  recentTracks.delete(guildId);
  skippedAutoplayTracks.delete(guildId);
  currentAutoplaySeed.delete(guildId);
  if (trackInfo) {
    const seedInfo = snapshotTrackInfo(trackInfo);
    if (!seedInfo) return;
    preferredSeed.set(guildId, seedInfo);
    console.log(`[Autoplay] Preferred seed set: "${seedInfo.title}" by ${seedInfo.author}`);
  }
}

setInterval(() => {
  for (const [guildId, entries] of skippedAutoplayTracks) {
    const pruned = pruneSkippedEntries(entries);
    if (pruned.length) {
      skippedAutoplayTracks.set(guildId, pruned);
    } else {
      skippedAutoplayTracks.delete(guildId);
    }
  }
}, 10 * 60 * 1000);

module.exports = {
  isAutoplayEnabled,
  setAutoplay,
  toggleAutoplay,
  handleAutoplay,
  clearAutoplayState,
  addToRecentTracks,
  recordAutoplaySkip,
  resetSeed,
};
