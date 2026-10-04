const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BREAD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-autoplay-profile-'));

const profileStore = require('../src/music/autoplay/profileStore');
const userTaste = require('../src/music/autoplay/userTaste');
const library = require('../src/music/library');
const { scoreCandidate } = require('../src/music/autoplay/scoring');
const {
  addManualSeed,
  clearAutoplayState,
  getListenerIds,
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
    encoded: `encoded-${identifier}`,
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
  userTaste.flush();
  closeDatabases();
  profileStore.__testing.resetForTesting();
  userTaste.__testing.resetForTesting();
  __testing.forgetSessionCache();
}

function entry(key, artistKey = 'artist') {
  return { key, artistKey, authorKey: artistKey, title: key, author: artistKey };
}

test('session survives a restart and clearSession forgets it', () => {
  const guildId = 'profile-roundtrip';
  clearAutoplayState(guildId);
  addManualSeed(guildId, track('Seed A', 'Artist A', 'aaaaaaaaaaa'));
  addManualSeed(guildId, track('Seed B', 'Artist B', 'bbbbbbbbbbb'));

  restart();

  assert.deepEqual(__testing.getManualSeedPool(guildId).map((seed) => seed.title), ['Seed A', 'Seed B']);

  clearAutoplayState(guildId);
  restart();

  assert.deepEqual(__testing.getManualSeedPool(guildId), []);
});

test('a stale session is not resumed', () => {
  const guildId = 'profile-stale';
  profileStore.saveSession(guildId, { manualSeeds: [{ title: 'Old', key: 'id:old' }] }, Date.now() - profileStore.SESSION_TTL_MS - 1);
  assert.equal(profileStore.getSession(guildId), null);
});

test('old server-wide likes and dislikes are dropped', () => {
  const guildId = 'profile-legacy';
  profileStore.recordSkip(guildId, entry('id:skip'));
  const taste = profileStore.getTaste(guildId);
  taste.likes = [entry('id:legacy-like')];
  taste.dislikes = [entry('id:legacy-dislike')];

  restart();

  const reloaded = profileStore.getTaste(guildId);
  assert.equal(reloaded.likes, undefined);
  assert.equal(reloaded.dislikes, undefined);
  assert.deepEqual(reloaded.skips.map((item) => item.key), ['id:skip']);
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

test('dislikes belong to one person, survive a restart and expire', () => {
  const now = Date.now();
  userTaste.recordDislike('user-a', entry('id:x'), now);
  userTaste.recordDislike('user-a', entry('id:old'), now - userTaste.DISLIKE_LIMITS.ttl - 1);

  restart();

  assert.equal(userTaste.isDisliked('user-a', 'id:x', now), true);
  assert.equal(userTaste.isDisliked('user-b', 'id:x', now), false);
  assert.equal(userTaste.isDisliked('user-a', 'id:old', now), false);
  assert.equal(userTaste.removeDislike('user-a', 'id:x'), true);
  assert.equal(userTaste.isDisliked('user-a', 'id:x', now), false);
});

test('liking a track takes back the dislike', () => {
  const song = track('Song', 'Band', 'likedislike');
  const { key } = library.libraryEntry(song);
  userTaste.recordDislike('user-c', { key, artistKey: 'band' });
  library.setLiked('user-c', song, true);
  assert.equal(userTaste.isDisliked('user-c', key), false);
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
      likedArtistCounts: new Map(),
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

test('liked artists get a bonus per listener, capped at three', () => {
  const score = (count) => scoreCandidate(candidate('k1', 'Band'), context({ likedArtistCounts: new Map([['band', count]]) })).score;
  const base = scoreCandidate(candidate('k1', 'Band'), context()).score;
  assert.equal(score(1) - base, 10);
  assert.equal(score(2) - base, 20);
  assert.equal(score(5) - base, 30);
});

test('taste merges only the listeners present', () => {
  const now = Date.now();
  const katy = (id) => track(`Katy ${id}`, 'Katy Perry', `katyperry0${id}`);
  library.setLiked('fan', katy(1), true);
  library.setLiked('fan', katy(2), true);
  library.setLiked('fan-2', katy(3), true);
  const [first, second] = [katy(1), katy(2)].map((song) => library.libraryEntry(song).key);
  userTaste.recordDislike('hater', { key: first, artistKey: 'katy perry' }, now);
  userTaste.recordDislike('hater-2', { key: second, artistKey: 'katy perry' }, now);
  const played = { played: [] };

  const fanOnly = __testing.buildTasteContext(played, now, ['fan']);
  assert.equal(fanOnly.dislikedKeys.size, 0);
  assert.equal(fanOnly.likedArtistCounts.get('katy perry'), 1);

  const fans = __testing.buildTasteContext(played, now, ['fan', 'fan-2', 'fan']);
  assert.equal(fans.likedArtistCounts.get('katy perry'), 2);

  // Two people disliking one song each is not the same as one person disliking the artist twice.
  const haters = __testing.buildTasteContext(played, now, ['fan', 'hater', 'hater-2']);
  assert.deepEqual([...haters.dislikedKeys].sort(), [first, second].sort());
  assert.equal(haters.dislikedArtistCounts.get('katy perry'), 1);

  userTaste.recordDislike('hater', { key: 'id:another', artistKey: 'katy perry' }, now);
  assert.equal(__testing.buildTasteContext(played, now, ['hater']).dislikedArtistCounts.get('katy perry'), 2);
});

test('listeners are the people in the voice channel, not bots or the deafened', () => {
  const member = (id, extra = {}) => [id, { id, user: { bot: false }, voice: {}, ...extra }];
  const members = new Map([
    member('a'),
    member('bot', { user: { bot: true } }),
    member('deaf', { voice: { selfDeaf: true } }),
    member('b'),
  ]);
  const client = { guilds: { cache: new Map([['g', { channels: { cache: new Map([['vc', { members }]]) } }]]) } };

  assert.deepEqual(getListenerIds({ guildId: 'g', voiceChannelId: 'vc' }, client), ['a', 'b']);
  assert.deepEqual(getListenerIds({ guildId: 'g', voiceChannelId: 'missing' }, client), []);
});

test('rebuild seeds the session from manual history and the listeners\' likes', () => {
  const guildId = 'profile-rebuild';
  clearAutoplayState(guildId);

  recordTrackPlay(guildId, track('Old Manual', 'Artist A', 'mmmmmmmmmm1'));
  recordTrackPlay(guildId, { ...track('Autoplayed', 'Artist B', 'aaaaaaaaaa2'), isAutoplay: true });
  recordTrackPlay(guildId, track('New Manual', 'Artist C', 'mmmmmmmmmm3'));
  recordTrackPlay(guildId, track('New Manual', 'Artist C', 'mmmmmmmmmm3'));
  library.setLiked('rebuild-listener', track('Liked', 'Liked Artist', 'likedlike01'), true);
  library.setLiked('rebuild-absent', track('Absent', 'Other Artist', 'absentlike1'), true);

  const result = rebuildProfileFromHistory(guildId, ['rebuild-listener']);

  const titles = __testing.getManualSeedPool(guildId).map((seed) => seed.title);
  assert.equal(result.seeds, 3);
  assert.deepEqual(titles, ['Liked', 'Old Manual', 'New Manual']);
});
