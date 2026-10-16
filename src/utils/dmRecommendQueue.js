// @ts-check
const {
  ActionRowBuilder,
  ButtonBuilder,
} = require('discord.js');
const { getSelection: defaultGetSelection, deleteSelection: defaultDeleteSelection } = require('../state/searchCache');
const { getConfig: defaultGetConfig } = require('../state/guildConfig');
const { applyPreferredSource: defaultApplyPreferredSource } = require('../music/searchUtils');
const {
  queueRequestedTracks: defaultQueueRequestedTracks,
  fitQueueLimit: defaultFitQueueLimit,
  findQueuedCopy: defaultFindQueuedCopy,
  describeQueuedCopy: defaultDescribeQueuedCopy,
} = require('../music/queueInsert');
const { tagOrigin: defaultTagOrigin } = require('../music/trackOrigin');
const { addManualSeed: defaultAddManualSeed } = require('../music/autoplay');
const { savePlayerState } = require('../state/queueStore');
const { findSharedVoiceSession: defaultFindVoiceSession } = require('./dmPersona');

const DM_RECOMMEND_PREFIX = 'dmrec:';
const DM_RECOMMEND_TTL_MS = 10 * 60 * 1000;
const MAX_BUTTON_LABEL_LENGTH = 80;
const QUEUE_FULL = 'Your queue limit is full right now. Let a track finish first.';

function formatPickButtonLabel(pick) {
  const title = String(pick?.title || '').replace(/\s+/g, ' ').trim();
  const artist = String(pick?.artist || '').replace(/\s+/g, ' ').trim();
  const raw = artist ? `${title} - ${artist}` : title;
  if (raw.length <= MAX_BUTTON_LABEL_LENGTH) return raw || 'Recommended track';
  return `${raw.slice(0, MAX_BUTTON_LABEL_LENGTH - 3).trimEnd()}...`;
}

// Rebuilds the DM's button rows with the clicked pick disabled.
function disableClickedButtonRows(message, clickedCustomId) {
  return (message?.components ?? []).map((row) => new ActionRowBuilder().addComponents(
    row.components.map((component) => {
      const button = ButtonBuilder.from(component);
      const data = /** @type {{ custom_id?: string, disabled?: boolean }} */ (button.toJSON());
      return button.setDisabled(Boolean(data.disabled) || data.custom_id === clickedCustomId);
    }),
  ));
}

function createDmRecommendHandler(baseDeps = {}) {
  return async function handleDmRecommendButton(interaction, callDeps = {}) {
    /** @type {Record<string, any>} */
    const deps = { ...baseDeps, ...callDeps };
    const getSelection = deps.getSelection ?? defaultGetSelection;
    const deleteSelection = deps.deleteSelection ?? defaultDeleteSelection;
    const findVoiceSession = deps.findVoiceSession ?? defaultFindVoiceSession;
    const getConfig = deps.getConfig ?? defaultGetConfig;
    const applyPreferredSource = deps.applyPreferredSource ?? defaultApplyPreferredSource;
    const fitQueueLimit = deps.fitQueueLimit ?? defaultFitQueueLimit;
    const queueRequestedTracks = deps.queueRequestedTracks ?? defaultQueueRequestedTracks;
    const findQueuedCopy = deps.findQueuedCopy ?? defaultFindQueuedCopy;
    const describeQueuedCopy = deps.describeQueuedCopy ?? defaultDescribeQueuedCopy;
    const tagOrigin = deps.tagOrigin ?? defaultTagOrigin;
    const addManualSeed = deps.addManualSeed ?? defaultAddManualSeed;
    const queuePersist = deps.queuePersist ?? savePlayerState;
    const client = deps.client ?? interaction.client;
    const customId = interaction.customId;

    const say = (content) => interaction.reply({ content, allowedMentions: { parse: [] } }).catch(() => {});
    // Success: grey out the used button, then confirm underneath.
    const done = async (content) => {
      await interaction.update({ components: disableClickedButtonRows(interaction.message, customId) }).catch(() => {});
      await interaction.followUp({ content, allowedMentions: { parse: [] } }).catch(() => {});
    };

    try {
      const selectionId = customId.slice(DM_RECOMMEND_PREFIX.length);
      const selection = getSelection(selectionId);
      const pick = selection?.tracks?.[0];
      if (!pick?.title) return say('That suggestion went stale. Ask me for fresh picks.').then(() => false);

      const userId = interaction.user.id;
      if (selection.userId !== userId) return say('Those picks were baked for someone else.').then(() => false);

      // Never joins voice from a DM: only an existing player in the user's own channel counts.
      const session = findVoiceSession(client, userId);
      if (!session?.player) return say('Join a voice channel where I am already playing first.').then(() => false);

      const { player, member } = session;
      const guildId = player.guildId;
      const config = getConfig(guildId);

      try {
        fitQueueLimit(player, [{}], { userId, member, config });
      } catch (error) {
        return say(error?.message || QUEUE_FULL).then(() => false);
      }

      const query = applyPreferredSource(`${pick.title} ${pick.artist || ''}`.trim(), config, client?.lavalink?.options?.playerOptions?.defaultSearchPlatform);
      const searchResult = await player.search(query, interaction.user).catch(() => null);
      const track = searchResult?.tracks?.[0];
      if (!track) return say(`Could not find a playable match for **${pick.title}**.`).then(() => false);

      track.requester ??= interaction.user;
      tagOrigin(track, 'search');

      const copyPosition = findQueuedCopy(player, track);
      if (copyPosition !== null) {
        deleteSelection(selectionId);
        await done(describeQueuedCopy(track, copyPosition));
        return true;
      }

      const [toQueue] = fitQueueLimit(player, [track], { userId, member, config }).tracks;
      if (!toQueue) return say(QUEUE_FULL).then(() => false);

      addManualSeed(guildId, toQueue);
      await queueRequestedTracks(player, toQueue, { fair: config.fairQueue, next: false });
      if (!player.playing && !player.paused) await player.play();
      await queuePersist(player);
      await client?.musicUI?.refresh?.(player)?.catch?.(() => {});
      deps.broadcastPlayerUpdate?.(guildId);
      deleteSelection(selectionId);

      await done(`Queued **${toQueue.info?.title || pick.title}** at #${player.queue.tracks.indexOf(toQueue) + 1}.`);
      return true;
    } catch {
      await say('Could not queue that pick right now. Try again in a moment.');
      return false;
    }
  };
}

const handleDmRecommendButton = createDmRecommendHandler();

module.exports = {
  DM_RECOMMEND_PREFIX,
  DM_RECOMMEND_TTL_MS,
  createDmRecommendHandler,
  disableClickedButtonRows,
  formatPickButtonLabel,
};
module.exports.handleDmRecommendButton = handleDmRecommendButton;
