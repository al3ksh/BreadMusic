const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const express = require('express');
const { createControlRouter } = require('../src/routes/control');

const pass = (_req, _res, next) => next();

async function withApp(channel, callback) {
  const client = new EventEmitter();
  const guild = { id: 'control-guild', channels: { cache: new Map([[channel.id, channel]]) } };
  client.guilds = { cache: new Map([[guild.id, guild]]) };
  client.lavalink = { players: new Map() };

  const app = express();
  app.use(express.json());
  app.use(createControlRouter({
    client,
    requireAuth: pass,
    requireGuildAdmin: pass,
    requireTrustedOrigin: pass,
    requireDashboardActionRateLimit: pass,
    getConfig: () => ({}),
    getGuildMembersSnapshot: async () => new Map(),
    resolvePlayerTextChannelId: () => null,
    clearAutoplayState: () => {},
  }));

  const server = app.listen(0);
  try {
    await callback(`http://127.0.0.1:${server.address().port}/api/guilds/${guild.id}/control`);
  } finally {
    server.close();
  }
}

function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('control say hides Discord error details from the dashboard', async () => {
  const channel = {
    id: 'text-1',
    isTextBased: () => true,
    send: async () => { throw new Error('Missing Access: internal detail'); },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await withApp(channel, async (base) => {
      const response = await post(`${base}/say`, { channelId: channel.id, message: 'hi' });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Failed to send message' });
    });
  } finally {
    console.error = originalError;
  }
});

test('control say passes only the mentions the admin allowed', async () => {
  const sent = [];
  const channel = { id: 'text-2', isTextBased: () => true, send: async (payload) => { sent.push(payload); } };
  await withApp(channel, async (base) => {
    const response = await post(`${base}/say`, { channelId: channel.id, message: '@everyone', allowedMentions: { users: true } });
    assert.equal(response.status, 200);
  });
  assert.deepEqual(sent[0].allowedMentions, { parse: ['users'] });
});

test('control summon rejects channels that are not voice channels', async () => {
  const channel = { id: 'text-3', isTextBased: () => true, isVoiceBased: () => false };
  await withApp(channel, async (base) => {
    const response = await post(`${base}/action`, { type: 'summon', channelId: channel.id });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid voice channel' });
  });
});
