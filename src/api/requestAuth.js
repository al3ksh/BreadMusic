// Who is making a request: dashboard session or Activity bearer token.
const { createFixedWindowRateLimiter } = require('../utils/rateLimit');

const DISCORD_API = 'https://discord.com/api/v10';
const SCOPES = ['identify', 'guilds'].join(' ');
const activityAuthCache = new Map();
const ACTIVITY_AUTH_CACHE_MAX_ENTRIES = 2_000;
const ACTIVITY_AUTH_LOOKUP_TIMEOUT_MS = 5_000;
const ACTIVITY_AUTH_REJECTED_TTL_MS = 60_000;
const ACTIVITY_AUTH_PAUSE_MS = 60_000;
const ACTIVITY_AUTH_REJECTION_LIMIT = createFixedWindowRateLimiter({ windowMs: 60_000, max: 100 });
let activityLookupsPausedUntil = 0;

function getDashboardRequester(req, client) {
  const user = getRequestUser(req);
  if (user?.id) {
    return {
      id: user.id,
      username: user.username || user.global_name || 'Dashboard user',
      global_name: user.global_name || null,
      avatar: user.avatar || null,
      bot: false,
    };
  }

  return client.user ?? { id: '0', username: 'Bot', bot: true };
}

function getRequestUser(req) {
  return req.activityUser || req.session?.user || null;
}

async function resolveRequestAuth(req, resolveActivityUserImpl = resolveActivityUser) {
  const activityToken = readBearerToken(req);
  if (activityToken) {
    const activityUser = await resolveActivityUserImpl(activityToken);
    return activityUser
      ? { activityUser }
      : { error: 'Activity authentication expired' };
  }
  return req.session?.user
    ? { sessionUser: req.session.user }
    : { error: 'Not authenticated' };
}

function readBearerToken(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function pruneActivityAuthCache(now) {
  if (activityAuthCache.size <= ACTIVITY_AUTH_CACHE_MAX_ENTRIES) return;
  for (const [token, entry] of activityAuthCache) {
    if (entry.expiresAt <= now) activityAuthCache.delete(token);
  }
  while (activityAuthCache.size > ACTIVITY_AUTH_CACHE_MAX_ENTRIES) {
    activityAuthCache.delete(activityAuthCache.keys().next().value);
  }
}

// Every lookup goes to Discord from the bot's own IP, and Discord bans IPs that send too many
// rejected requests. Rejected tokens are remembered, and a flood of them pauses lookups of
// unknown tokens for a while; people already signed in keep working from the cache.
function rememberRejectedActivityToken(accessToken, now) {
  activityAuthCache.set(accessToken, { user: null, expiresAt: now + ACTIVITY_AUTH_REJECTED_TTL_MS });
  pruneActivityAuthCache(now);
  if (!ACTIVITY_AUTH_REJECTION_LIMIT.check('rejected', now).allowed) {
    activityLookupsPausedUntil = now + ACTIVITY_AUTH_PAUSE_MS;
  }
}

async function resolveActivityUser(accessToken) {
  const now = Date.now();
  const cached = activityAuthCache.get(accessToken);
  if (cached && cached.expiresAt > now) return cached.user;
  if (cached) activityAuthCache.delete(accessToken);
  if (now < activityLookupsPausedUntil) return null;

  try {
    const response = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(ACTIVITY_AUTH_LOOKUP_TIMEOUT_MS),
    });
    if (response.status === 401) {
      rememberRejectedActivityToken(accessToken, Date.now());
      return null;
    }
    if (!response.ok) return null;

    const profile = await response.json();
    if (!profile?.id) return null;

    const user = {
      id: profile.id,
      username: profile.username,
      discriminator: profile.discriminator,
      avatar: profile.avatar,
      global_name: profile.global_name || null,
      accessToken,
    };
    activityAuthCache.set(accessToken, {
      user,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    pruneActivityAuthCache(Date.now());
    return user;
  } catch {
    return null;
  }
}

function getUsableNode(client) {
  const nodes = client.lavalink?.nodeManager?.nodes;
  if (!nodes) return null;
  for (const node of nodes.values()) {
    if (node.connected) return node;
  }
  return nodes.values().next().value ?? null;
}

async function refreshAccessToken(refreshToken) {
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function buildTrustedOrigins(webUrl) {
  const candidates = [
    webUrl,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];

  const origins = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeOrigin(candidate);
    if (normalized) origins.add(normalized);
  }

  return origins;
}

module.exports = {
  DISCORD_API,
  SCOPES,
  getDashboardRequester,
  getRequestUser,
  resolveRequestAuth,
  resolveActivityUser,
  getUsableNode,
  refreshAccessToken,
  normalizeOrigin,
  buildTrustedOrigins,
};
