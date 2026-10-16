// @ts-check
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { createSelection: defaultCreateSelection } = require('../state/searchCache');
const { getVoiceContext: defaultGetVoiceContext, validatePersonaPicks } = require('./dmPersona');
const {
  DM_RECOMMEND_PREFIX,
  DM_RECOMMEND_TTL_MS,
  formatPickButtonLabel,
} = require('./dmRecommendQueue');

const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_SUPPORT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_FOLLOW_UP_DELAY_MS = 5_000;
const MAX_TRACKED_USERS = 1_000;
const BRAND_COLOR = 0x6e599a;

const COMMUNITY_REPLIES = [
  'Chat, is this real?',
  'Mods are asleep. Deploying customer support...',
  'Good message. Wrong inbox.',
  'The council is reviewing your DM. The council is one loaf of bread.',
  'Copium reserves are stable. Checking the important part now...',
  'This DM has been ratioed by a music bot.',
  'Certified skill issue. Recalculating...',
  'I checked the source. The source said trust me.',
  'One moment, the bread is buffering...',
  'This interaction has been reviewed by absolutely nobody.',
  'Support diff detected. Preparing the useful answer...',
  'Your message reached the aux cord committee.',
  'The message was received. The command was not.',
  'You have reached Bread after dark. The dashboard is still awake.',
  'A moderator has been notified. Unfortunately, it was me.',
  'No command found, but the vibes passed validation.',
  'Your ticket number is 404. This is not a coincidence.',
  'The queue heard you. It chose not to comment.',
  'DM support is currently running on thoughts and prayers.',
  'Bread is sentient enough to reply, not enough to troubleshoot.',
];

function waitFor(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function buildRecommendationRow(picks, userId, createSelection) {
  const buttons = picks.slice(0, 3).map((pick) => {
    const selectionId = createSelection([pick], userId, null, DM_RECOMMEND_TTL_MS);
    return new ButtonBuilder()
      .setCustomId(`${DM_RECOMMEND_PREFIX}${selectionId}`)
      .setLabel(formatPickButtonLabel(pick))
      .setStyle(ButtonStyle.Secondary);
  });
  return new ActionRowBuilder().addComponents(buttons);
}

function createDmResponder({
  cooldownMs = DEFAULT_COOLDOWN_MS,
  supportCooldownMs = DEFAULT_SUPPORT_COOLDOWN_MS,
  followUpDelayMs = DEFAULT_FOLLOW_UP_DELAY_MS,
  dashboardUrl = 'https://breadmusic.aleksh.xyz/dashboard',
  contact = 'aleksh8',
  now = Date.now,
  random = Math.random,
  wait = waitFor,
  persona = null,
  getTasteHints = null,
  getVoiceContext = null,
  createSelection = defaultCreateSelection,
} = {}) {
  const userReplies = new Map();
  let previousCommunityReply = '';
  const replyWithPersona = typeof persona?.reply === 'function'
    ? persona.reply.bind(persona)
    : typeof persona === 'function'
      ? persona
      : null;

  function pickCommunityReply() {
    let index = Math.floor(random() * COMMUNITY_REPLIES.length);
    if (COMMUNITY_REPLIES.length > 1 && COMMUNITY_REPLIES[index] === previousCommunityReply) {
      index = (index + 1) % COMMUNITY_REPLIES.length;
    }
    previousCommunityReply = COMMUNITY_REPLIES[index];
    return previousCommunityReply;
  }

  return async function handleDirectMessage(message) {
    if (!message || message.guildId || message.author?.bot || typeof message.reply !== 'function') return false;

    const userId = message.author?.id;
    if (!userId) return false;

    const timestamp = now();
    const previous = userReplies.get(userId);
    if (previous && timestamp - previous.jokeAt < cooldownMs) return false;

    if (userReplies.size >= MAX_TRACKED_USERS) {
      const oldestUserId = userReplies.keys().next().value;
      if (oldestUserId) userReplies.delete(oldestUserId);
    }
    const shouldSendSupport = !previous || timestamp - previous.supportAt >= supportCooldownMs;
    userReplies.delete(userId);
    userReplies.set(userId, {
      jokeAt: timestamp,
      supportAt: shouldSendSupport ? timestamp : previous.supportAt,
    });

    let replyContent = null;
    let replyPicks = [];
    if (replyWithPersona) {
      await message.channel?.sendTyping?.().catch(() => {});
      let tasteHints = [];
      if (typeof getTasteHints === 'function' && random() < 1 / 3) {
        try {
          const resolvedHints = await getTasteHints(userId);
          if (Array.isArray(resolvedHints)) tasteHints = resolvedHints;
        } catch {
          tasteHints = [];
        }
      }
      let nowPlaying = null;
      const resolveVoiceContext = typeof getVoiceContext === 'function'
        ? getVoiceContext
        : (uid) => defaultGetVoiceContext(message.client, uid);
      try {
        nowPlaying = await resolveVoiceContext(userId);
      } catch {
        nowPlaying = null;
      }
      try {
        const userName =
          message.author?.globalName ||
          message.author?.displayName ||
          message.author?.username ||
          '';
        const personaReply = await replyWithPersona({
          text: typeof message.content === 'string' ? message.content : '',
          userName,
          tasteHints,
          nowPlaying: nowPlaying ?? null,
        });
        if (typeof personaReply === 'string' && personaReply.trim()) {
          replyContent = personaReply.trim();
        } else if (personaReply && typeof personaReply === 'object') {
          const textCandidate = typeof personaReply.text === 'string'
            ? personaReply.text.trim()
            : typeof personaReply.reply === 'string'
              ? personaReply.reply.trim()
              : '';
          if (textCandidate) {
            replyContent = textCandidate;
            replyPicks = validatePersonaPicks(personaReply.picks);
          }
        }
      } catch {
        replyContent = null;
        replyPicks = [];
      }
    }

    if (!replyContent) {
      replyContent = pickCommunityReply();
      replyPicks = [];
    }

    /** @type {Record<string, any>} */
    const replyPayload = {
      content: replyContent,
      allowedMentions: { parse: [] },
    };
    if (replyPicks.length > 0) {
      replyPayload.components = [buildRecommendationRow(replyPicks, userId, createSelection)];
    }

    try {
      await message.reply(replyPayload);
    } catch (error) {
      const current = userReplies.get(userId);
      if (current?.jokeAt === timestamp) {
        if (previous) userReplies.set(userId, previous);
        else userReplies.delete(userId);
      }
      throw error;
    }

    if (!shouldSendSupport) return true;

    await message.channel?.sendTyping?.().catch(() => {});
    await wait(followUpDelayMs);

    const avatarUrl = message.client?.user?.displayAvatarURL?.({ size: 256 }) || null;
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('Bread Support')
      .setDescription('Bread does not accept commands in DMs.')
      .addFields(
        {
          name: 'Use Bread',
          value: 'Run `/help` inside a Discord server to see the available commands.',
        },
        {
          name: 'Dashboard',
          value: 'Manage playback, queues and settings from the web dashboard.',
        },
        {
          name: 'Need help?',
          value: `Send a DM to **${contact}**.`,
        },
      )
      .setFooter({ text: 'Commands only work inside Discord servers.' });
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    const components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Open Dashboard')
          .setURL(dashboardUrl)
          .setStyle(ButtonStyle.Link),
      ),
    ];

    try {
      await message.channel.send({
        embeds: [embed],
        components,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      const current = userReplies.get(userId);
      if (current?.supportAt === timestamp) {
        userReplies.set(userId, { ...current, supportAt: previous?.supportAt || 0 });
      }
      throw error;
    }
    return true;
  };
}

module.exports = {
  COMMUNITY_REPLIES,
  createDmResponder,
};
