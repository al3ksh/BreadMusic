const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESPONSE_SCHEMA,
  SAFETY_SETTINGS,
  collectTasteHints,
  createDmPersona,
  getDmPersonaStatus,
  getVoiceContext,
  sanitizePersonaOutput,
  validatePersonaPicks,
} = require('../src/utils/dmPersona');
const { getGeminiStatus } = require('../src/music/autoplayAi');

function geminiJsonResponse(payload, extra = {}) {
  const text = typeof payload === 'string'
    ? payload
    : payload == null
      ? null
      : JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        candidates: [
          {
            finishReason: extra.finishReason ?? 'STOP',
            content: { parts: text == null ? [] : [{ text }] },
          },
        ],
        ...(extra.promptFeedback ? { promptFeedback: extra.promptFeedback } : {}),
      };
    },
  };
}

test('createDmPersona sends structured JSON Gemini request with header, safetySettings, responseSchema, and nowPlaying', async () => {
  let capturedUrl = '';
  let capturedRequest = null;

  const persona = createDmPersona({
    apiKey: 'dm-secret-key',
    model: 'models/gemini-3.5-flash-lite',
    fetchImpl: async (url, request) => {
      capturedUrl = url;
      capturedRequest = request;
      return geminiJsonResponse({
        reply: 'Run /help in a server, I am just a loaf.',
        picks: [{ title: 'Harder, Better, Faster, Stronger', artist: 'Daft Punk' }],
      });
    },
  });

  const longMessage = `recommend something ${'x'.repeat(600)}`;
  const nowPlaying = {
    guildName: 'Bread HQ',
    channelName: 'Kitchen VC',
    currentTrack: 'One More Time - Daft Punk',
    queueLength: 4,
    listeners: 3,
    paused: false,
  };
  const reply = await persona.reply({
    text: longMessage,
    userName: 'Baker',
    tasteHints: ['Numb - Linkin Park', 'One More Time - Daft Punk'],
    nowPlaying,
  });

  assert.deepEqual(reply, {
    text: 'Run /help in a server, I am just a loaf.',
    picks: [{ title: 'Harder, Better, Faster, Stronger', artist: 'Daft Punk' }],
  });
  assert.equal(
    capturedUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
  );
  assert.equal(capturedRequest.method, 'POST');
  assert.equal(capturedRequest.headers['x-goog-api-key'], 'dm-secret-key');
  assert.equal(capturedRequest.headers['Content-Type'], 'application/json');

  const body = JSON.parse(capturedRequest.body);
  assert.equal(typeof body.systemInstruction?.parts?.[0]?.text, 'string');
  assert.match(body.systemInstruction.parts[0].text, /loaf of bread/i);
  assert.match(body.systemInstruction.parts[0].text, /nowPlaying/);
  assert.deepEqual(body.safetySettings, SAFETY_SETTINGS);
  assert.equal(body.generationConfig.temperature, 0.9);
  assert.equal(body.generationConfig.maxOutputTokens, 300);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseSchema, RESPONSE_SCHEMA);

  const userPayload = JSON.parse(body.contents[0].parts[0].text);
  assert.equal(userPayload.userName, 'Baker');
  assert.equal(userPayload.message.length, 500);
  assert.equal(userPayload.message, longMessage.slice(0, 500));
  assert.deepEqual(userPayload.recentRequests, ['Numb - Linkin Park', 'One More Time - Daft Punk']);
  assert.deepEqual(userPayload.nowPlaying, nowPlaying);
});

test('sanitizePersonaOutput strips mentions, replaces em dashes, rejects URLs, and caps at a word boundary', () => {
  assert.equal(
    sanitizePersonaOutput('  Hey @everyone @here <@12345> <@!67890> <#111> <@&222> nice try — use /help in a server.  '),
    'Hey nice try, use /help in a server.',
  );

  assert.equal(sanitizePersonaOutput('Visit https://example.com for more'), null);
  assert.equal(sanitizePersonaOutput('Check http://example.com now'), null);
  assert.equal(sanitizePersonaOutput('Go to www.example.com please'), null);
  assert.equal(sanitizePersonaOutput('Join discord.gg/breadserver'), null);
  assert.equal(sanitizePersonaOutput('   '), null);
  assert.equal(sanitizePersonaOutput('<@123> @everyone'), null);

  const words = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
  const capped = sanitizePersonaOutput(words);
  assert.ok(capped);
  assert.ok(capped.length <= 300);
  assert.match(capped, /^word0 .*word\d+$/);
  assert.equal(words.startsWith(`${capped} `), true);
});

test('validatePersonaPicks drops URLs, trims to 3 picks, and removes case-insensitive duplicates', () => {
  const picks = validatePersonaPicks([
    { title: '  Digital Love  ', artist: ' Daft Punk ' },
    { title: 'digital love', artist: 'daft punk' },
    { title: 'https://malicious.example/song', artist: 'Hacker' },
    { title: 'Normal Song', artist: 'discord.gg/invite' },
    { title: 'Too Long '.repeat(15), artist: 'Artist' },
    { title: '', artist: 'Missing Title' },
    { title: 'Track Two', artist: 'Artist Two' },
    { title: 'Track Three', artist: 'Artist Three' },
    { title: 'Track Four', artist: 'Artist Four' },
  ]);

  assert.deepEqual(picks, [
    { title: 'Digital Love', artist: 'Daft Punk' },
    { title: 'Track Two', artist: 'Artist Two' },
    { title: 'Track Three', artist: 'Artist Three' },
  ]);
});

test('getVoiceContext returns matching guild context, ignores guilds where Bread is elsewhere, and never leaks listener names', () => {
  const otherGuild = {
    id: 'guild-other',
    name: 'Other Guild',
    voiceStates: {
      cache: new Map([
        ['user-1', { id: 'user-1', channelId: 'vc-user' }],
      ]),
    },
    channels: {
      cache: new Map([
        ['vc-user', { id: 'vc-user', name: 'General VC' }],
      ]),
    },
  };

  const matchingGuild = {
    id: 'guild-match',
    name: 'Bakery Server',
    voiceStates: {
      cache: new Map([
        ['user-1', { id: 'user-1', channelId: 'vc-bread', member: { id: 'user-1', displayName: 'SecretAlice', user: { id: 'user-1', username: 'SecretAlice', bot: false } } }],
        ['user-2', { id: 'user-2', channelId: 'vc-bread', member: { id: 'user-2', displayName: 'SecretBob', user: { id: 'user-2', username: 'SecretBob', bot: false } } }],
        ['bot-id', { id: 'bot-id', channelId: 'vc-bread', member: { id: 'bot-id', displayName: 'BreadBot', user: { id: 'bot-id', username: 'BreadBot', bot: true } } }],
        ['user-3', { id: 'user-3', channelId: 'vc-other', member: { id: 'user-3', displayName: 'SecretCharlie', user: { id: 'user-3', username: 'SecretCharlie', bot: false } } }],
      ]),
    },
    channels: {
      cache: new Map([
        ['vc-bread', { id: 'vc-bread', name: 'Dough Lounge' }],
      ]),
    },
  };

  const client = {
    user: { id: 'bot-id' },
    guilds: {
      cache: new Map([
        ['guild-other', otherGuild],
        ['guild-match', matchingGuild],
      ]),
    },
    lavalink: {
      players: new Map([
        ['guild-other', { guildId: 'guild-other', voiceChannelId: 'vc-different', paused: false, queue: { current: null, tracks: [] } }],
        [
          'guild-match',
          {
            guildId: 'guild-match',
            voiceChannelId: 'vc-bread',
            paused: true,
            queue: {
              current: { info: { title: 'Veridis Quo', author: 'Daft Punk' } },
              tracks: [{}, {}, {}],
            },
          },
        ],
      ]),
    },
  };

  const context = getVoiceContext(client, 'user-1');
  assert.deepEqual(context, {
    guildName: 'Bakery Server',
    channelName: 'Dough Lounge',
    currentTrack: 'Veridis Quo - Daft Punk',
    queueLength: 3,
    listeners: 2,
    paused: true,
  });

  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes('SecretAlice'), false);
  assert.equal(serialized.includes('SecretBob'), false);
  assert.equal(serialized.includes('SecretCharlie'), false);
  assert.equal(serialized.includes('user-1'), false);
  assert.equal(serialized.includes('user-2'), false);

  const clientElsewhereOnly = {
    user: { id: 'bot-id' },
    guilds: {
      cache: new Map([['guild-other', otherGuild]]),
    },
    lavalink: {
      players: new Map([
        ['guild-other', { guildId: 'guild-other', voiceChannelId: 'vc-different', paused: false, queue: { current: null, tracks: [] } }],
      ]),
    },
  };
  assert.equal(getVoiceContext(clientElsewhereOnly, 'user-1'), null);
});

test('createDmPersona returns null when Gemini finishes with SAFETY or promptFeedback blockReason', async () => {
  const safetyPersona = createDmPersona({
    apiKey: 'test-key',
    fetchImpl: async () => geminiJsonResponse({ reply: 'unsafe text', picks: [] }, { finishReason: 'SAFETY' }),
  });
  assert.equal(await safetyPersona.reply({ text: 'hello' }), null);
  assert.equal(safetyPersona.getStatus().circuitOpen, false);

  const blockedPersona = createDmPersona({
    apiKey: 'test-key',
    fetchImpl: async () => geminiJsonResponse({ reply: 'blocked text', picks: [] }, {
      promptFeedback: { blockReason: 'SAFETY' },
    }),
  });
  assert.equal(await blockedPersona.reply({ text: 'hello' }), null);
  assert.equal(blockedPersona.getStatus().circuitOpen, false);
});

test('createDmPersona opens its own circuit breaker on 429 without affecting autoplay state', async () => {
  let now = 1_000;
  let calls = 0;

  const persona = createDmPersona({
    apiKey: 'test-key',
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          async json() {
            return { error: { message: 'quota exceeded' } };
          },
        };
      }
      return geminiJsonResponse({ reply: 'Back online.', picks: [] });
    },
  });

  assert.equal(await persona.reply({ text: 'first' }), null);
  assert.equal(calls, 1);
  assert.equal(getDmPersonaStatus(now).circuitOpen, true);
  assert.equal(getGeminiStatus(now).circuitOpen, false);

  now += 30_000;
  assert.equal(await persona.reply({ text: 'while breaker open' }), null);
  assert.equal(calls, 1);

  now += 31_000;
  assert.deepEqual(await persona.reply({ text: 'after breaker delay' }), {
    text: 'Back online.',
    picks: [],
  });
  assert.equal(calls, 2);
  assert.equal(getDmPersonaStatus(now).circuitOpen, false);
  assert.equal(getDmPersonaStatus(now).healthy, true);
});

test('createDmPersona enforces the per-UTC-day call cap and resets on the next UTC day', async () => {
  let now = Date.UTC(2026, 9, 16, 23, 59, 0);
  let calls = 0;

  const persona = createDmPersona({
    apiKey: 'test-key',
    dailyLimit: 2,
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      return geminiJsonResponse({ reply: `Reply ${calls}`, picks: [] });
    },
  });

  assert.deepEqual(await persona.reply({ text: 'one' }), { text: 'Reply 1', picks: [] });
  assert.deepEqual(await persona.reply({ text: 'two' }), { text: 'Reply 2', picks: [] });
  assert.equal(await persona.reply({ text: 'three (capped)' }), null);
  assert.equal(calls, 2);

  now = Date.UTC(2026, 9, 17, 0, 0, 1);
  assert.deepEqual(await persona.reply({ text: 'next UTC day' }), { text: 'Reply 3', picks: [] });
  assert.equal(calls, 3);
});

test('createDmPersona is disabled when no API key is set or GEMINI_DM_ENABLED is false', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    let calls = 0;
    const noKeyPersona = createDmPersona({
      apiKey: '',
      fetchImpl: async () => {
        calls += 1;
        return geminiJsonResponse({ reply: 'Should not happen', picks: [] });
      },
    });
    assert.equal(await noKeyPersona.reply({ text: 'hi' }), null);

    const disabledPersona = createDmPersona({
      apiKey: 'test-key',
      enabled: false,
      fetchImpl: async () => {
        calls += 1;
        return geminiJsonResponse({ reply: 'Should not happen', picks: [] });
      },
    });
    assert.equal(await disabledPersona.reply({ text: 'hi' }), null);
    assert.equal(calls, 0);
  } finally {
    if (previousKey !== undefined) process.env.GEMINI_API_KEY = previousKey;
  }
});

test('collectTasteHints merges and deduplicates topTracks across guilds for the DM author only', () => {
  const client = {
    guilds: {
      cache: new Map([
        ['guild-1', { id: 'guild-1' }],
        ['guild-2', { id: 'guild-2' }],
        ['guild-3', { id: 'guild-3' }],
      ]),
    },
  };

  const calls = [];
  const fakeGetUserInsights = (guildId, userId, options) => {
    calls.push({ guildId, userId, options });
    if (userId !== 'target-user') return { topTracks: [] };

    if (guildId === 'guild-1') {
      return {
        user: { userId: 'target-user' },
        topTracks: [
          { title: 'Song B', author: 'Artist B', count: 3, lastPlayedAt: 100 },
          { title: 'Song A', author: 'Artist A', count: 2, lastPlayedAt: 200 },
          { title: 'Other User Track', author: 'Someone', count: 99, userId: 'other-user' },
        ],
      };
    }
    if (guildId === 'guild-2') {
      return {
        user: { userId: 'target-user' },
        topTracks: [
          { title: 'song a', author: 'artist a', count: 4, lastPlayedAt: 300 },
          { title: 'Song C', author: 'Artist C', count: 5, lastPlayedAt: 150 },
          { title: 'Song D', author: 'Artist D', count: 1, lastPlayedAt: 90 },
          { title: 'Song E', author: 'Artist E', count: 1, lastPlayedAt: 80 },
          { title: 'Song F', author: 'Artist F', count: 1, lastPlayedAt: 70 },
        ],
      };
    }
    return {
      user: { userId: 'other-user' },
      topTracks: [
        { title: 'Wrong User Song', author: 'Wrong Artist', count: 50 },
      ],
    };
  };

  const hints = collectTasteHints(client, 'target-user', fakeGetUserInsights);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], {
    guildId: 'guild-1',
    userId: 'target-user',
    options: { range: '7d', limit: 5 },
  });
  assert.deepEqual(hints, [
    'Song A - Artist A',
    'Song C - Artist C',
    'Song B - Artist B',
    'Song D - Artist D',
    'Song E - Artist E',
  ]);
  assert.deepEqual(collectTasteHints(client, 'nobody', fakeGetUserInsights), []);
});

test('collectTasteHints skips tracks without metadata', () => {
  const client = { guilds: { cache: new Map([['g1', { id: 'g1' }]]) } };
  const insights = () => ({
    topTracks: [
      { title: 'Unknown', author: 'Unknown', count: 9 },
      { title: 'Roygbiv', author: 'Unknown', count: 2 },
    ],
  });
  assert.deepEqual(collectTasteHints(client, 'u1', insights), ['Roygbiv']);
});

test('sanitizePersonaOutput keeps replies that only mention the word http', () => {
  assert.equal(sanitizePersonaOutput('I speak bread, not http.'), 'I speak bread, not http.');
});
