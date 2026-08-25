const DASHBOARD_ACCESS_LEVELS = new Set(['admin', 'mod', 'members']);
const ACTIVITY_CONTROL_MODES = new Set(['inherit', 'admin', 'mod', 'dj', 'members']);

function normalizeDashboardAccess(value) {
  if (value === 'dj') return 'mod'; // legacy: the DJ role is music-only now
  return DASHBOARD_ACCESS_LEVELS.has(value) ? value : 'admin';
}

function isGuildAdmin(member) {
  return Boolean(
    member?.permissions?.has?.('Administrator') ||
    member?.permissions?.has?.('ManageGuild'),
  );
}

function isGuildMod(member, config) {
  if (!member) return false;
  if (isGuildAdmin(member)) return true;
  const modRoleId = config?.modRoleId;
  return Boolean(modRoleId && member.roles?.cache?.has?.(modRoleId));
}

function isGuildDJ(member, config) {
  if (!member) return false;
  if (isGuildAdmin(member)) return true;
  if (!config?.djRoleId) return true;
  if (config?.djRoleId && member.roles?.cache?.has?.(config.djRoleId)) return true;
  return Boolean(member.permissions?.has?.('MuteMembers'));
}

function resolveActivityControlPolicy(config) {
  const configured = ACTIVITY_CONTROL_MODES.has(config?.activityControl)
    ? config.activityControl
    : 'inherit';
  return configured === 'inherit' ? normalizeDashboardAccess(config?.dashboardAccess) : configured;
}

function memberMeetsActivityPolicy(member, config, policy) {
  switch (policy) {
    case 'admin': return isGuildAdmin(member);
    case 'mod': return isGuildMod(member, config);
    case 'dj': return isGuildDJ(member, config);
    case 'members': return true;
    default: return false;
  }
}

function resolveDashboardCapabilities(member, config) {
  const configuredAccess = normalizeDashboardAccess(config?.dashboardAccess);
  const admin = isGuildAdmin(member);
  const isMod = isGuildMod(member, config);
  const isDJ = isGuildDJ(member, config);
  const memberAllowed = configuredAccess === 'members';
  const modAllowed = configuredAccess === 'mod' || memberAllowed;
  const canAccess = admin || (modAllowed && isMod) || memberAllowed;
  const musicTrusted = admin || isMod || isDJ;
  const maxVolume = Number.isFinite(config?.maxVolume)
    ? Math.max(10, Math.min(500, config.maxVolume))
    : 100;

  return {
    accessLevel: admin ? 'admin' : isMod ? 'mod' : 'member',
    dashboardAccess: configuredAccess,
    canAccess,
    canView: canAccess,
    // Visibility and control are separate policies. Dashboard entry follows
    // the admin/mod/members levels; the DJ role stays music-side but keeps
    // granting player control to members who already have dashboard access.
    canControlPlayer: canAccess && musicTrusted,
    canUpload: canAccess && musicTrusted,
    canManageConfig: admin,
    canManageEconomy: admin,
    canUseRemoteControl: admin || isMod,
    maxVolume,
  };
}

function resolveActivityCapabilities(member, config, voiceContext = {}) {
  const capabilities = resolveDashboardCapabilities(member, config);
  const raw = ACTIVITY_CONTROL_MODES.has(config?.activityControl)
    ? config.activityControl
    : 'inherit';

  let canControlPlayer;
  if (raw === 'inherit') {
    // Inherit keeps the exact dashboard rule: entry to the dashboard plus
    // the admin/mod/DJ music-trust check.
    canControlPlayer = capabilities.canControlPlayer;
  } else {
    // Explicit activity policies are independent of dashboard entry.
    canControlPlayer = memberMeetsActivityPolicy(member, config, raw);
  }

  // Control is tied to listening along in the same voice channel.
  // When the caller supplies voice context, members who left the channel
  // (or never joined it) keep a read-only view.
  if (canControlPlayer && Object.prototype.hasOwnProperty.call(voiceContext, 'memberVoiceChannelId')) {
    const memberVoiceChannelId = voiceContext.memberVoiceChannelId ?? null;
    const botVoiceChannelId = voiceContext.botVoiceChannelId ?? null;
    const inBotVoice = Boolean(memberVoiceChannelId)
      && (!botVoiceChannelId || memberVoiceChannelId === botVoiceChannelId);
    if (!inBotVoice) canControlPlayer = false;
  }

  return {
    ...capabilities,
    canAccess: true,
    canView: true,
    canControlPlayer,
    activityPolicy: raw === 'inherit' ? normalizeDashboardAccess(config?.dashboardAccess) : raw,
  };
}

module.exports = {
  DASHBOARD_ACCESS_LEVELS,
  ACTIVITY_CONTROL_MODES,
  normalizeDashboardAccess,
  isGuildAdmin,
  isGuildMod,
  isGuildDJ,
  resolveActivityControlPolicy,
  resolveActivityCapabilities,
  resolveDashboardCapabilities,
};
