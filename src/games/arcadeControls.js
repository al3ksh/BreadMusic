const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const BUTTON_PREFIX = 'arcade:replay:';
const TOKEN_TTL = 10 * 60 * 1000;
const replayTokens = new Map();

function pruneTokens(now = Date.now()) {
  for (const [token, value] of replayTokens) {
    if (value.expiresAt <= now) replayTokens.delete(token);
  }
}

function issueToken(userId) {
  pruneTokens();
  const token = crypto.randomBytes(6).toString('base64url');
  replayTokens.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL });
  return token;
}

function buildReplayComponents({ game, userId, bet = 0, option = '-' }) {
  const token = issueToken(userId);
  const label = bet > 0 ? `Play again - ${bet} BREAD` : 'Play again';
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BUTTON_PREFIX}${game}:${userId}:${bet}:${option}:${token}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function parseReplayCustomId(customId) {
  if (!customId.startsWith(BUTTON_PREFIX)) return null;
  const [game, userId, betString, option, token] = customId.slice(BUTTON_PREFIX.length).split(':');
  if (!['slots', 'roulette', 'coinflip'].includes(game) || !userId || !token) return null;
  return { game, userId, bet: Math.max(0, Number.parseInt(betString, 10) || 0), option, token };
}

function consumeReplayToken(token, userId) {
  pruneTokens();
  const value = replayTokens.get(token);
  if (!value || value.userId !== userId || value.expiresAt <= Date.now()) return false;
  replayTokens.delete(token);
  return true;
}

function restoreReplayToken(token, userId) {
  replayTokens.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL });
}

module.exports = {
  BUTTON_PREFIX,
  buildReplayComponents,
  consumeReplayToken,
  parseReplayCustomId,
  restoreReplayToken,
};
