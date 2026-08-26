const test = require('node:test');
const assert = require('node:assert/strict');

const { getDiscoveryArtists, getGeminiStatus, getGenreRadioPlan, pickCandidateWithGemini, __testing } = require('../src/music/autoplayAi');

function candidate(key, title, artist, score = 60) {
  return {
    track: { info: { title } },
    normalized: {
      key,
      title,
      cleanTitle: title,
      artist,
      author: artist,
      duration: 180_000,
      sourceName: 'youtube',
    },
    source: 'search',
    sourceIndex: 0,
    anchorKeys: new Set(),
    score,
    rejected: false,
    reason: 'ok',
  };
}

function context() {
  const seed = {
    key: 'seed',
    title: 'Seed Song',
    cleanTitle: 'Seed Song',
    artist: 'Seed Artist',
    author: 'Seed Artist',
    duration: 190_000,
    sourceName: 'youtube',
  };
  return {
    guildId: 'test-guild',
    manualSeeds: [seed],
    activeSeeds: [seed],
    last: seed,
    recent: [],
    skipped: [],
  };
}

function geminiResponse(ranking) {
  const normalizedRanking = ranking.map((entry) => ({
    relationship: 'discovery',
    ...entry,
  }));
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        candidates: [{ content: { parts: [{ text: JSON.stringify({ ranking: normalizedRanking, confidence: 0.9 }) }] } }],
      };
    },
  };
}

function discoveryResponse(artists) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        candidates: [{ content: { parts: [{ text: JSON.stringify({ artists }) }] } }],
      };
    },
  };
}

test.beforeEach(() => __testing.resetForTests());

test('Gemini ranks eligible candidates and returns one from its leading pool', async () => {
  const candidates = [
    candidate('a', 'First Track', 'Artist A'),
    candidate('b', 'Second Track', 'Artist B'),
  ];
  const fetchImpl = async (_url, request) => {
    assert.equal(request.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(request.body);
    assert.equal(body.contents[0].parts[0].text.includes('test-key'), false);
    return geminiResponse([
      { id: 'c2', score: 95, reason: 'best continuation' },
      { id: 'c1', score: 70, reason: 'weaker match' },
    ]);
  };

  const selected = await pickCandidateWithGemini(candidates, context(), {
    apiKey: 'test-key',
    fetchImpl,
    random: () => 0,
  });

  assert.equal(selected.normalized.key, 'b');
  assert.equal(selected.aiScore, 95);
});

test('Gemini ranking is cached for an unchanged listening context', async () => {
  let requests = 0;
  const candidates = [
    candidate('a', 'First Track', 'Artist A'),
    candidate('b', 'Second Track', 'Artist B'),
  ];
  const fetchImpl = async () => {
    requests += 1;
    return geminiResponse([
      { id: 'c1', score: 95, reason: 'best continuation' },
      { id: 'c2', score: 80, reason: 'alternative' },
    ]);
  };
  const options = { apiKey: 'test-key', fetchImpl, random: () => 0 };

  const first = await pickCandidateWithGemini(candidates, context(), options);
  const second = await pickCandidateWithGemini(candidates, context(), options);

  assert.equal(requests, 1);
  assert.equal(first.aiCached, false);
  assert.equal(second.aiCached, true);
});

test('Gemini ignores unknown and duplicate candidate IDs', () => {
  const candidates = [candidate('a', 'First Track', 'Artist A')];
  const { eligible } = __testing.buildSelectionPayload(candidates, context(), 16);
  const ranking = __testing.validateRanking([
    { id: 'missing', score: 100, reason: 'invalid', relationship: 'discovery' },
    { id: 'c1', score: 90, reason: 'valid', relationship: 'discovery' },
    { id: 'c1', score: 80, reason: 'duplicate', relationship: 'discovery' },
  ], eligible);

  assert.deepEqual(ranking, [{ id: 'c1', score: 90, reason: 'valid', relationship: 'discovery' }]);
});

test('single-core sessions explore several tracks before returning to the core side', async () => {
  let requests = 0;
  const candidates = [
    candidate('core', 'Another Seed Song', 'Seed Artist'),
    candidate('new', 'A Genuine Discovery', 'Different Artist'),
  ];
  const fetchImpl = async () => {
    requests += 1;
    return geminiResponse([
      { id: 'c1', score: 98, reason: 'strong core continuation', relationship: 'core' },
      { id: 'c2', score: 90, reason: 'credible separate artist', relationship: 'discovery' },
    ]);
  };
  const options = { apiKey: 'test-key', fetchImpl, random: () => 0 };

  const first = await pickCandidateWithGemini(candidates, context(), options);
  const second = await pickCandidateWithGemini(candidates, context(), options);
  const third = await pickCandidateWithGemini(candidates, context(), options);
  const fourth = await pickCandidateWithGemini(candidates, context(), options);

  assert.equal(requests, 1);
  assert.equal(first.normalized.key, 'new');
  assert.equal(first.aiRelationship, 'discovery');
  assert.equal(second.normalized.key, 'new');
  assert.equal(third.normalized.key, 'new');
  assert.equal(fourth.normalized.key, 'core');
  assert.equal(fourth.aiRelationship, 'core');
});

test('Gemini can reconsider finite candidates below the local score threshold', () => {
  const lowScore = candidate('a', 'Risky Discovery', 'Artist A', 20);
  lowScore.rejected = true;
  lowScore.reason = 'low score';

  const { eligible, payload } = __testing.buildSelectionPayload([lowScore], context(), 16);

  assert.equal(eligible.length, 1);
  assert.equal(payload.candidates[0].title, 'Risky Discovery');
});

test('Gemini receives core artist continuity metadata for a larger candidate pool', () => {
  const seedContext = context();
  seedContext.recent = [
    seedContext.manualSeeds[0],
    { ...seedContext.manualSeeds[0], artist: 'Related Artist', author: 'Related Artist' },
  ];
  const candidates = Array.from({ length: 30 }, (_, index) => candidate(
    `track-${index}`,
    `Track ${index}`,
    index === 20 ? 'Seed Artist' : `Artist ${index}`,
    100 - index,
  ));

  const { eligible, payload } = __testing.buildSelectionPayload(candidates, seedContext, 24);

  assert.equal(eligible.length, 24);
  assert.deepEqual(payload.coreArtists, ['Seed Artist']);
  assert.match(payload.discoveryTarget, /explore 3-5 non-core tracks/);
  assert.deepEqual(payload.recentCorePattern.map((entry) => entry.coreArtist), [true, false]);
  assert.equal(payload.candidates.some((entry) => entry.artist === 'Seed Artist' && entry.coreArtist), true);
});

test('Gemini receives a stratified candidate set instead of only the highest local scores', () => {
  const candidates = [];
  for (let index = 0; index < 16; index += 1) {
    const entry = candidate(`radio-${index}`, `Radio ${index}`, 'Repeated Radio Artist', 200 - index);
    entry.source = 'radio';
    candidates.push(entry);
  }
  for (let index = 0; index < 12; index += 1) {
    const entry = candidate(`discovery-${index}`, `Discovery ${index}`, `Discovery Artist ${index}`, 80 - index);
    entry.source = 'discovery';
    entry.discoveryDistance = index < 4 ? 'close' : index < 8 ? 'medium' : 'broad';
    candidates.push(entry);
  }
  for (let index = 0; index < 10; index += 1) {
    candidates.push(candidate(`search-${index}`, `Search ${index}`, `Search Artist ${index}`, 100 - index));
  }

  const { payload } = __testing.buildSelectionPayload(candidates, context(), 24);
  const artistCounts = new Map();
  payload.candidates.forEach((entry) => {
    artistCounts.set(entry.artist, (artistCounts.get(entry.artist) || 0) + 1);
  });

  assert.ok(payload.candidates.filter((entry) => entry.discoveredBy === 'discovery').length >= 10);
  assert.ok(Math.max(...artistCounts.values()) <= 2);
});

test('Gemini plans fresh close, medium, and broad artists on every track', async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return discoveryResponse([
      { name: 'Seed Artist', distance: 'close' },
      { name: 'Close One', distance: 'close' },
      { name: 'Close Two', distance: 'close' },
      { name: 'Medium One', distance: 'medium' },
      { name: 'Medium Two', distance: 'medium' },
      { name: 'Broad One', distance: 'broad' },
      { name: 'Broad Two', distance: 'broad' },
    ]);
  };
  const options = { apiKey: 'test-key', fetchImpl };

  const first = await getDiscoveryArtists(context(), options);
  const second = await getDiscoveryArtists(context(), options);

  assert.equal(requests, 2);
  assert.equal(first.length, 6);
  assert.deepEqual(first, second);
  assert.equal(first.some((entry) => entry.name === 'Seed Artist'), false);
  assert.deepEqual(new Set(first.map((entry) => entry.distance)), new Set(['close', 'medium', 'broad']));
});

test('Gemini failure returns null so the local selector can take over', async () => {
  const messages = [];
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return { ok: false, status: 429 };
  };
  const candidates = [
    candidate('a', 'First Track', 'Artist A'),
    candidate('b', 'Second Track', 'Artist B'),
  ];
  const selected = await pickCandidateWithGemini([
    ...candidates,
  ], context(), {
    apiKey: 'test-key',
    fetchImpl,
    logger: (level, message) => messages.push({ level, message }),
  });
  const blockedRetry = await pickCandidateWithGemini(candidates, context(), {
    apiKey: 'test-key',
    fetchImpl,
  });

  assert.equal(selected, null);
  assert.equal(blockedRetry, null);
  assert.equal(requests, 1);
  assert.equal(messages[0].level, 'warn');
  assert.match(messages[0].message, /local fallback/);
  assert.equal(getGeminiStatus().healthy, false);
  assert.equal(getGeminiStatus().consecutiveFailures, 1);
});

test('Gemini health recovers only after a successful provider response', async () => {
  const candidates = [
    candidate('a', 'First Track', 'Artist A'),
    candidate('b', 'Second Track', 'Artist B'),
  ];
  const failedAt = 1_000;
  await pickCandidateWithGemini(candidates, context(), {
    apiKey: 'test-key',
    now: () => failedAt,
    fetchImpl: async () => { throw new Error('network down'); },
  });

  assert.equal(getGeminiStatus(failedAt + 30_000).circuitOpen, false);
  assert.equal(getGeminiStatus(failedAt + 30_000).healthy, false);

  await pickCandidateWithGemini(candidates, context(), {
    apiKey: 'test-key',
    now: () => failedAt + 30_000,
    fetchImpl: async () => geminiResponse([
      { id: 'c1', score: 90, reason: 'recovered' },
      { id: 'c2', score: 70, reason: 'alternative' },
    ]),
  });

  assert.equal(getGeminiStatus(failedAt + 30_000).healthy, true);
  assert.equal(getGeminiStatus(failedAt + 30_000).consecutiveFailures, 0);
});

test('Gemini selector stays disabled when no API key is configured', async () => {
  let called = false;
  const selected = await pickCandidateWithGemini([
    candidate('a', 'First Track', 'Artist A'),
    candidate('b', 'Second Track', 'Artist B'),
  ], context(), {
    apiKey: '',
    fetchImpl: async () => {
      called = true;
      return geminiResponse([]);
    },
  });

  assert.equal(selected, null);
  assert.equal(called, false);
});

function genreRadioResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      };
    },
  };
}

test('genre radio plan stays scene-locked and excludes core artists', async () => {
  let capturedBody = '';
  const fetchImpl = async (_url, request) => {
    capturedBody = request.body;
    return genreRadioResponse({
      genre: 'Polish hip-hop',
      artists: [
        { name: 'Seed Artist', distance: 'close' },
        { name: 'Scene One', distance: 'close' },
        { name: 'Scene Two', distance: 'close' },
        { name: 'City One', distance: 'medium' },
        { name: 'City Two', distance: 'medium' },
        { name: 'Adjacent One', distance: 'broad' },
      ],
    });
  };

  const artists = await getGenreRadioPlan(context(), { apiKey: 'test-key', fetchImpl });

  const request = JSON.parse(capturedBody);
  const payload = JSON.parse(request.contents[0].parts[0].text);
  assert.match(String(payload.task), /genre-locked/);
  assert.equal(artists.length, 5);
  assert.equal(artists.some((entry) => entry.name === 'Seed Artist'), false);
});

test('genre radio payload carries recent plays and rejected artists', () => {
  const radioContext = context();
  radioContext.recent = [
    { ...radioContext.manualSeeds[0], artist: 'Recent Artist', author: 'Recent Artist', title: 'Recent Song' },
  ];
  radioContext.skipped = [
    { ...radioContext.manualSeeds[0], artist: 'Rejected Artist', author: 'Rejected Artist', title: 'Rejected Song' },
  ];

  const payload = __testing.buildGenreRadioPayload(radioContext);

  assert.deepEqual(payload.coreArtists, ['Seed Artist']);
  assert.equal(payload.recentlyPlayedTracks.length, 1);
  assert.deepEqual(payload.recentlyRejectedArtists, ['Rejected Artist']);
  assert.match(payload.task, /without repeating/);
});

test('genre radio failure returns an empty plan and trips the breaker', async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return { ok: false, status: 429 };
  };
  const options = { apiKey: 'test-key', fetchImpl };

  const first = await getGenreRadioPlan(context(), options);
  const second = await getGenreRadioPlan(context(), options);

  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
  assert.equal(requests, 1);
});
