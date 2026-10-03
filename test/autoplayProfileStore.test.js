const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BREAD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-autoplay-profile-'));

const profileStore = require('../src/music/autoplay/profileStore');
const { scoreCandidate } = require('../src/music/autoplay/scoring');
const {
  addManualSeed,
  clearAutoplayState,
  recordAutoplaySkip,
  rebuildProfileFromHistory,
  setAutoplay,
  __testing,
} = require('../src/music/autoplay');
const { recordTrackPlay } = require('../src/state/analyticsStore');
const { closeDatabases } = require('../src/state/sqliteStore');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test.after(() => {
  closeDatabases();
  fs.rmSync(process.env.BREAD_DATA_DIR, { recursive: true, force: true });
});

function track(title, author, identifier) {
  return {
    info: {
      title,
      author,
      identifier,
      uri: `https://www.youtube.com/watch?v=${identifier}`,
      duration: 200_000,
      sourceName: 'youtube',
    },
  };
}

// Simulates a bot restart: everything in memory is dropped and the database is reopened.
function restart() {
  profileStore.flush();
  closeDatabases();
  profileStore.__testing.resetForTesting();
  __testing.forgetSessionCache();
}

function entry(key, artistKey = 'artist') {
  return { key, artistKey, authorKey: artistKey, title: key, author: artistKey };
}

test('session survives a restart and clearSession keeps taste', () => {
  const guildId = 'profile-roundtrip';
  clearAutoplayState(guildId);
  addManualSeed(guildId, track('Seed A', 'Artist A', 'aaaaaaaaaaa'));
  addManualSeed(guildId, track('Seed B', 'Artist B', 'bbbbbbbbbbb'));
  profileStore.toggleLike(guildId, entry('id:liked', 'artist b'));

  restart();

  assert.deepEqual(__testing.getManualSeedPool(guildId).map((seed) => seed.title), ['Seed A', 'Seed B']);
  assert.equal(profileStore.getTrackFeedback(guildId, 'id:liked'), 'like');

  clearAutoplayState(guildId);
  restart();

  assert.deepEqual(__testing.getManualSeedPool(guildId), []);
  assert.equal(profileStore.getTrackFeedback(guildId, 'id:liked'), 'like');
});

test('a stale session is not resumed', () => {
  const guildId = 'profile-stale';
  profileStore.saveSession(guildId, { manualSeeds: [{ title: 'Old', key: 'id:old' }] }, Date.now() - profileStore.SESSION_TTL_MS - 1);
  assert.equal(profileStore.getSession(guildId), null);
});

test('turning autoplay off forgets the session but not skips', () => {
  const guildId = 'profile-off';
  clearAutoplayState(guildId);
  setAutoplay(guildId, true);
  addManualSeed(guildId, track('Seed', 'Artist', 'ccccccccccc'));
  const skipped = { ...track('Skipped', 'Other', 'ddddddddddd'), isAutoplay: true };
  recordAutoplaySkip(guildId, skipped, { position: 3_000 });

  setAutoplay(guildId, false);

  assert.deepEqual(__testing.getManualSeedPool(guildId), []);
  assert.equal(__testing.wasRecentlySkipped(guildId, skipped), true);
});

test('taste lists are pruned by age and capped', () => {
  const guildId = 'profile-prune';
  const now = Date.now();
  profileStore.recordSkip(guildId, entry('id:old-skip'), now - 8 * DAY);
  profileStore.recordSkip(guildId, entry('id:new-skip'), now - DAY);
  profileStore.recordPlayed(guildId, entry('id:old-play'), now - 4 * DAY);
  for (let index = 0; index < profileStore.TASTE_LIMITS.played.max + 5; index += 1) {
    profileStore.recordPlayed(guildId, entry(`id:play-${index}`), now);
  }

  const taste = profileStore.getTaste(guildId, now);
  assert.deepEqual(taste.skips.map((item) => item.key), ['id:new-skip']);
  assert.equal(taste.played.length, profileStore.TASTE_LIMITS.played.max);
  assert.ok(!taste.played.some((item) => item.key === 'id:old-play'));
});

test('like toggles and a dislike replaces a like', () => {
  const guildId = 'profile-feedback';
  assert.equal(profileStore.toggleLike(guildId, entry('id:x')), true);
  assert.equal(profileStore.getTrackFeedback(guildId, 'id:x'), 'like');
  assert.equal(profileStore.toggleLike(guildId, entry('id:x')), false);
  assert.equal(profileStore.getTrackFeedback(guildId, 'id:x'), null);

  profileStore.toggleLike(guildId, entry('id:x'));
  profileStore.recordDislike(guildId, entry('id:x'));
  assert.equal(profileStore.getTrackFeedback(guildId, 'id:x'), 'dislike');
  assert.equal(profileStore.toggleLike(guildId, entry('id:x')), true);
  assert.equal(profileStore.getTrackFeedback(guildId, 'id:x'), 'like');
});

function candidate(key, artist, source = 'search') {
  const artistKey = artist.toLowerCase();
  return {
    track: { info: { identifier: key, title: `${key} song`, author: artist, duration: 180_000 } },
    normalized: {
      key,
      title: `${key} song`,
      cleanTitle: `${key} song`,
      artist: artistKey,
      artistKey,
      author: artist,
      authorKey: artistKey,
      duration: 180_000,
    },
    source,
    sourceIndex: 0,
    anchorKeys: new Set(),
    anchorRank: 0,
  };
}

function context(taste = {}, skipped = []) {
  const now = Date.now();
  return {
    manualSeeds: [],
    activeSeeds: [],
    recent: [],
    skipped,
    seedArtist: 'seed',
    taste: {
      now,
      likedKeys: new Set(),
      likedArtists: new Set(),
      dislikedKeys: new Set(),
      dislikedArtistCounts: new Map(),
      played: new Map(),
      ...taste,
    },
  };
}

test('disliked tracks and twice-disliked artists are rejected', () => {
  assert.equal(scoreCandidate(candidate('k1', 'Band'), context({ dislikedKeys: new Set(['k1']) })).reason, 'disliked');
  assert.equal(
    scoreCandidate(candidate('k2', 'Band'), context({ dislikedArtistCounts: new Map([['band', 2]]) })).reason,
    'disliked artist',
  );

  const base = scoreCandidate(candidate('k3', 'Band'), context()).score;
  const once = scoreCandidate(candidate('k3', 'Band'), context({ dislikedArtistCounts: new Map([['band', 1]]) })).score;
  assert.equal(base - once, 30);
});

test('recently played tracks are rejected and older plays lower the score', () => {
  const now = Date.now();
  const recent = scoreCandidate(candidate('k1', 'Band'), context({ now, played: new Map([['k1', now - HOUR]]) }));
  assert.equal(recent.reason, 'played recently');

  const base = scoreCandidate(candidate('k1', 'Band'), context({ now })).score;
  const older = scoreCandidate(candidate('k1', 'Band'), context({ now, played: new Map([['k1', now - DAY]]) }));
  assert.equal(older.rejected, false);
  assert.equal(base - older.score, 18);
});

test('liked artists get a bonus', () => {
  const base = scoreCandidate(candidate('k1', 'Band'), context()).score;
  const liked = scoreCandidate(candidate('k1', 'Band'), context({ likedArtists: new Set(['band']) })).score;
  assert.equal(liked - base, 10);
});

test('skip feedback fades with age', () => {
  const skip = (weight, strength = 'strong') => ({ key: 'k1', artistKey: 'band', authorKey: 'band', strength, weight });

  assert.equal(scoreCandidate(candidate('k1', 'Band'), context({}, [skip(1)])).reason, 'recently skipped');
  assert.equal(scoreCandidate(candidate('k1', 'Band'), context({}, [skip(0.5)])).reason, 'recently skipped');

  const old = scoreCandidate(candidate('k1', 'Band'), context({}, [skip(0.25)]));
  assert.equal(old.rejected, false, old.reason);

  // One strong channel skip rejects today, but only lowers the score a day later.
  const otherTrack = (weight) => scoreCandidate(candidate('k2', 'Band'), context({}, [skip(weight)]));
  assert.equal(otherTrack(1).reason, 'recently skipped channel');
  assert.equal(otherTrack(0.25).rejected, false);
});

test('rebuild seeds the session from manual history and likes', () => {
  const guildId = 'profile-rebuild';
  clearAutoplayState(guildId);

  recordTrackPlay(guildId, track('Old Manual', 'Artist A', 'mmmmmmmmmm1'));
  recordTrackPlay(guildId, { ...track('Autoplayed', 'Artist B', 'aaaaaaaaaa2'), isAutoplay: true });
  recordTrackPlay(guildId, track('New Manual', 'Artist C', 'mmmmmmmmmm3'));
  recordTrackPlay(guildId, track('New Manual', 'Artist C', 'mmmmmmmmmm3'));
  profileStore.toggleLike(guildId, {
    ...entry('id:likedlike1', 'liked artist'),
    title: 'Liked',
    author: 'Liked Artist',
    identifier: 'likedlike1',
    duration: 200_000,
  });

  const result = rebuildProfileFromHistory(guildId);

  const titles = __testing.getManualSeedPool(guildId).map((seed) => seed.title);
  assert.equal(result.seeds, 3);
  assert.deepEqual(titles, ['Liked', 'Old Manual', 'New Manual']);
});
