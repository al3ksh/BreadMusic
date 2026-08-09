const DASHBOARD_FALLBACK_BASE_URL = 'https://breadmusic.aleksh.xyz';

function getDashboardBaseUrl() {
  const candidate = process.env.DASHBOARD_URL || DASHBOARD_FALLBACK_BASE_URL;
  try {
    return new URL(candidate).origin;
  } catch {
    return DASHBOARD_FALLBACK_BASE_URL;
  }
}

function buildDashboardUrl(guildId, view = 'settings') {
  const baseUrl = getDashboardBaseUrl();
  if (!guildId) return `${baseUrl}/dashboard`;
  const viewParam = view && view !== 'settings' ? `?view=${encodeURIComponent(view)}` : '';
  return `${baseUrl}/dashboard/${guildId}${viewParam}`;
}

module.exports = {
  buildDashboardUrl,
  getDashboardBaseUrl,
};
