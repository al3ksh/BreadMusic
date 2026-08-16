const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

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

function createDmResponder({
  cooldownMs = DEFAULT_COOLDOWN_MS,
  supportCooldownMs = DEFAULT_SUPPORT_COOLDOWN_MS,
  followUpDelayMs = DEFAULT_FOLLOW_UP_DELAY_MS,
  dashboardUrl = 'https://breadmusic.aleksh.xyz/dashboard',
  contact = 'aleksh8',
  now = Date.now,
  random = Math.random,
  wait = waitFor,
} = {}) {
  const userReplies = new Map();
  let previousCommunityReply = '';

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

    try {
      await message.reply({
        content: pickCommunityReply(),
        allowedMentions: { parse: [] },
      });
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
