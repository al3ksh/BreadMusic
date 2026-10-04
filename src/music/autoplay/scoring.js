const { hasTerm, normalizeComparable, tokenOverlap } = require('./normalize');

const MIN_SCORE = 35;
const TOP_PICK_POOL = 7;
const PICK_SCORE_WINDOW = 20;
const SELECTION_JITTER = 6;
const MAX_SAME_ARTIST_IN_ROW = 2;
const SKIPPED_ARTIST_REJECT_THRESHOLD = 2;
const SKIPPED_AUTHOR_REJECT_THRESHOLD = 1;
const DISLIKED_ARTIST_REJECT_THRESHOLD = 2;
const DISLIKED_ARTIST_PENALTY = 30;
const PLAYED_REJECT_MS = 12 * 60 * 60 * 1000;
const PLAYED_PENALTY = 18;
const LIKED_ARTIST_BONUS = 10;
// Each present listener who liked the artist adds the bonus once, up to this many listeners.
const LIKED_ARTIST_MAX_LISTENERS = 3;

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
  'blend',
  'mashup',
  'megamix',
  'non stop mix',
  'radio mix',
  'dj mix',
  '8d audio',
  'nightcore',
  'bass boosted',
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
  ['clean', 18],
  ['radio edit', 16],
  ['reupload', 14],
];

const POSITIVE_TERMS = [
  ['official audio', 12],
  ['audio', 6],
  ['topic', 8],
  ['provided to youtube', 8],
];

const SOURCE_BONUS = {
  radio: 22,
  search: 6,
  discovery: 8,
};

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

function isTrackRecent(recent, track) {
  return recent.some((entry) => (
    entry.key === track.key ||
    (
      entry.artist &&
      track.artist &&
      entry.artist === track.artist &&
      normalizeComparable(entry.cleanTitle) === normalizeComparable(track.cleanTitle)
    )
  ));
}

function skipWeightOf(entry) {
  return Number.isFinite(entry.weight) ? entry.weight : 1;
}

function sumWeights(entries) {
  return entries.reduce((total, entry) => total + skipWeightOf(entry), 0);
}

function isArtistOverplayed(recent, artistName) {
  if (!artistName) return false;
  const sameArtistCount = recent.slice(-5).filter((track) => track.artist === artistName).length;
  return sameArtistCount >= MAX_SAME_ARTIST_IN_ROW;
}

function scoreCandidate(candidate, context) {
  const track = candidate.normalized;
  const recent = context.recent ?? [];
  const skipped = context.skipped ?? [];
  const manualSeeds = context.manualSeeds ?? [];
  const reasons = [];
  let score = 50;

  if (!track.title || track.title === 'Unknown') {
    return { score: -Infinity, rejected: true, reason: 'missing title' };
  }

  if (context.last && track.key === context.last.key) {
    return { score: -Infinity, rejected: true, reason: 'same as last track' };
  }

  const profileSeeds = manualSeeds.length
    ? manualSeeds
    : [context.seed, context.primary].filter(Boolean);
  if (profileSeeds.some((seed) => seed.key === track.key)) {
    return { score: -Infinity, rejected: true, reason: 'same as manual seed track' };
  }

  if (isTrackRecent(recent, track)) {
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

  const sourceBonus = SOURCE_BONUS[candidate.source] ?? 0;
  score += sourceBonus;
  if (candidate.source === 'radio') {
    reasons.push('radio');
  } else if (candidate.source === 'lastfm') {
    // Stronger Last.fm similarity earns more: +10 for a weak match up to +22 for an exact one.
    score += 10 + Math.round((candidate.lastfmMatch ?? 0) * 12);
    reasons.push('lastfm');
  } else if (candidate.source === 'discovery') {
    reasons.push(`ai-discovery:${candidate.discoveryDistance || 'unknown'}`);
  }

  const anchorMatches = candidate.anchorKeys?.size ?? 0;
  if (anchorMatches > 1) {
    const consensusBoost = Math.min(18, (anchorMatches - 1) * 9);
    score += consensusBoost;
    reasons.push(`profile-consensus:${anchorMatches}`);
  }
  if (Number.isFinite(candidate.anchorRank)) {
    const anchorBoost = Math.max(0, 6 - (candidate.anchorRank * 2));
    score += anchorBoost;
    if (anchorBoost) reasons.push(`anchor:${candidate.anchorRank + 1}`);
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

  const matchesManualArtist = Boolean(track.artist) && manualSeeds.some((seed) => seed.artist === track.artist);
  if (track.artist) {
    if (matchesManualArtist) {
      score += 12;
      reasons.push('manual-artist');
    } else if (manualSeeds.length > 0) {
      score += 5;
      reasons.push('profile-discovery');
    } else if (context.seedArtist) {
      score += track.artist === context.seedArtist ? 8 : 10;
      reasons.push(track.artist === context.seedArtist ? 'same-artist' : 'artist-variety');
    }
  }

  const recentArtistTail = recent.slice(-2).filter((entry) => entry.artist);
  if (
    track.artist &&
    recentArtistTail.length === 2 &&
    recentArtistTail.every((entry) => entry.artist === track.artist)
  ) {
    return { score: -Infinity, rejected: true, reason: 'artist streak limit' };
  }
  const recentSameArtist = recent
    .slice(-8)
    .filter((entry) => entry.artist && entry.artist === track.artist)
    .length;
  if (recentSameArtist > 0) {
    const perTrackPenalty = matchesManualArtist ? 7 : 8;
    score -= Math.min(matchesManualArtist ? 21 : 24, recentSameArtist * perTrackPenalty);
    reasons.push(`recent-artist:${recentSameArtist}`);
  }

  if (isArtistOverplayed(recent, track.artist)) {
    score -= 45;
    reasons.push('loop-guard');
  }

  const seedDurations = (context.activeSeeds ?? [])
    .map((seed) => seed.duration)
    .filter((duration) => duration > 0);
  if (seedDurations.length > 0 && track.duration > 0) {
    const ratio = seedDurations
      .map((duration) => track.duration / duration)
      .sort((left, right) => Math.abs(Math.log(left)) - Math.abs(Math.log(right)))[0];
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

  const titleComparisons = profileSeeds.map((seed) => ({
    seed,
    overlap: tokenOverlap(track.cleanTitle || track.title, seed.cleanTitle || seed.title),
  }));
  const sameSongVariant = titleComparisons.some(({ seed, overlap }) => (
    overlap >= 0.82 && track.artist && seed.artist === track.artist
  ));
  if (sameSongVariant) {
    return { score: -Infinity, rejected: true, reason: 'same song variant' };
  }
  const overlap = titleComparisons.reduce((maximum, entry) => Math.max(maximum, entry.overlap), 0);
  if (overlap >= 0.55) {
    score -= 14;
    reasons.push('title-overlap');
  }

  // Skips fade with age (entry.weight): recent ones reject, older ones only lower the score.
  const skippedTrack = skipped.find((entry) => entry.key === track.key);
  if (skippedTrack) {
    if (skipWeightOf(skippedTrack) >= 0.5) {
      return { score: -Infinity, rejected: true, reason: 'recently skipped' };
    }
    score -= 20;
    reasons.push('skipped-before');
  }

  // A reroll only rejects that exact pick, never its artist or channel.
  const artistSkips = skipped.filter((entry) => entry.strength !== 'reroll');
  const skippedArtistMatches = artistSkips.filter((entry) => (
    entry.artistKey && track.artistKey && entry.artistKey === track.artistKey
  ));
  const strongSkippedSameArtist = sumWeights(skippedArtistMatches.filter((entry) => entry.strength !== 'normal'));
  if (strongSkippedSameArtist >= SKIPPED_ARTIST_REJECT_THRESHOLD) {
    return { score: -Infinity, rejected: true, reason: 'recently skipped artist' };
  }
  if (skippedArtistMatches.length > 0) {
    const normalSkippedSameArtist = sumWeights(skippedArtistMatches.filter((entry) => entry.strength === 'normal'));
    score -= Math.round((strongSkippedSameArtist * 28) + (normalSkippedSameArtist * 14));
    reasons.push(`skipped-artist:${skippedArtistMatches.length}`);
  }

  const skippedAuthorMatches = artistSkips.filter((entry) => (
    entry.authorKey && track.authorKey && entry.authorKey === track.authorKey
  ));
  const strongSkippedSameAuthor = sumWeights(skippedAuthorMatches.filter((entry) => entry.strength !== 'normal'));
  if (strongSkippedSameAuthor >= SKIPPED_AUTHOR_REJECT_THRESHOLD) {
    return { score: -Infinity, rejected: true, reason: 'recently skipped channel' };
  }
  if (skippedAuthorMatches.length > 0) {
    const normalSkippedSameAuthor = sumWeights(skippedAuthorMatches.filter((entry) => entry.strength === 'normal'));
    score -= Math.round((strongSkippedSameAuthor * 32) + (normalSkippedSameAuthor * 16));
    reasons.push(`skipped-channel:${skippedAuthorMatches.length}`);
  }

  const taste = context.taste;
  if (taste) {
    if (taste.dislikedKeys?.has(track.key)) {
      return { score: -Infinity, rejected: true, reason: 'disliked' };
    }
    const dislikedArtist = track.artistKey ? (taste.dislikedArtistCounts?.get(track.artistKey) || 0) : 0;
    if (dislikedArtist >= DISLIKED_ARTIST_REJECT_THRESHOLD) {
      return { score: -Infinity, rejected: true, reason: 'disliked artist' };
    }
    if (dislikedArtist > 0) {
      score -= DISLIKED_ARTIST_PENALTY;
      reasons.push('disliked-artist');
    }

    const playedAt = taste.played?.get(track.key);
    if (Number.isFinite(playedAt)) {
      if ((taste.now ?? Date.now()) - playedAt < PLAYED_REJECT_MS) {
        return { score: -Infinity, rejected: true, reason: 'played recently' };
      }
      score -= PLAYED_PENALTY;
      reasons.push('played-earlier');
    }

    const likedArtist = track.artistKey ? (taste.likedArtistCounts?.get(track.artistKey) || 0) : 0;
    if (likedArtist > 0) {
      score += LIKED_ARTIST_BONUS * Math.min(likedArtist, LIKED_ARTIST_MAX_LISTENERS);
      reasons.push(`liked-artist:${likedArtist}`);
    }
  }

  score -= Math.min(10, candidate.sourceIndex || 0);

  return {
    score,
    rejected: score < MIN_SCORE,
    reason: score < MIN_SCORE ? 'low score' : reasons.join(', ') || 'ok',
  };
}

function pickCandidateLocally(scoredCandidates, random = Math.random) {
  const eligible = scoredCandidates
    .filter((candidate) => !candidate.rejected)
    .sort((a, b) => b.score - a.score);

  if (!eligible.length) return null;

  const bestScore = eligible[0].score;
  const pool = eligible
    .filter((candidate) => candidate.score >= Math.max(MIN_SCORE, bestScore - PICK_SCORE_WINDOW))
    .map((candidate) => ({
      ...candidate,
      selectionScore: candidate.score + (random() * SELECTION_JITTER),
    }))
    .sort((a, b) => b.selectionScore - a.selectionScore)
    .slice(0, TOP_PICK_POOL);

  const totalWeight = pool.reduce((sum, candidate) => sum + Math.max(1, candidate.selectionScore - MIN_SCORE + 1), 0);
  let roll = random() * totalWeight;

  for (const candidate of pool) {
    roll -= Math.max(1, candidate.selectionScore - MIN_SCORE + 1);
    if (roll <= 0) return candidate;
  }

  return pool[0];
}

module.exports = {
  MIN_SCORE,
  scoreCandidate,
  pickCandidateLocally,
};
