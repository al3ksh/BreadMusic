const test = require('node:test');
const assert = require('node:assert/strict');
const discord = require('discord.js');

const radioModule = require('../src/music/radio');
const { createRadio, normalizeBrowserStation, formatStationChoice, RadioError } = radioModule;
const { createRadioCommands } = require('../src/commands/domains/radio');

const RMF = {
  stationuuid: '399b7c2a-6680-11e8-b15b-52543be04c81',
  name: 'RMF FM',
  url_resolved: 'http://195.150.20.242:8000/rmf_fm',
  homepage: 'https://www.rmf.fm/',
  favicon: 'https://www.rmf.fm/icon.png',
  country: 'Poland',
  state: '',
  tags: 'pop,fm',
  codec: 'MP3',
  bitrate: 128,
  hls: 0,
  clickcount: 900,
};
const JAZZ = { ...RMF, stationuuid: '11111111-2222-3333-4444-555555555555', name: 'Jazz Radio', tags: 'jazz', clickcount: 50 };
const HLS = { ...RMF, stationuuid: '99999999-2222-3333-4444-555555555555', name: 'HLS Only', hls: 1, clickcount: 5000 };

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    for (const [pattern, handler] of routes) {
      if (pattern.test(url)) return handler(url, options);
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, calls };
}

test('normalizeBrowserStation skips HLS and keeps the useful fields', () => {
  assert.equal(normalizeBrowserStation(HLS), null);
  assert.equal(normalizeBrowserStation({ ...RMF, codec: 'HLS' }), null);
  assert.equal(normalizeBrowserStation({ ...RMF, favicon: 'http://insecure/icon.png' }).favicon, '');
  assert.deepEqual(normalizeBrowserStation(RMF), {
    id: RMF.stationuuid,
    source: 'radio-browser',
    name: 'RMF FM',
    url: RMF.url_resolved,
    homepage: RMF.homepage,
    country: 'Poland',
    place: '',
    tags: ['pop', 'fm'],
    favicon: RMF.favicon,
    codec: 'MP3',
    bitrate: 128,
  });
});

test('searchStations merges name, tag and country hits by popularity and caches them', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/[?&]name=/, () => jsonResponse([JAZZ, HLS])],
    [/[?&]tag=/, () => jsonResponse([RMF, JAZZ])],
    [/[?&]country=/, () => jsonResponse([])],
  ]);
  const radio = createRadio({ fetchImpl });
  const stations = await radio.searchStations('jazz', { limit: 5 });
  assert.deepEqual(stations.map((station) => station.name), ['RMF FM', 'Jazz Radio']);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers['User-Agent'].startsWith('BreadMusic'), true);
  await radio.searchStations('jazz', { limit: 5 });
  assert.equal(calls.length, 3);
});

test('searchStations falls back to another mirror when the first one fails', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/^https:\/\/de1\./, () => jsonResponse(null, { status: 503 })],
    [/^https:\/\/de2\./, () => jsonResponse([RMF])],
  ]);
  const radio = createRadio({ fetchImpl });
  const stations = await radio.searchStations('', { limit: 3 });
  assert.deepEqual(stations.map((station) => station.id), [RMF.stationuuid]);
  assert.deepEqual(calls.map((call) => new URL(call.url).hostname), ['de1.api.radio-browser.info', 'de2.api.radio-browser.info']);
});

test('resolveStation handles a UUID, a Radio Garden link, a stream URL and free text', async () => {
  const { fetchImpl } = fakeFetch([
    [/\/byuuid\//, () => jsonResponse([RMF])],
    [/radio\.garden\/api\/ara\/content\/channel\/bFzYBBRP$/, () => jsonResponse({
      data: { title: 'RMF Radio', place: { title: 'Montréal' }, country: { title: 'Canada' }, website: 'https://rmf-radio.com' },
    })],
    [/channel\.mp3$/, () => jsonResponse(null, { status: 302, headers: { location: 'https://play.radioking.io/rmf-radio' } })],
    [/[?&]name=Jazz/, () => jsonResponse([JAZZ])],
    [/\/search\?/, () => jsonResponse([])],
  ]);
  const radio = createRadio({ fetchImpl });

  assert.equal((await radio.resolveStation(RMF.stationuuid)).name, 'RMF FM');

  const garden = await radio.resolveStation('https://radio.garden/listen/rmf-radio/bFzYBBRP');
  assert.equal(garden.name, 'RMF Radio');
  assert.equal(garden.url, 'https://play.radioking.io/rmf-radio');
  assert.equal(radioModule.describeStationLocation(garden), 'Montréal, Canada');

  const direct = await radio.resolveStation('https://stream.example.com/live.mp3');
  assert.equal(direct.name, 'stream.example.com');
  assert.equal(direct.url, 'https://stream.example.com/live.mp3');

  assert.equal((await radio.resolveStation('Jazz')).name, 'Jazz Radio');
  await assert.rejects(radio.resolveStation('nothing here'), RadioError);
});

test('formatStationChoice fits Discord autocomplete limits', () => {
  const choice = formatStationChoice(normalizeBrowserStation({ ...RMF, name: 'X'.repeat(150) }));
  assert.equal(choice.name.length, 100);
  assert.equal(choice.value, RMF.stationuuid);
  assert.equal(formatStationChoice(normalizeBrowserStation(RMF)).name, 'RMF FM — Poland · pop, fm · 128 kbps');
});

function setupCommand({ current = null, playing = false } = {}) {
  const station = normalizeBrowserStation(RMF);
  const calls = [];
  const queue = {
    current,
    tracks: [],
    add: async (track, index) => {
      calls.push(['add', index ?? null]);
      if (index === 0) queue.tracks.unshift(track);
      else queue.tracks.push(track);
    },
  };
  const player = {
    guildId: 'radio-guild',
    playing,
    paused: false,
    queue,
    search: async (query) => {
      calls.push(['search', query]);
      return { tracks: [{ encoded: 'enc', info: { title: 'Unknown title', author: 'Unknown artist', isStream: true, duration: 0 } }] };
    },
    play: async () => calls.push(['play']),
    skip: async () => calls.push(['skip']),
  };
  const radio = {
    ...radioModule,
    searchStations: async () => [station],
    resolveStation: async () => station,
    reportPlay: () => calls.push(['report']),
  };
  const [command] = createRadioCommands({
    ...discord,
    BRAND_COLORS: { primary: 0x123456 },
    ensureVoice: async () => ({ player, voiceChannelId: 'voice-1' }),
    classifyPlaybackError: () => ({ title: 'x', description: 'y' }),
    describeSearchFailure: () => ({ title: 'x', description: 'y' }),
    queuePersist: async () => calls.push(['persist']),
    radio,
  });
  const run = async () => {
    const replies = [];
    await command.execute({
      user: { id: 'u1', username: 'alex' },
      options: { getString: () => RMF.stationuuid },
      deferReply: async () => {},
      editReply: async (reply) => replies.push(reply),
      deleteReply: async () => {},
      followUp: async (reply) => replies.push(reply),
    });
    return replies.at(-1);
  };
  return { command, run, calls, player };
}

test('/radio dresses the stream with the station details and starts it', async () => {
  const { run, calls, player } = setupCommand();
  const reply = await run();
  const [track] = player.queue.tracks;
  assert.equal(track.info.title, 'RMF FM');
  assert.equal(track.info.author, 'Poland');
  assert.equal(track.info.artworkUrl, RMF.favicon);
  assert.deepEqual(calls.map(([name]) => name), ['search', 'add', 'play', 'report', 'persist']);
  assert.equal(calls[0][1], RMF.url_resolved);
  assert.equal(reply.embeds[0].data.title, '📻 Live radio');
});

test('/radio switches straight away when radio is already playing', async () => {
  const { run, calls } = setupCommand({ current: { info: { isStream: true } }, playing: true });
  const reply = await run();
  assert.deepEqual(calls.slice(0, 3), [['search', RMF.url_resolved], ['add', 0], ['skip']]);
  assert.equal(reply.embeds[0].data.title, '📻 Switched station');
});

test('/radio autocomplete lists stations and echoes pasted links', async () => {
  const { command } = setupCommand();
  const respond = async (focused) => {
    let choices;
    await command.autocomplete({ options: { getFocused: () => focused }, respond: async (value) => { choices = value; } });
    return choices;
  };
  assert.deepEqual((await respond('rmf')).map((choice) => choice.value), [RMF.stationuuid]);
  assert.deepEqual(await respond('https://radio.garden/listen/x/abc'), [{ name: 'https://radio.garden/listen/x/abc', value: 'https://radio.garden/listen/x/abc' }]);
});
