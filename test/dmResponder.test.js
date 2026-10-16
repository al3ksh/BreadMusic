const test = require('node:test');
const assert = require('node:assert/strict');
const { createDmResponder } = require('../src/utils/dmResponder');

function createMessage(overrides = {}) {
  const replies = [];
  const sends = [];
  const typing = [];
  return {
    guildId: null,
    author: { id: 'user-1', bot: false },
    client: {
      user: { displayAvatarURL: () => 'https://cdn.example.test/bread.png' },
    },
    channel: {
      async send(payload) { sends.push(payload); },
      async sendTyping() { typing.push(true); },
    },
    replies,
    sends,
    typing,
    async reply(payload) {
      replies.push(payload);
    },
    ...overrides,
  };
}

test('DM responder sends community copy followed by a support embed', async () => {
  const delays = [];
  const message = createMessage();
  const respond = createDmResponder({
    dashboardUrl: 'https://example.test/dashboard',
    contact: 'owner',
    now: () => 10_000,
    random: () => 0,
    wait: async (delay) => { delays.push(delay); },
  });

  assert.equal(await respond(message), true);
  assert.equal(message.replies.length, 1);
  assert.match(message.replies[0].content, /Chat/);
  assert.deepEqual(message.typing, [true]);
  assert.deepEqual(delays, [5_000]);
  assert.equal(message.sends.length, 1);

  const embed = message.sends[0].embeds[0].toJSON();
  const components = message.sends[0].components[0].toJSON();
  assert.equal(embed.title, 'Bread Support');
  assert.match(embed.fields.find((field) => field.name === 'Need help?').value, /owner/);
  assert.equal(embed.thumbnail.url, 'https://cdn.example.test/bread.png');
  assert.equal(components.components[0].url, 'https://example.test/dashboard');
});

test('DM responder avoids repeating the same community reply consecutively', async () => {
  let timestamp = 10_000;
  const respond = createDmResponder({
    cooldownMs: 1,
    now: () => timestamp,
    random: () => 0,
    wait: async () => {},
  });
  const first = createMessage();
  const second = createMessage({ author: { id: 'user-2', bot: false } });

  await respond(first);
  timestamp += 2;
  await respond(second);
  assert.notEqual(first.replies[0].content, second.replies[0].content);
});

test('DM responder ignores guild messages and bots', async () => {
  const respond = createDmResponder({ wait: async () => {} });
  const guildMessage = createMessage({ guildId: 'guild-1' });
  const botMessage = createMessage({ author: { id: 'bot-1', bot: true } });

  assert.equal(await respond(guildMessage), false);
  assert.equal(await respond(botMessage), false);
  assert.equal(guildMessage.replies.length, 0);
  assert.equal(botMessage.replies.length, 0);
});

test('DM responder rate limits repeated messages from one user', async () => {
  let timestamp = 10_000;
  const respond = createDmResponder({
    cooldownMs: 30_000,
    now: () => timestamp,
    wait: async () => {},
  });
  const message = createMessage();

  assert.equal(await respond(message), true);
  timestamp += 5_000;
  assert.equal(await respond(message), false);
  timestamp += 30_000;
  assert.equal(await respond(message), true);
  assert.equal(message.replies.length, 2);
  assert.equal(message.sends.length, 1);
});

test('DM responder sends the support embed again after its longer cooldown', async () => {
  let timestamp = 10_000;
  const respond = createDmResponder({
    cooldownMs: 30_000,
    supportCooldownMs: 6 * 60 * 60 * 1000,
    now: () => timestamp,
    wait: async () => {},
  });
  const message = createMessage();

  await respond(message);
  timestamp += 31_000;
  await respond(message);
  assert.equal(message.replies.length, 2);
  assert.equal(message.sends.length, 1);

  timestamp += 6 * 60 * 60 * 1000;
  await respond(message);
  assert.equal(message.replies.length, 3);
  assert.equal(message.sends.length, 2);
});

test('DM responder uses persona reply, passes nowPlaying and taste hints, and sends dmrec buttons only when there are picks', async () => {
  const personaCalls = [];
  const selections = [];
  let timestamp = 10_000;
  let roll = 0.1;
  let picksToReturn = [
    { title: 'Digital Love', artist: 'Daft Punk' },
    { title: 'Something About Us', artist: 'Daft Punk' },
  ];

  const fakeVoiceContext = {
    guildName: 'Bread HQ',
    channelName: 'Bakery VC',
    currentTrack: 'One More Time - Daft Punk',
    queueLength: 2,
    listeners: 3,
    paused: false,
  };

  const respond = createDmResponder({
    cooldownMs: 1,
    now: () => timestamp,
    random: () => roll,
    wait: async () => {},
    getTasteHints: (userId) => [`Track for ${userId} - Artist`],
    getVoiceContext: () => fakeVoiceContext,
    createSelection: (tracks, userId, guildId, ttl) => {
      const id = `sel-${selections.length + 1}`;
      selections.push({ id, tracks, userId, guildId, ttl });
      return id;
    },
    persona: {
      async reply(input) {
        personaCalls.push(input);
        return {
          text: 'Crispy persona reply.',
          picks: picksToReturn,
        };
      },
    },
  });

  const first = createMessage({
    content: 'yo bread recommend me something',
    author: { id: 'user-1', username: 'listener1', bot: false },
  });
  assert.equal(await respond(first), true);
  assert.equal(first.replies[0].content, 'Crispy persona reply.');
  assert.deepEqual(first.replies[0].allowedMentions, { parse: [] });
  assert.deepEqual(first.typing, [true, true]);
  assert.deepEqual(personaCalls[0], {
    text: 'yo bread recommend me something',
    userName: 'listener1',
    tasteHints: ['Track for user-1 - Artist'],
    nowPlaying: fakeVoiceContext,
  });

  assert.equal(Array.isArray(first.replies[0].components), true);
  assert.equal(first.replies[0].components.length, 1);
  const rowJson = first.replies[0].components[0].toJSON();
  assert.equal(rowJson.components.length, 2);
  assert.equal(rowJson.components[0].custom_id, 'dmrec:sel-1');
  assert.equal(rowJson.components[0].label, 'Digital Love - Daft Punk');
  assert.equal(rowJson.components[1].custom_id, 'dmrec:sel-2');
  assert.equal(rowJson.components[1].label, 'Something About Us - Daft Punk');
  assert.equal(selections.length, 2);
  assert.equal(selections[0].userId, 'user-1');
  assert.equal(selections[0].ttl, 10 * 60 * 1000);

  timestamp += 10;
  roll = 0.8;
  picksToReturn = [];
  const second = createMessage({
    content: 'second dm without picks',
    author: { id: 'user-2', username: 'listener2', bot: false },
  });
  assert.equal(await respond(second), true);
  assert.deepEqual(personaCalls[1].tasteHints, []);
  assert.equal(second.replies[0].components, undefined);
});

test('DM responder falls back to a community reply when persona returns null or throws', async () => {
  let timestamp = 10_000;
  let shouldThrow = false;

  const respond = createDmResponder({
    cooldownMs: 1,
    now: () => timestamp,
    random: () => 0,
    wait: async () => {},
    persona: {
      async reply() {
        if (shouldThrow) throw new Error('Gemini exploded');
        return null;
      },
    },
  });

  const first = createMessage({ author: { id: 'user-1', bot: false } });
  assert.equal(await respond(first), true);
  assert.match(first.replies[0].content, /Chat/);
  assert.equal(first.replies[0].components, undefined);

  timestamp += 10;
  shouldThrow = true;
  const second = createMessage({ author: { id: 'user-2', bot: false } });
  assert.equal(await respond(second), true);
  assert.equal(second.replies.length, 1);
  assert.ok(second.replies[0].content.length > 0);
  assert.equal(second.replies[0].components, undefined);
});

