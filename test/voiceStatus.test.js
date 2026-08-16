const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clearVoiceTrackStatus,
  handleVoiceStatusGatewayEvent,
  setVoiceTrackStatus,
} = require('../src/music/voiceStatus');

test('voice status preserves and restores an existing channel status', async () => {
  const updates = [];
  const guildId = 'guild-status-test';
  const channelId = 'channel-status-test';
  const client = {
    guilds: { cache: new Map([[guildId, { shardId: 0 }]]) },
    rest: {
      async put(route, payload) {
        updates.push({ route, status: payload.body.status });
      },
    },
    ws: {
      shards: new Map([[0, {
        send() {
          setImmediate(() => handleVoiceStatusGatewayEvent({
            t: 'CHANNEL_INFO',
            d: {
              guild_id: guildId,
              channels: [{ id: channelId, status: 'Gaming night' }],
            },
          }));
        },
      }]]),
    },
  };
  const player = { guildId, voiceChannelId: channelId };
  const track = { info: { title: 'Test track', sourceName: 'youtube' } };

  await setVoiceTrackStatus(client, player, track);
  await clearVoiceTrackStatus(client, player);
  await clearVoiceTrackStatus(client, player);

  assert.deepEqual(updates, [
    { route: `/channels/${channelId}/voice-status`, status: 'Gaming night • ♪ Bread' },
    { route: `/channels/${channelId}/voice-status`, status: 'Gaming night' },
  ]);
});
