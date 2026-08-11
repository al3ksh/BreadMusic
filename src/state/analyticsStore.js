const { FileStore } = require('./fileStore');
const { normalizeSourceName } = require('../music/sourceNames');

const analyticsStore = new FileStore('analytics.json', {});

const MAX_TRACKS_PER_GUILD = 1200;
const MAX_USERS_PER_GUILD = 1200;
const MAX_EVENTS_PER_GUILD = 40_000;
const EVENT_RETENTION_DAYS = 35;
const TREND_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;
const RANGE_ALL = 'all';
const RANGE_24H = '24h';
const RANGE_7D = '7d';
const RANGE_CHOICES = new Set([RANGE_ALL, RANGE_24H, RANGE_7D]);

function ensureGuildBucket(guildId) {
  const fallback = {
    summary: {
      totalPlays: 0,
      lastPlayAt: null,
    },
    tracks: {},
    users: {},
    events: [],
  };

  const current = analyticsStore.get(guildId, null);
  if (!current || typeof current !== 'object') {
    analyticsStore.set(guildId, fallback);
    return fallback;
  }

  if (!current.summary || typeof current.summary !== 'object') {
    current.summary = { totalPlays: 0, lastPlayAt: null };
  }
  if (!current.tracks || typeof current.tracks !== 'object') {
    current.tracks = {};
  }
  if (!current.users || typeof current.users !== 'object') {
    current.users = {};
  }
  if (!Array.isArray(current.events)) {
    current.events = [];
  }
  if (!Number.isFinite(current.summary.totalPlays)) {
    current.summary.totalPlays = Object.values(current.tracks).reduce((sum, entry) => sum + (entry.count || 0), 0);
  }
  if (!Number.isFinite(current.summary.lastPlayAt)) {
    current.summary.lastPlayAt = null;
  }

  return current;
}

function makeTrackKey(info = {}) {
  const identifier = typeof info.identifier === 'string' ? info.identifier.trim() : '';
  if (identifier) return `id:${identifier}`;

  const uri = typeof info.uri === 'string' ? info.uri.trim() : '';
  if (uri) return `uri:${uri}`;

  const title = typeof info.title === 'string' ? info.title.trim() : 'Unknown';
  const author = typeof info.author === 'string' ? info.author.trim() : 'Unknown';
  return `meta:${title}:${author}`.slice(0, 260);
}

function normalizeTrackInfo(track) {
  const info = track?.info || {};
  return {
    title: typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'Unknown',
    author: typeof info.author === 'string' && info.author.trim() ? info.author.trim() : 'Unknown',
    uri: typeof info.uri === 'string' ? info.uri : '',
    duration: Number.isFinite(info.duration) ? info.duration : 0,
    artwork: extractArtwork(info),
    source: normalizeSourceName(info),
  };
}

function extractArtwork(info = {}) {
  if (typeof info.artworkUrl === 'string' && info.artworkUrl) return info.artworkUrl;
  if (
    typeof info.uri === 'string' &&
    info.uri &&
    (info.uri.includes('youtube.com') || info.uri.includes('youtu.be')) &&
    typeof info.identifier === 'string' &&
    info.identifier
  ) {
    return `https://img.youtube.com/vi/${info.identifier}/mqdefault.jpg`;
  }
  return null;
}

function toAvatarUrl(requester) {
  if (!requester || typeof requester !== 'object') return null;

  if (typeof requester.displayAvatarURL === 'function') {
    try {
      return requester.displayAvatarURL({ size: 64 });
    } catch {
      return null;
    }
  }

  if (typeof requester.avatarURL === 'function') {
    try {
      return requester.avatarURL({ size: 64 });
    } catch {
      return null;
    }
  }

  if (typeof requester.avatar === 'string' && requester.avatar && requester.id) {
    return `https://cdn.discordapp.com/avatars/${requester.id}/${requester.avatar}.png?size=64`;
  }

  return null;
}

function normalizeRequester(requester) {
  if (!requester) return null;

  if (typeof requester === 'string') {
    return {
      id: requester,
      username: requester,
      displayName: requester,
      avatar: null,
      isBot: false,
    };
  }

  if (typeof requester !== 'object') return null;

  const id = typeof requester.id === 'string' ? requester.id : null;
  if (!id) return null;

  const username =
    (typeof requester.username === 'string' && requester.username) ||
    (typeof requester.tag === 'string' && requester.tag) ||
    `User ${id}`;

  const displayName =
    (typeof requester.globalName === 'string' && requester.globalName) ||
    (typeof requester.global_name === 'string' && requester.global_name) ||
    username;

  return {
    id,
    username,
    displayName,
    avatar: toAvatarUrl(requester),
    isBot: Boolean(requester.bot),
  };
}

function pruneEntries(map, limit) {
  const entries = Object.entries(map);
  if (entries.length <= limit) return;

  entries.sort(([, a], [, b]) => {
    const byCount = (a.count || 0) - (b.count || 0);
    if (byCount !== 0) return byCount;
    return (a.lastPlayedAt || 0) - (b.lastPlayedAt || 0);
  });

  const removeCount = entries.length - limit;
  for (let i = 0; i < removeCount; i += 1) {
    delete map[entries[i][0]];
  }
}

function normalizeRange(range) {
  const value = typeof range === 'string' ? range.trim().toLowerCase() : RANGE_ALL;
  return RANGE_CHOICES.has(value) ? value : RANGE_ALL;
}

function getRangeStartTimestamp(range, now) {
  if (range === RANGE_24H) return now - 24 * 60 * 60 * 1000;
  if (range === RANGE_7D) return now - 7 * DAY_MS;
  return null;
}

function pruneEvents(events, now) {
  if (!Array.isArray(events) || events.length === 0) return [];

  const cutoff = now - EVENT_RETENTION_DAYS * DAY_MS;
  const cleaned = events.filter((event) => (
    Number.isFinite(event?.ts) &&
    event.ts >= cutoff &&
    typeof event.trackKey === 'string' &&
    event.trackKey
  ));

  if (cleaned.length <= MAX_EVENTS_PER_GUILD) return cleaned;
  return cleaned.slice(cleaned.length - MAX_EVENTS_PER_GUILD);
}

function buildRangeAggregates(events, startTimestamp = null) {
  const tracks = {};
  const users = {};
  let totalPlays = 0;
  let lastPlayAt = null;

  for (const event of events || []) {
    const ts = event?.ts;
    if (!Number.isFinite(ts)) continue;
    if (startTimestamp !== null && ts < startTimestamp) continue;

    totalPlays += 1;
    if (!lastPlayAt || ts > lastPlayAt) {
      lastPlayAt = ts;
    }

    const trackKey = event?.trackKey;
    if (typeof trackKey === 'string' && trackKey) {
      const trackAggregate = tracks[trackKey] || { count: 0, lastPlayedAt: null };
      trackAggregate.count += 1;
      trackAggregate.lastPlayedAt = !trackAggregate.lastPlayedAt || ts > trackAggregate.lastPlayedAt
        ? ts
        : trackAggregate.lastPlayedAt;
      tracks[trackKey] = trackAggregate;
    }

    const userId = event?.userId;
    if (typeof userId === 'string' && userId) {
      const userAggregate = users[userId] || { count: 0, lastPlayedAt: null };
      userAggregate.count += 1;
      userAggregate.lastPlayedAt = !userAggregate.lastPlayedAt || ts > userAggregate.lastPlayedAt
        ? ts
        : userAggregate.lastPlayedAt;
      users[userId] = userAggregate;
    }
  }

  return {
    tracks,
    users,
    totalPlays,
    lastPlayAt,
  };
}

function sortAggregateEntries(a, b) {
  const byCount = (b[1]?.count || 0) - (a[1]?.count || 0);
  if (byCount !== 0) return byCount;
  return (b[1]?.lastPlayedAt || 0) - (a[1]?.lastPlayedAt || 0);
}

function parseTrackKeyFallback(trackKey) {
  if (typeof trackKey !== 'string') {
    return { title: 'Unknown', author: 'Unknown' };
  }

  if (trackKey.startsWith('meta:')) {
    const payload = trackKey.slice(5);
    const splitIndex = payload.lastIndexOf(':');
    if (splitIndex > 0) {
      return {
        title: payload.slice(0, splitIndex) || 'Unknown',
        author: payload.slice(splitIndex + 1) || 'Unknown',
      };
    }
  }

  return { title: 'Unknown', author: 'Unknown' };
}

function buildTopTracksFromRange(rangeTracks, tracksMap, limit) {
  return Object.entries(rangeTracks)
    .sort(sortAggregateEntries)
    .slice(0, limit)
    .map(([trackKey, aggregate], index) => {
      const stored = tracksMap[trackKey] || {};
      const fallback = parseTrackKeyFallback(trackKey);

      return {
        rank: index + 1,
        key: trackKey,
        title: stored.title || fallback.title,
        author: stored.author || fallback.author,
        uri: stored.uri || '',
        duration: Number.isFinite(stored.duration) ? stored.duration : 0,
        artwork: stored.artwork || null,
        count: Number.isFinite(aggregate?.count) ? aggregate.count : 0,
        lastPlayedAt: Number.isFinite(aggregate?.lastPlayedAt) ? aggregate.lastPlayedAt : null,
      };
    });
}

function buildTopUsersFromRange(rangeUsers, usersMap, limit) {
  return Object.entries(rangeUsers)
    .sort(sortAggregateEntries)
    .slice(0, limit)
    .map(([userId, aggregate], index) => {
      const stored = usersMap[userId] || {};

      return {
        rank: index + 1,
        userId,
        username: stored.username || 'unknown',
        displayName: stored.displayName || stored.username || `User ${userId}`,
        avatar: stored.avatar || null,
        count: Number.isFinite(aggregate?.count) ? aggregate.count : 0,
        lastPlayedAt: Number.isFinite(aggregate?.lastPlayedAt) ? aggregate.lastPlayedAt : null,
      };
    });
}

function toUtcDayStart(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function toDayKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDayLabel(timestamp) {
  const date = new Date(timestamp);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}-${day}`;
}

function buildTrend14d(events, now) {
  const startDay = toUtcDayStart(now) - (TREND_DAYS - 1) * DAY_MS;
  const dayCounts = {};

  for (const event of events || []) {
    if (!Number.isFinite(event?.ts) || event.ts < startDay) continue;
    const key = toDayKey(event.ts);
    dayCounts[key] = (dayCounts[key] || 0) + 1;
  }

  const trend = [];
  for (let index = 0; index < TREND_DAYS; index += 1) {
    const timestamp = startDay + index * DAY_MS;
    const dateKey = toDayKey(timestamp);
    trend.push({
      dateKey,
      label: toDayLabel(timestamp),
      count: dayCounts[dateKey] || 0,
    });
  }

  return trend;
}

function recordTrackPlay(guildId, track, options = {}) {
  if (!guildId || !track) return;

  const now = Date.now();
  const guild = ensureGuildBucket(guildId);
  const normalizedTrack = normalizeTrackInfo(track);
  const trackKey = makeTrackKey(track.info || {});

  const previousTrack = guild.tracks[trackKey] || {
    key: trackKey,
    title: normalizedTrack.title,
    author: normalizedTrack.author,
    uri: normalizedTrack.uri,
    duration: normalizedTrack.duration,
    artwork: normalizedTrack.artwork,
    source: normalizedTrack.source,
    count: 0,
    lastPlayedAt: null,
  };

  guild.tracks[trackKey] = {
    ...previousTrack,
    title: normalizedTrack.title || previousTrack.title,
    author: normalizedTrack.author || previousTrack.author,
    uri: normalizedTrack.uri || previousTrack.uri,
    duration: normalizedTrack.duration || previousTrack.duration,
    artwork: normalizedTrack.artwork || previousTrack.artwork || null,
    source: normalizedTrack.source || previousTrack.source || null,
    count: (previousTrack.count || 0) + 1,
    lastPlayedAt: now,
  };

  pruneEntries(guild.tracks, MAX_TRACKS_PER_GUILD);

  const requester = normalizeRequester(track.requester);
  const botUserId = typeof options.botUserId === 'string' ? options.botUserId : null;

  if (requester && requester.id && !requester.isBot && requester.id !== botUserId) {
    const previousUser = guild.users[requester.id] || {
      userId: requester.id,
      username: requester.username,
      displayName: requester.displayName,
      avatar: requester.avatar,
      count: 0,
      lastPlayedAt: null,
    };

    guild.users[requester.id] = {
      ...previousUser,
      username: requester.username || previousUser.username,
      displayName: requester.displayName || previousUser.displayName,
      avatar: requester.avatar || previousUser.avatar || null,
      count: (previousUser.count || 0) + 1,
      lastPlayedAt: now,
    };

    pruneEntries(guild.users, MAX_USERS_PER_GUILD);
  }

  guild.events.push({
    ts: now,
    trackKey,
    userId: requester && requester.id && !requester.isBot && requester.id !== botUserId
      ? requester.id
      : null,
    autoplay: Boolean(track.isAutoplay),
    track: normalizedTrack,
    requester: requester && !requester.isBot && requester.id !== botUserId ? requester : null,
  });
  guild.events = pruneEvents(guild.events, now);

  guild.summary.totalPlays = (guild.summary.totalPlays || 0) + 1;
  guild.summary.lastPlayAt = now;

  analyticsStore.set(guildId, guild);
}

function getGuildHistory(guildId, options = {}) {
  const requestedPage = Number.parseInt(options.page, 10);
  const requestedLimit = Number.parseInt(options.limit, 10);
  const page = Number.isFinite(requestedPage) ? Math.max(0, requestedPage) : 0;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 30;
  const guild = ensureGuildBucket(guildId);
  const now = Date.now();
  const originalLength = guild.events.length;
  guild.events = pruneEvents(guild.events, now);
  if (guild.events.length !== originalLength) analyticsStore.set(guildId, guild);

  const events = [...guild.events].reverse();
  const total = events.length;
  const start = page * limit;
  const items = events.slice(start, start + limit).map((event, index) => {
    const track = event.track || guild.tracks[event.trackKey] || {};
    const fallback = parseTrackKeyFallback(event.trackKey);
    const requester = event.requester || (event.userId ? guild.users[event.userId] || null : null);
    return {
      id: `${event.ts}-${event.trackKey}-${start + index}`,
      playedAt: event.ts,
      autoplay: Boolean(event.autoplay),
      track: {
        title: track.title || fallback.title,
        author: track.author || fallback.author,
        uri: track.uri || '',
        duration: Number.isFinite(track.duration) ? track.duration : 0,
        artwork: track.artwork || null,
        source: track.source || null,
      },
      requester: requester
        ? {
            userId: requester.userId,
            username: requester.username,
            displayName: requester.displayName,
            avatar: requester.avatar || null,
          }
        : null,
    };
  });

  return {
    items,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

function sortByCountAndRecent(a, b) {
  const byCount = (b.count || 0) - (a.count || 0);
  if (byCount !== 0) return byCount;
  return (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0);
}

function toRankedCounts(counts, limit = DEFAULT_LIMIT) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count], index) => ({ rank: index + 1, name, count }));
}

function getLongestDayStreak(dayKeys) {
  const days = [...dayKeys]
    .map((key) => Date.parse(`${key}T00:00:00.000Z`))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const day of days) {
    current = previous !== null && day - previous === DAY_MS ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }
  return longest;
}

function buildEventDetails(events, tracksMap, limit) {
  const sourceCounts = {};
  const artistCounts = {};
  const hourCounts = Array.from({ length: 24 }, () => 0);
  const activeDays = new Set();
  let estimatedDuration = 0;
  let autoplayPlays = 0;

  for (const event of events) {
    const track = event.track || tracksMap[event.trackKey] || {};
    const source = track.source || 'unknown';
    const artist = track.author || 'Unknown artist';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    artistCounts[artist] = (artistCounts[artist] || 0) + 1;
    estimatedDuration += Number.isFinite(track.duration) ? track.duration : 0;
    if (event.autoplay) autoplayPlays += 1;
    if (Number.isFinite(event.ts)) {
      hourCounts[new Date(event.ts).getUTCHours()] += 1;
      activeDays.add(toDayKey(event.ts));
    }
  }

  const mostActiveHour = hourCounts.reduce((best, count, hour) => (
    count > best.count ? { hour, count } : best
  ), { hour: null, count: 0 });

  return {
    estimatedDuration,
    autoplayPlays,
    activeDays: activeDays.size,
    averagePerActiveDay: activeDays.size ? events.length / activeDays.size : 0,
    longestStreakDays: getLongestDayStreak(activeDays),
    mostActiveHour: mostActiveHour.hour,
    topSources: toRankedCounts(sourceCounts, limit),
    topArtists: toRankedCounts(artistCounts, limit),
    retainedEventCount: events.length,
  };
}

function buildAllTimeTrackDetails(tracksMap, recentDetails, limit) {
  const sourceCounts = {};
  const artistCounts = {};
  let estimatedDuration = 0;
  for (const track of Object.values(tracksMap)) {
    const count = Number.isFinite(track.count) ? track.count : 0;
    const source = track.source || 'unknown';
    const artist = track.author || 'Unknown artist';
    sourceCounts[source] = (sourceCounts[source] || 0) + count;
    artistCounts[artist] = (artistCounts[artist] || 0) + count;
    estimatedDuration += (Number.isFinite(track.duration) ? track.duration : 0) * count;
  }
  return {
    ...recentDetails,
    estimatedDuration,
    topSources: toRankedCounts(sourceCounts, limit),
    topArtists: toRankedCounts(artistCounts, limit),
    historyScoped: true,
  };
}

function getGuildInsights(guildId, options = {}) {
  const requestedLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, requestedLimit))
    : DEFAULT_LIMIT;
  const range = normalizeRange(options.range);
  const now = Date.now();

  const guild = ensureGuildBucket(guildId);
  const originalEventsLength = guild.events.length;
  guild.events = pruneEvents(guild.events, now);
  if (guild.events.length !== originalEventsLength) {
    analyticsStore.set(guildId, guild);
  }

  const tracksMap = guild?.tracks && typeof guild.tracks === 'object' ? guild.tracks : {};
  const usersMap = guild?.users && typeof guild.users === 'object' ? guild.users : {};
  const events = Array.isArray(guild?.events) ? guild.events : [];

  let topTracks = [];
  let topUsers = [];
  let summary;
  let details;

  if (range === RANGE_ALL) {
    topTracks = Object.values(tracksMap)
      .sort(sortByCountAndRecent)
      .slice(0, limit)
      .map((entry, index) => ({
        rank: index + 1,
        key: entry.key,
        title: entry.title || 'Unknown',
        author: entry.author || 'Unknown',
        uri: entry.uri || '',
        duration: Number.isFinite(entry.duration) ? entry.duration : 0,
        artwork: entry.artwork || null,
        count: Number.isFinite(entry.count) ? entry.count : 0,
        lastPlayedAt: Number.isFinite(entry.lastPlayedAt) ? entry.lastPlayedAt : null,
      }));

    topUsers = Object.values(usersMap)
      .sort(sortByCountAndRecent)
      .slice(0, limit)
      .map((entry, index) => ({
        rank: index + 1,
        userId: entry.userId,
        username: entry.username || 'unknown',
        displayName: entry.displayName || entry.username || 'Unknown user',
        avatar: entry.avatar || null,
        count: Number.isFinite(entry.count) ? entry.count : 0,
        lastPlayedAt: Number.isFinite(entry.lastPlayedAt) ? entry.lastPlayedAt : null,
      }));

    const totalPlays = Number.isFinite(guild?.summary?.totalPlays)
      ? guild.summary.totalPlays
      : Object.values(tracksMap).reduce((sum, entry) => sum + (entry.count || 0), 0);

    summary = {
      totalPlays,
      uniqueTracks: Object.keys(tracksMap).length,
      uniqueUsers: Object.keys(usersMap).length,
      lastPlayAt: Number.isFinite(guild?.summary?.lastPlayAt) ? guild.summary.lastPlayAt : null,
    };
    details = buildAllTimeTrackDetails(tracksMap, buildEventDetails(events, tracksMap, limit), limit);
  } else {
    const startTimestamp = getRangeStartTimestamp(range, now);
    const aggregates = buildRangeAggregates(events, startTimestamp);
    const rangeEvents = events.filter((event) => event.ts >= startTimestamp);

    topTracks = buildTopTracksFromRange(aggregates.tracks, tracksMap, limit);
    topUsers = buildTopUsersFromRange(aggregates.users, usersMap, limit);

    summary = {
      totalPlays: aggregates.totalPlays,
      uniqueTracks: Object.keys(aggregates.tracks).length,
      uniqueUsers: Object.keys(aggregates.users).length,
      lastPlayAt: aggregates.lastPlayAt,
    };
    details = { ...buildEventDetails(rangeEvents, tracksMap, limit), historyScoped: false };
  }

  return {
    range,
    summary,
    topTracks,
    topUsers,
    details,
    trend14d: buildTrend14d(events, now),
    detailedHistoryDays: EVENT_RETENTION_DAYS,
  };
}

function getUserInsights(guildId, userId, options = {}) {
  const requestedLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, requestedLimit))
    : DEFAULT_LIMIT;
  const range = normalizeRange(options.range);
  const now = Date.now();
  const guild = ensureGuildBucket(guildId);
  const events = pruneEvents(guild.events, now);
  if (events.length !== guild.events.length) {
    guild.events = events;
    analyticsStore.set(guildId, guild);
  }

  const startTimestamp = getRangeStartTimestamp(range, now);
  const userEvents = events.filter((event) => (
    event?.userId === userId && (startTimestamp === null || event.ts >= startTimestamp)
  ));
  const aggregates = buildRangeAggregates(userEvents, null);
  const storedUser = guild.users?.[userId] || null;
  const details = buildEventDetails(userEvents, guild.tracks || {}, limit);

  return {
    range,
    user: storedUser,
    totalRequests: range === RANGE_ALL ? (storedUser?.count || 0) : userEvents.length,
    lastRequestAt: range === RANGE_ALL ? (storedUser?.lastPlayedAt || null) : aggregates.lastPlayAt,
    topTracks: buildTopTracksFromRange(aggregates.tracks, guild.tracks || {}, limit),
    details: { ...details, historyScoped: range === RANGE_ALL },
    detailedHistoryDays: EVENT_RETENTION_DAYS,
  };
}

module.exports = {
  recordTrackPlay,
  getGuildInsights,
  getUserInsights,
  getGuildHistory,
};
