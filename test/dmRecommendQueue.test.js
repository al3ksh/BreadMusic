const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const {
  DM_RECOMMEND_PREFIX,
  createDmRecommendHandler,
} = require('../src/utils/dmRecommendQueue');

function createButtonInteraction({
  customId = `${DM_RECOMMEND_PREFIX}sel-1`,
  userId = 'user-1',
  buttonIds = [`${DM_RECOMMEND_PREFIX}sel-1`, `${DM_RECOMMEND_PREFIX}sel-2`],
  client = null,
} = {}) {
  const replies = [];
  const updates = [];
  const edits = [];
  const row = new ActionRowBuilder().addComponents(
    buttonIds.map((id, index) => (
      new ButtonBuilder()
        .setCustomId(id)
        .setLabel(`Pick ${index + 1}`)
        .setStyle(ButtonStyle.Secondary)
    )),
  );

  return {
    customId,
    user: { id: userId, username: 'Baker' },
    client,
    replied: false,
    deferred: false,
    replies,
    updates,
    edits,
    message: {
      components: [row],
      async edit(payload) {
        edits.push(payload);
      },
    },
    async reply(payload) {
      this.replied = true;
      replies.push(payload);
    },
    async followUp(payload) {
      replies.push(payload);
    },
    async update(payload) {
      updates.push(payload);
    },
  };
}

test('dmRecommendQueue refuses clicks from a user other than the DM recipient', async () => {
  const handler = createDmRecommendHandler({
    getSelection: () => ({
      tracks: [{ title: 'Veridis Quo', artist: 'Daft Punk' }],
      userId: 'owner-user',
    }),
  });

  const interaction = createButtonInteraction({ userId: 'intruder-user' });
  const result = await handler(interaction);

  assert.equal(result, false);
  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].content, /someone else/i);
  assert.equal(interaction.updates.length, 0);
});

test('dmRecommendQueue replies with a stale notice when the selection has expired', async () => {
  const handler = createDmRecommendHandler({
    getSelection: () => null,
  });

  const interaction = createButtonInteraction();
  const result = await handler(interaction);

  assert.equal(result, false);
  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].content, /stale/i);
});

test('dmRecommendQueue hints to join a voice channel where Bread is playing and never creates a player', async () => {
  let createPlayerCalls = 0;
  const client = {
    guilds: {
      cache: new Map([
        [
          'guild-1',
          {
            id: 'guild-1',
            name: 'Bread HQ',
            voiceStates: {
              cache: new Map([['user-1', { id: 'user-1', channelId: 'vc-1' }]]),
            },
          },
        ],
      ]),
    },
    lavalink: {
      players: new Map(),
      createPlayer() {
        createPlayerCalls += 1;
        throw new Error('Should never create a player from DM');
      },
    },
  };

  const handler = createDmRecommendHandler({
    client,
    getSelection: () => ({
      tracks: [{ title: 'Digital Love', artist: 'Daft Punk' }],
      userId: 'user-1',
    }),
  });

  const interaction = createButtonInteraction({ userId: 'user-1', client });
  const result = await handler(interaction);

  assert.equal(result, false);
  assert.equal(createPlayerCalls, 0);
  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].content, /join a voice channel/i);
});

test('dmRecommendQueue happy path searches, queues, persists, confirms with position, and disables the clicked button', async () => {
  const searchedQueries = [];
  const persistedPlayers = [];
  const manualSeeds = [];
  const deletedSelections = [];

  const existingTrack = { info: { title: 'Intro', author: 'Band' }, requester: { id: 'other' } };
  const player = {
    guildId: 'guild-1',
    voiceChannelId: 'vc-1',
    playing: true,
    paused: false,
    queue: {
      current: { info: { title: 'Current Song', author: 'Artist' } },
      tracks: [existingTrack],
      async add(item, index) {
        const items = Array.isArray(item) ? item : [item];
        if (typeof index === 'number') {
          this.tracks.splice(index, 0, ...items);
        } else {
          this.tracks.push(...items);
        }
      },
    },
    async search(query, user) {
      searchedQueries.push({ query, user });
      return {
        tracks: [
          {
            info: {
              title: 'Digital Love',
              author: 'Daft Punk',
              identifier: 'dl-1',
              uri: 'https://track.example/dl',
            },
          },
        ],
      };
    },
  };

  const guild = {
    id: 'guild-1',
    name: 'Bread HQ',
    voiceStates: {
      cache: new Map([
        ['user-1', { id: 'user-1', channelId: 'vc-1' }],
      ]),
    },
    channels: {
      cache: new Map([['vc-1', { id: 'vc-1', name: 'Music VC' }]]),
    },
  };

  const client = {
    guilds: { cache: new Map([['guild-1', guild]]) },
    lavalink: {
      options: { playerOptions: { defaultSearchPlatform: 'ytmsearch' } },
      players: new Map([['guild-1', player]]),
    },
  };

  const handler = createDmRecommendHandler({
    client,
    getSelection: () => ({
      tracks: [{ title: 'Digital Love', artist: 'Daft Punk' }],
      userId: 'user-1',
    }),
    deleteSelection: (id) => deletedSelections.push(id),
    getConfig: () => ({
      preferredSource: 'spotify',
      maxQueuedPerUser: 0,
      djOnlyMode: false,
      fairQueue: true,
    }),
    addManualSeed: (guildId, track) => manualSeeds.push({ guildId, track }),
    queuePersist: async (p) => { persistedPlayers.push(p); },
  });

  const interaction = createButtonInteraction({
    customId: `${DM_RECOMMEND_PREFIX}sel-1`,
    userId: 'user-1',
    client,
  });

  const result = await handler(interaction);
  assert.equal(result, true);
  assert.equal(searchedQueries.length, 1);
  assert.equal(searchedQueries[0].query, 'spsearch:Digital Love Daft Punk');
  assert.equal(player.queue.tracks.length, 2);
  assert.equal(player.queue.tracks[1].info.title, 'Digital Love');
  assert.equal(player.queue.tracks[1].requester.id, 'user-1');
  assert.equal(persistedPlayers.length, 1);
  assert.equal(manualSeeds.length, 1);
  assert.deepEqual(deletedSelections, ['sel-1']);

  assert.equal(interaction.replies.length, 1);
  assert.match(interaction.replies[0].content, /Queued \*\*Digital Love\*\* at #2\./);

  assert.equal(interaction.updates.length, 1);
  const updatedRow = interaction.updates[0].components[0].toJSON();
  assert.equal(updatedRow.components[0].custom_id, `${DM_RECOMMEND_PREFIX}sel-1`);
  assert.equal(updatedRow.components[0].disabled, true);
  assert.equal(updatedRow.components[1].custom_id, `${DM_RECOMMEND_PREFIX}sel-2`);
  assert.equal(updatedRow.components[1].disabled, false);
});

test('dmRecommendQueue gives a friendly reply when the queue is full or search returns no results', async () => {
  const player = {
    guildId: 'guild-1',
    voiceChannelId: 'vc-1',
    playing: true,
    paused: false,
    queue: {
      current: { info: { title: 'Now Playing', author: 'Artist' } },
      tracks: [
        { info: { title: 'Song 1', author: 'Artist' }, requester: { id: 'user-1' } },
      ],
    },
    async search() {
      return { tracks: [] };
    },
  };

  const guild = {
    id: 'guild-1',
    name: 'Bread HQ',
    voiceStates: {
      cache: new Map([['user-1', { id: 'user-1', channelId: 'vc-1' }]]),
    },
  };

  const client = {
    guilds: { cache: new Map([['guild-1', guild]]) },
    lavalink: { players: new Map([['guild-1', player]]) },
  };

  const fullHandler = createDmRecommendHandler({
    client,
    getSelection: () => ({
      tracks: [{ title: 'Aerodynamic', artist: 'Daft Punk' }],
      userId: 'user-1',
    }),
    getConfig: () => ({
      maxQueuedPerUser: 1,
      djOnlyMode: false,
      fairQueue: false,
    }),
  });

  const fullInteraction = createButtonInteraction({ userId: 'user-1', client });
  assert.equal(await fullHandler(fullInteraction), false);
  assert.equal(fullInteraction.replies.length, 1);
  assert.match(fullInteraction.replies[0].content, /already have 1 track waiting/i);

  const emptySearchHandler = createDmRecommendHandler({
    client,
    getSelection: () => ({
      tracks: [{ title: 'Nonexistent Track', artist: 'Ghost' }],
      userId: 'user-1',
    }),
    getConfig: () => ({
      maxQueuedPerUser: 0,
      djOnlyMode: false,
      fairQueue: false,
    }),
  });

  const emptyInteraction = createButtonInteraction({ userId: 'user-1', client });
  assert.equal(await emptySearchHandler(emptyInteraction), false);
  assert.equal(emptyInteraction.replies.length, 1);
  assert.match(emptyInteraction.replies[0].content, /could not find/i);
});
