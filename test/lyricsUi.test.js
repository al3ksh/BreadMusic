const test = require('node:test');
const assert = require('node:assert/strict');
const { LyricsUI, paginateLyrics } = require('../src/music/lyricsUi');

test('live lyrics edit only when the active line changes and stop on a new track', async () => {
  const edits = [];
  const track = { encoded: 'track-a', info: {} };
  const player = { position: 0, queue: { current: track } };
  const client = { lavalink: { getPlayer: () => player } };
  const lyricsUI = new LyricsUI(client);
  const document = {
    guildId: 'guild',
    lyrics: { title: 'Song', artist: 'Artist', provider: 'LRCLIB', plainLyrics: 'Full lyrics' },
    syncedLines: [
      { time: 0, text: 'First' },
      { time: 1000, text: 'Second' },
      { time: 2000, text: 'Third' },
    ],
    pages: ['Full lyrics'],
    currentPage: 0,
  };
  const session = {
    guildId: 'guild',
    messageId: 'message',
    message: { edit: async (payload) => edits.push(payload) },
    trackKey: 'track-a',
    document,
    lyrics: { title: 'Song', artist: 'Artist', provider: 'LRCLIB' },
    lines: document.syncedLines,
    lastIndex: null,
    lastObservedPosition: 0,
    pausedPosition: null,
    updating: false,
    timer: null,
  };
  lyricsUI.sessions.set('guild', session);

  await lyricsUI.tick(session, true);
  assert.equal(edits.length, 1);
  assert.match(edits[0].embeds[0].data.description, /\*\*First\*\*/);

  player.position = 900;
  await lyricsUI.tick(session);
  assert.equal(edits.length, 1);

  player.position = 1200;
  await lyricsUI.tick(session);
  assert.equal(edits.length, 2);
  assert.match(edits[1].embeds[0].data.description, /\*\*Second\*\*/);

  player.queue.current = { encoded: 'track-b', info: {} };
  await lyricsUI.tick(session);
  assert.equal(edits.length, 3);
  assert.deepEqual(edits[2].components, []);
  assert.equal(lyricsUI.sessions.has('guild'), false);
});

test('plain lyrics paginate on line boundaries without truncating content', () => {
  const body = 'First line\nSecond line\nThird line';
  const pages = paginateLyrics(body, 15);
  assert.deepEqual(pages, ['First line', 'Second line', 'Third line']);
  assert.equal(pages.join('\n'), body);
  assert.equal(pages.every((page) => page.length <= 15), true);
});

test('lyrics page controls update only their own document', async () => {
  const lyricsUI = new LyricsUI({});
  const document = {
    guildId: 'guild',
    lyrics: { title: 'Song', artist: 'Artist', provider: 'LRCLIB' },
    syncedLines: [],
    pages: ['Page one', 'Page two'],
    currentPage: 0,
    expiresAt: Date.now() + 1000,
  };
  lyricsUI.documents.set('message', document);
  let payload;

  await lyricsUI.changePage({
    customId: 'lyricspage:next:guild',
    guildId: 'guild',
    message: { id: 'message' },
    update: async (value) => { payload = value; },
  });

  assert.equal(document.currentPage, 1);
  assert.equal(payload.embeds[0].data.description, 'Page two');
  assert.match(payload.embeds[0].data.footer.text, /Page 2\/2/);
});

test('live lyrics freeze their position while Lavalink reports a paused player', () => {
  const lyricsUI = new LyricsUI({});
  const session = { lastObservedPosition: 4200, pausedPosition: null };
  const player = { paused: true, position: 7600 };

  assert.equal(lyricsUI.resolvePosition(session, player), 4200);
  player.position = 3100;
  assert.equal(lyricsUI.resolvePosition(session, player), 4200);

  player.paused = false;
  player.position = 4300;
  assert.equal(lyricsUI.resolvePosition(session, player), 4300);
  assert.equal(session.pausedPosition, null);
});

test('closing lyrics clears an active session and deletes its message', async () => {
  const lyricsUI = new LyricsUI({});
  let deferred = false;
  let deleted = false;
  lyricsUI.sessions.set('guild', { messageId: 'message', timer: null });

  await lyricsUI.close({
    customId: 'lyricsclose:guild',
    guildId: 'guild',
    message: {
      id: 'message',
      delete: async () => { deleted = true; },
    },
    deferUpdate: async () => { deferred = true; },
  });

  assert.equal(deferred, true);
  assert.equal(deleted, true);
  assert.equal(lyricsUI.sessions.has('guild'), false);
});
