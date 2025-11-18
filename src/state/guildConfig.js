const { FileStore } = require('./fileStore');
const { CommandError } = require('../utils/commandError');

const DEFAULT_CONFIG = {
  preferredSource: null,
  djRoleId: null,
  maxVolume: 100,
  voteSkipPercent: 0.6,
  stayInChannel: false,
  afkTimeout: 2.5 * 60 * 1000,
  persistentQueue: true,
  twentyFourSevenChannelId: null,
  defaultVolume: 60,
  announceTracks: true,
  crossfadeSeconds: 0,
  normalizeAudio: false,
  autoplay: false,
  announceChannelId: null,
};

const OLD_DEFAULT_AFK_TIMEOUT = 5 * 60 * 1000;

const configStore = new FileStore('configs.json', {});

function getConfig(guildId) {
  if (!guildId) return { ...DEFAULT_CONFIG };
  const stored = configStore.get(guildId, {});
  const merged = { ...DEFAULT_CONFIG, ...stored };

  let shouldPersist = false;
  if (typeof stored.afkTimeout === 'undefined') {
    shouldPersist = true;
  } else if (stored.afkTimeout === OLD_DEFAULT_AFK_TIMEOUT) {
    merged.afkTimeout = DEFAULT_CONFIG.afkTimeout;
    shouldPersist = true;
  }

  if (shouldPersist) {
    configStore.set(guildId, { ...stored, afkTimeout: merged.afkTimeout });
  }

  return merged;
}

function setConfig(guildId, partial) {
  if (!guildId) return;
  const updated = { ...getConfig(guildId), ...partial };
  configStore.set(guildId, updated);
  return updated;
}

function deleteConfig(guildId) {
  configStore.delete(guildId);
}

function hasDJPermissions(member, guildConfig) {
  if (!member) return false;
  if (member.permissions.has('Administrator')) return true;
  if (guildConfig.djRoleId && member.roles.cache.has(guildConfig.djRoleId)) {
    return true;
  }

  if (member.permissions.has('ManageGuild') || member.permissions.has('MuteMembers')) {
    return true;
  }

  return false;
}

function assertDJ(interaction, guildConfig) {
  if (hasDJPermissions(interaction.member, guildConfig)) return;
  throw new CommandError('This command requires the DJ role or Manage Guild permission.');
}

function formatConfig(config) {
  return [
    `preferredSource: ${config.preferredSource ?? 'auto'}`,
    `djRoleId: ${config.djRoleId ?? 'none'}`,
    `maxVolume: ${config.maxVolume}`,
    `voteSkipPercent: ${(config.voteSkipPercent * 100).toFixed(0)}%`,
    `stayInChannel (24/7): ${config.stayInChannel ? 'yes' : 'no'}`,
    `afkTimeout: ${(config.afkTimeout / 60000).toFixed(1)} min`,
    `persistentQueue: ${config.persistentQueue ? 'yes' : 'no'}`,
    `twentyFourSevenChannelId: ${config.twentyFourSevenChannelId ?? 'none'}`,
    `announceChannelId: ${config.announceChannelId ?? 'none'}`,
    `defaultVolume: ${config.defaultVolume}`,
    `crossfadeSeconds: ${config.crossfadeSeconds}`,
    `normalizeAudio: ${config.normalizeAudio ? 'yes' : 'no'}`,
    `autoplay: ${config.autoplay ? 'yes' : 'no'}`,
  ].join('\n');
}

function listConfigs() {
  return configStore.entries().map(([guildId, data]) => [guildId, { ...DEFAULT_CONFIG, ...data }]);
}

module.exports = {
  getConfig,
  setConfig,
  deleteConfig,
  hasDJPermissions,
  assertDJ,
  formatConfig,
  listConfigs,
  DEFAULT_CONFIG,
};
