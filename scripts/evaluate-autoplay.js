const path = require('node:path');

require('dotenv').config();

const {
  getDiscoveryArtists,
  pickCandidateWithGemini,
  resetGeminiAutoplayState,
} = require(path.join(process.cwd(), 'src/music/autoplayAi'));

const DEFAULT_STEPS = 6;
const REQUEST_TIMEOUT_MS = 10_000;
const HARD_REJECT = /\b(?:blend|mashup|megamix|nightcore|8d audio|bass boosted|slowed|reverb|karaoke|reaction|full album|hour mix)\b/i;

const DEFAULT_SEEDS = [
  ['Taconafide', 'Tamagotchi'],
  ['Kendrick Lamar', 'Mortal Man'],
  ['Katy Perry', 'Dark Horse'],
  ['Deftones', 'Change In the House of Flies'],
  ['Daft Punk', 'Get Lucky'],
  ['sanah', 'Szampan'],
];

function readIntegerFlag(name, fallback, minimum, maximum) {
  const index = process.argv.indexOf(name);
  const parsed = index >= 0 ? Number.parseInt(process.argv[index + 1], 10) : fallback;
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function comparable(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanArtist(author, title) {
  const titleArtist = String(title || '').split(/\s[-\u2013\u2014|]\s/)[0]?.trim();
  const cleanedAuthor = String(author || '')
    .replace(/\s+-\s+Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim();
  if (titleArtist && titleArtist.length > 1 && titleArtist.length < 50) return titleArtist;
  return cleanedAuthor;
}

function comparableTitle(value) {
  return comparable(String(value || '')
    .replace(/\([^)]*(?:official|video|audio|lyrics?|hd|4k)[^)]*\)/gi, '')
    .replace(/\[[^\]]*(?:official|video|audio|lyrics?|hd|4k)[^\]]*\]/gi, ''));
}

function normalizeTrack(track) {
  const info = track?.info || {};
  const title = String(info.title || '').trim();
  const artist = cleanArtist(info.author, title);
  const identifier = String(info.identifier || '').trim();
  if (!title || !identifier) return null;
  return {
    key: identifier,
    title,
    cleanTitle: title,
    artist,
    author: String(info.author || artist).trim(),
    duration: Number(info.length || info.duration) || 0,
    sourceName: String(info.sourceName || 'youtube'),
    identifier,
  };
}

function lavalinkConfig() {
  const host = process.env.LAVALINK_HOST || 'localhost';
  const port = process.env.LAVALINK_PORT || '2333';
  const password = process.env.LAVALINK_PASSWORD;
  if (!password) throw new Error('LAVALINK_PASSWORD is required');
  return { baseUrl: `http://${host}:${port}`, password };
}

async function load(identifier) {
  const config = lavalinkConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(`${config.baseUrl}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`, {
      headers: { Authorization: config.password },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Lavalink HTTP ${response.status}`);
    const body = await response.json();
    if (body.loadType === 'track') return body.data ? [body.data] : [];
    if (body.loadType === 'playlist') return body.data?.tracks || [];
    if (body.loadType === 'search') return Array.isArray(body.data) ? body.data : [];
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function search(query, limit = 3) {
  try {
    return (await load(`ytsearch:${query}`)).slice(0, limit);
  } catch {
    return [];
  }
}

async function resolveSeed(artist, title) {
  const targetArtist = comparable(artist);
  const targetTitle = comparableTitle(title);
  const tracks = await search(`${artist} ${title}`, 8);
  return tracks
    .map((track) => ({
      track,
      normalized: normalizeTrack(track),
    }))
    .filter((entry) => entry.normalized)
    .map((entry) => {
      const artistValue = comparable(entry.normalized.artist);
      const authorValue = comparable(entry.normalized.author);
      const titleValue = comparableTitle(entry.normalized.title);
      let score = 0;
      if (artistValue === targetArtist) score += 100;
      else if (artistValue.includes(targetArtist) || targetArtist.includes(artistValue)) score += 60;
      if (authorValue.includes(targetArtist)) score += 60;
      if (titleValue.includes(targetTitle) || targetTitle.includes(titleValue)) score += 50;
      return { ...entry, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.track || null;
}

async function radio(identifier, limit = 16) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(identifier || '')) return [];
  try {
    return (await load(`https://www.youtube.com/watch?v=${identifier}&list=RD${identifier}`)).slice(0, limit);
  } catch {
    return [];
  }
}

function makeCandidate(track, source, sourceIndex, distance = null) {
  const normalized = normalizeTrack(track);
  if (!normalized || HARD_REJECT.test(`${normalized.title} ${normalized.author}`)) return null;
  return {
    track,
    normalized,
    source,
    sourceIndex,
    discoveryDistance: distance,
    anchorKeys: new Set(),
    score: source === 'radio' ? 82 : source === 'discovery' ? 76 : 70,
    rejected: false,
    reason: `evaluation:${source}`,
  };
}

function addCandidates(target, tracks, source, distance = null) {
  tracks.forEach((track, index) => {
    const candidate = makeCandidate(track, source, index, distance);
    if (candidate && !target.has(candidate.normalized.key)) target.set(candidate.normalized.key, candidate);
  });
}

async function buildCandidates(context, current, discoveryArtists) {
  const candidates = new Map();
  const [radioTracks, seedSearch, currentSearch] = await Promise.all([
    radio(current.identifier),
    search(`${context.manualSeeds[0].artist} ${context.manualSeeds[0].title} official audio`, 6),
    search(`${current.artist} radio`, 6),
  ]);
  addCandidates(candidates, radioTracks, 'radio');
  addCandidates(candidates, seedSearch, 'search');
  addCandidates(candidates, currentSearch, 'search');

  const discoveryResults = await Promise.all(discoveryArtists.map(async (entry) => ({
    entry,
    tracks: await search(`${entry.name} official audio`, 3),
  })));
  discoveryResults.forEach(({ entry, tracks }) => addCandidates(candidates, tracks, 'discovery', entry.distance));

  const recentKeys = new Set(context.recent.map((track) => track.key));
  const recentSignatures = new Set(context.recent.map((track) => (
    `${comparable(track.artist)}|${comparableTitle(track.cleanTitle || track.title)}`
  )));
  return [...candidates.values()].filter((candidate) => (
    candidate.normalized.key !== current.key
    && !recentKeys.has(candidate.normalized.key)
    && !recentSignatures.has(
      `${comparable(candidate.normalized.artist)}|${comparableTitle(candidate.normalized.cleanTitle || candidate.normalized.title)}`,
    )
  ));
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function maxArtistRun(items) {
  let maximum = 0;
  let current = 0;
  let previous = null;
  items.forEach((item) => {
    const artist = comparable(item.normalized.artist);
    current = artist && artist === previous ? current + 1 : 1;
    previous = artist;
    maximum = Math.max(maximum, current);
  });
  return maximum;
}

async function evaluateSeed(artist, title, steps, delayMs, index) {
  const seed = normalizeTrack(await resolveSeed(artist, title));
  if (!seed) return { seed: `${artist} - ${title}`, error: 'seed not found', picks: [] };

  const guildId = `autoplay-evaluation-${index}`;
  resetGeminiAutoplayState(guildId);
  const picks = [];
  const diagnostics = [];
  let current = seed;

  for (let step = 0; step < steps; step += 1) {
    const context = {
      guildId,
      manualSeeds: [seed],
      activeSeeds: [seed],
      last: current,
      recent: [seed, ...picks.map((pick) => pick.normalized)],
      skipped: [],
    };
    const logger = (level, message) => diagnostics.push({ step: step + 1, level, message });
    const discoveryArtists = await getDiscoveryArtists(context, { logger });
    if (!discoveryArtists.length) {
      diagnostics.push({ step: step + 1, level: 'error', message: 'No discovery artists returned' });
      break;
    }
    const candidates = await buildCandidates(context, current, discoveryArtists);
    const selected = await pickCandidateWithGemini(candidates, context, { logger });
    if (!selected) {
      diagnostics.push({ step: step + 1, level: 'error', message: `No selection from ${candidates.length} candidates` });
      break;
    }
    picks.push(selected);
    current = selected.normalized;
    if (delayMs) await sleep(delayMs);
  }

  const coreKey = comparable(seed.artist);
  return {
    seed: `${seed.artist} - ${seed.title}`,
    picks,
    diagnostics,
    summary: {
      selected: picks.length,
      uniqueArtists: new Set(picks.map((pick) => comparable(pick.normalized.artist))).size,
      exactCoreReturns: picks.filter((pick) => comparable(pick.normalized.artist) === coreKey).length,
      maxArtistRun: maxArtistRun(picks),
      sources: countBy(picks, (pick) => pick.source),
      relationships: countBy(picks, (pick) => pick.aiRelationship),
    },
  };
}

function printResult(result) {
  console.log(`\n${result.seed}`);
  if (result.error) {
    console.log(`  ERROR: ${result.error}`);
    return;
  }
  result.picks.forEach((pick, index) => {
    const distance = pick.discoveryDistance ? `/${pick.discoveryDistance}` : '';
    console.log(
      `  ${index + 1}. ${pick.normalized.artist} - ${pick.normalized.title}`
      + ` [${pick.source}${distance}; ${pick.aiRelationship}; target:${pick.aiOrbitPreference}]`,
    );
  });
  const errors = result.diagnostics.filter((entry) => entry.level === 'warn' || entry.level === 'error');
  errors.forEach((entry) => console.log(`  ! step ${entry.step}: ${entry.message}`));
  console.log(`  Summary: ${JSON.stringify(result.summary)}`);
}

async function main() {
  const steps = readIntegerFlag('--steps', DEFAULT_STEPS, 1, 12);
  const delayMs = readIntegerFlag('--delay', 800, 0, 10_000);
  const start = readIntegerFlag('--start', 0, 0, DEFAULT_SEEDS.length - 1);
  const limit = readIntegerFlag('--seeds', DEFAULT_SEEDS.length - start, 1, DEFAULT_SEEDS.length - start);
  const results = [];

  console.log(`Evaluating ${limit} seeds from index ${start}, ${steps} transitions each...`);
  for (let index = start; index < start + limit; index += 1) {
    const [artist, title] = DEFAULT_SEEDS[index];
    const result = await evaluateSeed(artist, title, steps, delayMs, index);
    results.push(result);
    printResult(result);
  }

  const picks = results.flatMap((result) => result.picks);
  console.log('\nOVERALL');
  console.log(JSON.stringify({
    seeds: results.length,
    selected: picks.length,
    uniqueArtists: new Set(picks.map((pick) => comparable(pick.normalized.artist))).size,
    maxArtistRun: Math.max(0, ...results.map((result) => result.summary?.maxArtistRun || 0)),
    sources: countBy(picks, (pick) => pick.source),
    relationships: countBy(picks, (pick) => pick.aiRelationship),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
