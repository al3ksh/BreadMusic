const DASHBOARD_ACCESS_LEVELS = new Set(['admin', 'dj', 'members']);

function normalizeDashboardAccess(value) {
  return DASHBOARD_ACCESS_LEVELS.has(value) ? value : 'admin';
}

function isGuildAdmin(member) {
  return Boolean(
    member?.permissions?.has?.('Administrator') ||
    member?.permissions?.has?.('ManageGuild'),
  );
}

function isGuildDJ(member, config) {
  if (!member) return false;
  if (isGuildAdmin(member)) return true;
  if (!config?.djRoleId) return true;
  if (config?.djRoleId && member.roles?.cache?.has?.(config.djRoleId)) return true;
  return Boolean(member.permissions?.has?.('MuteMembers'));
}

function resolveDashboardCapabilities(member, config) {
  const configuredAccess = normalizeDashboardAccess(config?.dashboardAccess);
  const admin = isGuildAdmin(member);
  const dj = isGuildDJ(member, config);
  const memberAllowed = configuredAccess === 'members';
  const djAllowed = configuredAccess === 'dj' || memberAllowed;
  const canAccess = admin || (djAllowed && dj) || memberAllowed;
  const maxVolume = Number.isFinite(config?.maxVolume)
    ? Math.max(10, Math.min(500, config.maxVolume))
    : 100;

  return {
    accessLevel: admin ? 'admin' : dj ? 'dj' : 'member',
    dashboardAccess: configuredAccess,
    canAccess,
    canView: canAccess,
    // Visibility and control are separate policies. With no configured DJ
    // role, isGuildDJ intentionally treats every member as a DJ.
    canControlPlayer: admin || dj,
    canUpload: admin || (djAllowed && dj),
    canManageConfig: admin,
    canManageEconomy: admin,
    canUseRemoteControl: admin,
    maxVolume,
  };
}

function resolveActivityCapabilities(member, config) {
  const capabilities = resolveDashboardCapabilities(member, config);
  return {
    ...capabilities,
    canAccess: true,
    canView: true,
  };
}

module.exports = {
  DASHBOARD_ACCESS_LEVELS,
  normalizeDashboardAccess,
  isGuildAdmin,
  isGuildDJ,
  resolveActivityCapabilities,
  resolveDashboardCapabilities,
};
