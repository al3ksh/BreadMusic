const { FileStore } = require('./fileStore');
const { CommandError } = require('../utils/commandError');

const DEFAULT_CONFIG = {
  preferredSource: null,
  djRoleId: null,
  modRoleId: null,
  // null = use the command/player context, "disabled" = never send player messages.
  playerTextChannelId: null,
  maxVolume: 100,
  voteSkipPercent: 0.6,
  stayInChannel: false,
  afkTimeout: 2.5 * 60 * 1000,
  persistentQueue: false,
  twentyFourSevenChannelId: null,
  defaultVolume: 100,
  autoplay: false,
  autoplayMode: 'ai_assisted',
  activityControl: 'inherit',
  voiceChannelStatus: true,
  dashboardAccess: 'admin',
};

const AUTOPLAY_MODES = new Set(['classic', 'ai_assisted', 'discovery']);
const DASHBOARD_ACCESS_LEVELS = new Set(['admin', 'mod', 'members']);
const ACTIVITY_CONTROL_MODES = new Set(['inherit', 'admin', 'mod', 'dj', 'members']);

const OLD_DEFAULT_AFK_TIMEOUT = 5 * 60 * 1000;

const configStore = new FileStore('configs.json', {});

function normalizeVolumeConfig(config) {
  const normalized = { ...config };
  normalized.maxVolume = Math.max(10, Math.min(500, Number(normalized.maxVolume) || DEFAULT_CONFIG.maxVolume));
  normalized.defaultVolume = Math.max(0, Math.min(
    100,
    normalized.maxVolume,
    Number.isFinite(normalized.defaultVolume) ? normalized.defaultVolume : DEFAULT_CONFIG.defaultVolume,
  ));
  if (!AUTOPLAY_MODES.has(normalized.autoplayMode)) {
    normalized.autoplayMode = DEFAULT_CONFIG.autoplayMode;
  }
  // Legacy 'dj' dashboard access becomes 'mod'; the DJ role stays music-only.
  if (normalized.dashboardAccess === 'dj') {
    normalized.dashboardAccess = 'mod';
    if (!normalized.modRoleId && normalized.djRoleId) {
      normalized.modRoleId = normalized.djRoleId;
    }
  }
  if (!DASHBOARD_ACCESS_LEVELS.has(normalized.dashboardAccess)) {
    normalized.dashboardAccess = DEFAULT_CONFIG.dashboardAccess;
  }
  if (!ACTIVITY_CONTROL_MODES.has(normalized.activityControl)) {
    normalized.activityControl = DEFAULT_CONFIG.activityControl;
  }
  return normalized;
}

function getConfig(guildId) {
  if (!guildId) return { ...DEFAULT_CONFIG };
  const stored = configStore.get(guildId, {});
  const merged = normalizeVolumeConfig({ ...DEFAULT_CONFIG, ...stored });

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
  const updated = normalizeVolumeConfig({ ...getConfig(guildId), ...partial });
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
  if (!guildConfig?.djRoleId) return;
  if (hasDJPermissions(interaction.member, guildConfig)) return;
  throw new CommandError('This command requires the DJ role or Manage Guild permission.');
}

function formatConfig(config) {
  return [
    `preferredSource: ${config.preferredSource ?? 'auto'}`,
    `djRoleId: ${config.djRoleId ?? 'none'}`,
    `modRoleId: ${config.modRoleId ?? 'none'}`,
    `playerTextChannelId: ${config.playerTextChannelId === 'disabled' ? 'disabled' : config.playerTextChannelId ?? 'default'}`,
    `maxVolume: ${config.maxVolume}`,
    `voteSkipPercent: ${(config.voteSkipPercent * 100).toFixed(0)}%`,
    `stayInChannel (24/7): ${config.stayInChannel ? 'yes' : 'no'}`,
    `afkTimeout: ${(config.afkTimeout / 60000).toFixed(1)} min`,
    `persistentQueue: ${config.persistentQueue ? 'yes' : 'no'}`,
    `twentyFourSevenChannelId: ${config.twentyFourSevenChannelId ?? 'none'}`,
    `defaultVolume: ${config.defaultVolume}`,
    `autoplay: ${config.autoplay ? 'yes' : 'no'}`,
    `autoplayMode: ${config.autoplayMode}`,
    `activityControl: ${config.activityControl}`,
    `voiceChannelStatus: ${config.voiceChannelStatus ? 'yes' : 'no'}`,
    `dashboardAccess: ${config.dashboardAccess}`,
  ].join('\n');
}

function listConfigs() {
  return configStore.entries().map(([guildId, data]) => [guildId, normalizeVolumeConfig({ ...DEFAULT_CONFIG, ...data })]);
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
  normalizeVolumeConfig,
  AUTOPLAY_MODES,
  ACTIVITY_CONTROL_MODES,
};
