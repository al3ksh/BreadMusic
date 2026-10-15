const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-guild-config-routes-'));
const originalDbPath = process.env.BREAD_DB_PATH;
process.env.BREAD_DB_PATH = path.join(tempDir, 'bread.sqlite');

const { closeDatabases } = require('../src/state/sqliteStore');
const { getConfig, setConfig, deleteConfig } = require('../src/state/guildConfig');
const { isUsableTextChannel, PLAYER_TEXT_CHANNEL_DISABLED } = require('../src/api/playerSnapshot');
const { createGuildConfigRouter } = require('../src/routes/guildConfig');

const pass = (_req, _res, next) => next();
const MANAGE_GUILD = String(0x20);
let guildCounter = 0;

test.after(() => {
  closeDatabases();
  if (originalDbPath === undefined) delete process.env.BREAD_DB_PATH;
  else process.env.BREAD_DB_PATH = originalDbPath;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

// A stand-in for discord.com/api: answers /users/@me/guilds per bearer token.
async function fakeDiscord(responsesByToken) {
  const app = express();
  const seen = [];
  app.get('/users/@me/guilds', (req, res) => {
    const token = req.headers.authorization.replace('Bearer ', '');
    seen.push(token);
    const answer = responsesByToken[token] || { status: 401, body: { message: '401: Unauthorized' } };
    res.status(answer.status).json(answer.body);
  });
  const { server, url } = await listen(app);
  return { server, url, seen };
}

function textChannel(id, name) {
  return { id, name, isTextBased: () => true, isSendable: () => true };
}

async function withApp({ guilds = [], discordApi = 'http://127.0.0.1:9', session, overrides = {} }, callback) {
  const calls = [];
  const client = {
    guilds: { cache: new Map(guilds.map((guild) => [guild.id, guild])) },
    guildAccess: { mode: 'open' },
    lavalink: { players: new Map() },
    musicUI: {
      refresh: async () => { calls.push(['refresh']); },
      clear: async (guildId) => { calls.push(['clear', guildId]); },
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = session;
    next();
  });
  app.use(createGuildConfigRouter({
    client,
    discordApi,
    requireAuth: pass,
    requirePlayerAccess: pass,
    requireGuildAdmin: pass,
    requireTrustedOrigin: pass,
    requireDashboardActionRateLimit: pass,
    refreshAccessToken: async () => null,
    getRequestUser: (req) => ({ id: req.session.user.id }),
    isGuildAllowed: () => true,
    resolveDashboardCapabilities: () => ({ accessLevel: 'member', dashboardAccess: 'admin', canAccess: false }),
    getConfig,
    setConfig,
    deleteConfig,
    isUsableTextChannel,
    resolvePlayerTextChannelId: (_guild, configured, fallback) => (configured === PLAYER_TEXT_CHANNEL_DISABLED ? null : configured || fallback),
    clearVoiceTrackStatus: async () => { calls.push(['clearVoiceStatus']); },
    setVoiceTrackStatus: async () => { calls.push(['setVoiceStatus']); },
    savePlayerState: async () => { calls.push(['save']); },
    broadcastPlayerUpdate: (guildId) => { calls.push(['broadcast', guildId]); },
    playerTextChannelDisabled: PLAYER_TEXT_CHANNEL_DISABLED,
    rebuildProfileFromHistory: () => ({ seeds: 3 }),
    scheduleAutoplayPrefetch: () => { calls.push(['prefetch']); },
    setAutoplay: (guildId, enabled) => setConfig(guildId, { autoplay: enabled }),
    getLastfmStatus: () => ({ configured: false }),
    ...overrides,
  }));
  const { server, url } = await listen(app);
  try {
    await callback({ url, client, calls });
  } finally {
    server.close();
  }
}

function makeSession(overrides = {}) {
  const state = { saved: 0, destroyed: false };
  const session = {
    user: { id: 'viewer', accessToken: 'good', refreshToken: 'refresh', tokenExpires: Date.now() + 60_000, ...overrides },
    save(callback) { state.saved += 1; callback(); },
    destroy(callback) { state.destroyed = true; callback(); },
  };
  return { session, state };
}

function makeGuild(id, { roles = [], channels = [], member = null } = {}) {
  return {
    id,
    roles: { cache: new Map(roles.map((role) => [role.id, role])) },
    channels: { cache: new Map(channels.map((channel) => [channel.id, channel])) },
    members: {
      cache: new Map(member ? [[member.id, member]] : []),
      fetch: async () => { throw new Error('Unknown Member'); },
    },
  };
}

const put = (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('the guild list shows only servers the viewer may open or invite the bot to', async () => {
  const discord = await fakeDiscord({
    good: {
      status: 200,
      body: [
        { id: 'no-access', name: 'Bot here, viewer locked out', permissions: '0' },
        { id: 'invite-me', name: 'Viewer manages, bot missing', permissions: MANAGE_GUILD },
        { id: 'plain-member', name: 'Viewer is a member, bot missing', permissions: '0' },
        { id: 'blocked', name: 'Not on the allow list', permissions: MANAGE_GUILD },
        { id: 'open', name: 'Bot here, viewer allowed', permissions: '0', approximate_member_count: 12 },
      ],
    },
  });
  const lockedOut = { id: 'viewer', canOpen: false };
  const allowed = { id: 'viewer', canOpen: true };
  const { session } = makeSession();
  try {
    await withApp({
      guilds: [makeGuild('no-access', { member: lockedOut }), makeGuild('open', { member: allowed }), makeGuild('blocked')],
      discordApi: discord.url,
      session,
      overrides: {
        isGuildAllowed: (_access, guildId) => guildId !== 'blocked',
        resolveDashboardCapabilities: (member) => (member.canOpen
          ? { accessLevel: 'member', dashboardAccess: 'members', canAccess: true }
          : { accessLevel: 'member', dashboardAccess: 'admin', canAccess: false }),
      },
    }, async ({ url }) => {
      const response = await fetch(`${url}/api/guilds`);
      assert.equal(response.status, 200);
      const guilds = await response.json();
      assert.deepEqual(guilds.map((guild) => [guild.id, guild.bot_present, guild.can_access, guild.can_invite]), [
        ['open', true, true, false],
        ['invite-me', false, true, true],
      ]);
      assert.equal(guilds[0].member_count, 12);
    });
  } finally {
    discord.server.close();
  }
});

test('an expired Discord token is refreshed once and the session keeps the new one', async () => {
  const discord = await fakeDiscord({ fresh: { status: 200, body: [] } });
  const { session, state } = makeSession({ accessToken: 'stale' });
  try {
    await withApp({
      discordApi: discord.url,
      session,
      overrides: { refreshAccessToken: async (token) => (token === 'refresh' ? { access_token: 'fresh', expires_in: 3600 } : null) },
    }, async ({ url }) => {
      const response = await fetch(`${url}/api/guilds`);
      assert.equal(response.status, 200);
      assert.deepEqual(discord.seen, ['stale', 'fresh']);
      assert.equal(session.user.accessToken, 'fresh');
      assert.equal(session.user.refreshToken, 'refresh', 'the old refresh token is kept when Discord sends none');
      assert.equal(state.saved, 1);
    });
  } finally {
    discord.server.close();
  }
});

test('a revoked Discord token signs the viewer out instead of retrying forever', async () => {
  const discord = await fakeDiscord({});
  const { session, state } = makeSession({ accessToken: 'revoked' });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await withApp({ discordApi: discord.url, session }, async ({ url }) => {
      const response = await fetch(`${url}/api/guilds`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Discord session expired', reauth: true });
      assert.equal(state.destroyed, true);
      assert.match(response.headers.get('set-cookie') || '', /bread\.sid=;/);
    });
  } finally {
    console.warn = originalWarn;
    discord.server.close();
  }
});

test('the config view names the configured roles and channels', async () => {
  const guildId = `config-guild-${++guildCounter}`;
  setConfig(guildId, { djRoleId: 'dj', modRoleId: 'gone', twentyFourSevenChannelId: 'lounge', playerTextChannelId: 'music' });
  const guild = makeGuild(guildId, {
    roles: [{ id: 'dj', name: 'DJ' }],
    channels: [{ id: 'lounge', name: 'Lounge' }, textChannel('music', 'music-bot')],
  });
  await withApp({ guilds: [guild], session: makeSession().session }, async ({ url }) => {
    const config = await (await fetch(`${url}/api/guilds/${guildId}/config`)).json();
    assert.equal(config.djRoleName, 'DJ');
    assert.equal(config.modRoleName, null, 'a deleted role shows no name');
    assert.equal(config.twentyFourSevenChannelName, 'Lounge');
    assert.equal(config.playerTextChannelName, 'music-bot');
    assert.deepEqual(config.lastfm, { configured: false });
  });
});

test('config updates are clamped and unknown values are ignored', async () => {
  const guildId = `config-guild-${++guildCounter}`;
  await withApp({ guilds: [makeGuild(guildId)], session: makeSession().session }, async ({ url }) => {
    const response = await put(`${url}/api/guilds/${guildId}/config`, {
      maxVolume: 9000,
      voteSkipPercent: 0,
      afkTimeout: 5,
      defaultVolume: 250,
      activityControl: 'everyone',
      dashboardAccess: 'dj',
      maxQueuedPerUser: 400,
      stayInChannel: 'yes',
      djRoleId: '',
    });
    assert.equal(response.status, 200);
    const { config } = await response.json();
    assert.equal(config.maxVolume, 500);
    assert.equal(config.voteSkipPercent, 0.1);
    assert.equal(config.afkTimeout, 60000);
    assert.equal(config.defaultVolume, 100);
    assert.equal(config.activityControl, 'inherit');
    assert.equal(config.dashboardAccess, 'mod', 'the legacy dj level maps to mod');
    assert.equal(config.maxQueuedPerUser, 50);
    assert.equal(config.stayInChannel, false);
    assert.equal(config.djRoleId, null);
  });
});

test('the player text channel must be a channel the bot can post in', async () => {
  const guildId = `config-guild-${++guildCounter}`;
  const voice = { id: 'voice', isTextBased: () => false };
  const muted = { id: 'muted', isTextBased: () => true, isSendable: () => false };
  const guild = makeGuild(guildId, { channels: [voice, muted, textChannel('music', 'music')] });
  await withApp({ guilds: [guild], session: makeSession().session }, async ({ url, calls }) => {
    for (const channelId of ['voice', 'muted', 'missing']) {
      const response = await put(`${url}/api/guilds/${guildId}/config`, { playerTextChannelId: channelId });
      assert.equal(response.status, 400, channelId);
    }
    assert.equal(getConfig(guildId).playerTextChannelId, null);

    const ok = await put(`${url}/api/guilds/${guildId}/config`, { playerTextChannelId: 'music' });
    assert.equal(ok.status, 200);
    assert.deepEqual(calls, [['clear', guildId]], 'the old panel is cleared when the channel moves');

    const disabled = await put(`${url}/api/guilds/${guildId}/config`, { playerTextChannelId: PLAYER_TEXT_CHANNEL_DISABLED });
    assert.equal(disabled.status, 200);
    assert.equal(getConfig(guildId).playerTextChannelId, PLAYER_TEXT_CHANNEL_DISABLED);
  });
});

test('lowering the volume cap turns down a louder player right away', async () => {
  const guildId = `config-guild-${++guildCounter}`;
  await withApp({ guilds: [makeGuild(guildId)], session: makeSession().session }, async ({ url, client, calls }) => {
    const player = { volume: 150, queue: { current: null }, async setVolume(volume) { this.volume = volume; } };
    client.lavalink.players.set(guildId, player);
    setConfig(guildId, { maxVolume: 200 });

    await put(`${url}/api/guilds/${guildId}/config`, { maxVolume: 80 });
    assert.equal(player.volume, 80);
    assert.deepEqual(calls, [['save'], ['refresh'], ['broadcast', guildId]]);
  });
});

test('turning autoplay on prepares a pick for the playing track', async () => {
  const guildId = `config-guild-${++guildCounter}`;
  await withApp({ guilds: [makeGuild(guildId)], session: makeSession().session }, async ({ url, client, calls }) => {
    client.lavalink.players.set(guildId, { volume: 50, queue: { current: { info: { title: 'Now' } } } });
    const response = await put(`${url}/api/guilds/${guildId}/config`, { autoplay: true });
    assert.equal((await response.json()).config.autoplay, true);
    assert.deepEqual(calls, [['prefetch'], ['refresh'], ['broadcast', guildId]]);

    calls.length = 0;
    await put(`${url}/api/guilds/${guildId}/config`, { autoplay: true });
    assert.deepEqual(calls, [], 'sending the same value again changes nothing');
  });
});

test('reset restores defaults and caps the player volume to the default limit', async () => {
  const guildId = `config-guild-${++guildCounter}`;
  setConfig(guildId, { maxVolume: 300, fairQueue: true });
  await withApp({ guilds: [makeGuild(guildId)], session: makeSession().session }, async ({ url, client }) => {
    const player = { volume: 250, queue: { current: null }, async setVolume(volume) { this.volume = volume; } };
    client.lavalink.players.set(guildId, player);
    const response = await fetch(`${url}/api/guilds/${guildId}/config/reset`, { method: 'POST' });
    const { config } = await response.json();
    assert.equal(config.maxVolume, 100);
    assert.equal(config.fairQueue, false);
    assert.equal(player.volume, 100);
  });
});
