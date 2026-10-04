const test = require('node:test');
const assert = require('node:assert/strict');

const { isSafeArtworkUrl, fetchArtwork } = require('../src/stats/artwork');
const { buildCustomId, loadModel, parseCustomId, VIEW_KEYS } = require('../src/stats/panel');
const { buildView } = require('../src/stats/views');

const emptyDetails = {
  estimatedDuration: 0,
  autoplayPlays: 0,
  activeDays: 0,
  averagePerActiveDay: 0,
  longestStreakDays: 0,
  mostActiveHour: null,
  hourCounts: Array(24).fill(0),
  weekdayCounts: Array(7).fill(0),
  timeZone: 'UTC',
  topSources: [],
  topArtists: [],
  retainedEventCount: 0,
  historyScoped: true,
};

function fakeData(overrides = {}) {
  return {
    getGuildInsights: () => ({
      summary: { totalPlays: 0, uniqueTracks: 0, uniqueUsers: 0 },
      topTracks: [],
      topUsers: [],
      details: emptyDetails,
      trend14d: [],
      detailedHistoryDays: 35,
    }),
    getUserInsights: () => ({ totalRequests: 0, topTracks: [], details: emptyDetails, trend14d: [], detailedHistoryDays: 35 }),
    getOriginInsights: () => ({ total: 0, tracked: 0, untracked: 0, origins: [], platforms: [], detailedHistoryDays: 35 }),
    getArcadeStats: () => ({ games: 0, wins: 0, losses: 0, draws: 0, totalWagered: 0, totalPayout: 0, biggestPayout: 0, byGame: {} }),
    getGuildArcadeStats: () => ({ games: 0, wins: 0, losses: 0, draws: 0, totalWagered: 0, totalPayout: 0, biggestPayout: 0, byGame: {}, players: [], playerCount: 0 }),
    attachArtwork: async (tracks) => tracks.map((track) => ({ ...track, art: null })),
    ...overrides,
  };
}

const guild = { name: 'Bread & <Co>', members: { cache: new Map(), fetch: async () => null } };
const member = { user: { id: 'u1', username: 'crumb' }, member: { displayName: 'Crumb' } };

test('customIds round-trip and reject foreign shapes', () => {
  const state = { ownerId: '111', targetId: null, view: 'rhythm', range: '7d' };
  assert.deepEqual(parseCustomId(buildCustomId('view', state)), { action: 'view', ownerId: '111', targetId: null, view: null, range: '7d' });
  assert.deepEqual(
    parseCustomId(buildCustomId('range', { ...state, targetId: '222' })),
    { action: 'range', ownerId: '111', targetId: '222', view: 'rhythm', range: '7d' },
  );
  assert.equal(parseCustomId('stats:bogus:1'), null);
  assert.equal(parseCustomId('stats:range:1:-:nope:forever').view, 'overview');
  assert.ok(buildCustomId('range', { ownerId: '1'.repeat(20), targetId: '2'.repeat(20), view: 'overview', range: '24h' }).length <= 100);
});

test('every view renders empty server and member data without crashing', async () => {
  for (const view of VIEW_KEYS) {
    for (const target of [null, member]) {
      const model = await loadModel({ guild, guildId: 'g', target, view, range: 'all', getBalance: () => 42, data: fakeData() });
      const { svg, text } = buildView(view, model);
      assert.match(svg, /^<svg/);
      assert.doesNotMatch(svg, /undefined|NaN/, `${view} ${target ? 'member' : 'server'}`);
      assert.ok(text.length > 0);
      assert.match(svg, target ? /Crumb/ : /Bread &amp; &lt;Co&gt;/);
    }
  }
});

test('top view shows tracks, artists and resolved requester names', async () => {
  const data = fakeData({
    getGuildInsights: () => ({
      summary: { totalPlays: 12, uniqueTracks: 2, uniqueUsers: 1 },
      topTracks: [{ title: 'Song <One>', author: 'Band', count: 7, artwork: null }],
      topUsers: [{ userId: 'u1', displayName: 'Stored name', count: 12 }],
      details: { ...emptyDetails, topArtists: [{ rank: 1, name: 'Band', count: 7 }] },
      trend14d: [],
      detailedHistoryDays: 35,
    }),
  });
  const named = { name: 'G', members: { cache: new Map([['u1', { displayName: 'Live name' }]]) } };
  const model = await loadModel({ guild: named, guildId: 'g', target: null, view: 'top', range: '7d', data });
  const { svg } = buildView('top', model);
  assert.match(svg, /Song &lt;One&gt;/);
  assert.match(svg, /Live name/);
  assert.match(svg, /TOP REQUESTERS/);
});

test('rhythm view highlights the peak hour and names the time zone', async () => {
  const hourCounts = Array(24).fill(0);
  hourCounts[21] = 5;
  const weekdayCounts = [0, 0, 0, 0, 5, 0, 0];
  const data = fakeData({
    getGuildInsights: () => ({
      summary: { totalPlays: 5, uniqueTracks: 1, uniqueUsers: 1 },
      topTracks: [],
      topUsers: [],
      details: { ...emptyDetails, hourCounts, weekdayCounts, mostActiveHour: 21, activeDays: 1, averagePerActiveDay: 5, timeZone: 'Europe/Warsaw' },
      trend14d: [],
      detailedHistoryDays: 35,
    }),
  });
  const { svg, text } = buildView('rhythm', await loadModel({ guild, guildId: 'g', target: null, view: 'rhythm', range: '7d', data }));
  assert.match(svg, /21:00/);
  assert.match(svg, />Fri</);
  assert.match(svg, /EUROPE\/WARSAW/);
  assert.match(text, /Europe\/Warsaw/);
});

test('server arcade view ranks players by name', async () => {
  const data = fakeData({
    getGuildArcadeStats: () => ({
      games: 4, wins: 2, losses: 2, draws: 0, totalWagered: 40, totalPayout: 90, biggestPayout: 60,
      byGame: { slots: { games: 4, wins: 2 } },
      players: [{ userId: 'u1', games: 4, wins: 2, totalWagered: 40, totalPayout: 90 }],
      playerCount: 1,
    }),
  });
  const named = { name: 'G', members: { cache: new Map([['u1', { displayName: 'Lucky' }]]) } };
  const { svg } = buildView('arcade', await loadModel({ guild: named, guildId: 'g', target: null, view: 'arcade', range: 'all', data }));
  assert.match(svg, /1\. Lucky/);
  assert.match(svg, /\+50/);
  assert.match(svg, /Slots/);
});

test('artwork fetch only allows public https hosts', async () => {
  assert.equal(isSafeArtworkUrl('https://i.ytimg.com/vi/x/hqdefault.jpg'), true);
  assert.equal(isSafeArtworkUrl('http://i.ytimg.com/x.jpg'), false);
  assert.equal(isSafeArtworkUrl('https://127.0.0.1/x.jpg'), false);
  assert.equal(isSafeArtworkUrl('https://[::1]/x.jpg'), false);
  assert.equal(isSafeArtworkUrl('https://localhost/x.jpg'), false);
  assert.equal(isSafeArtworkUrl('not a url'), false);
  let called = false;
  assert.equal(await fetchArtwork('https://10.0.0.1/x.jpg', { fetchImpl: async () => { called = true; } }), null);
  assert.equal(called, false);
  assert.equal(await fetchArtwork('https://cdn.example.com/broken.jpg', { fetchImpl: async () => { throw new Error('boom'); } }), null);
});
