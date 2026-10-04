const { AttachmentBuilder } = require('discord.js');
const { getGuildInsights, getOriginInsights, getUserInsights } = require('../state/analyticsStore');
const { getArcadeStats, getGuildArcadeStats } = require('../games/arcadeStats');
const { attachArtwork } = require('./artwork');
const { renderSvg } = require('./card');
const { VIEWS, buildView } = require('./views');

const COMPONENT_PREFIX = 'stats:';
const RANGES = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  all: 'All time',
};
const VIEW_KEYS = Object.keys(VIEWS);

function normalizeView(view) {
  return VIEW_KEYS.includes(view) ? view : 'overview';
}

function normalizeRange(range) {
  return Object.hasOwn(RANGES, range) ? range : 'all';
}

// customIds carry everything needed to redraw: who may click, whose stats, which view and range.
function buildCustomId(action, { ownerId, targetId, view, range }) {
  const parts = [action, ownerId, targetId || '-'];
  if (action === 'range') parts.push(view);
  parts.push(range);
  return `${COMPONENT_PREFIX}${parts.join(':')}`;
}

function parseCustomId(customId) {
  const parts = String(customId).slice(COMPONENT_PREFIX.length).split(':');
  const [action, ownerId, target] = parts;
  if (action === 'view' && parts.length === 4) {
    return { action, ownerId, targetId: target === '-' ? null : target, view: null, range: normalizeRange(parts[3]) };
  }
  if (action === 'range' && parts.length === 5) {
    return { action, ownerId, targetId: target === '-' ? null : target, view: normalizeView(parts[3]), range: normalizeRange(parts[4]) };
  }
  return null;
}

function buildComponents(context, state) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = context;
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId('view', state))
    .setPlaceholder('Switch view')
    .addOptions(VIEW_KEYS.map((key) => ({
      label: VIEWS[key].label,
      description: VIEWS[key].description,
      emoji: VIEWS[key].emoji,
      value: key,
      default: key === state.view,
    })));
  // Arcade records are all-time, so the range buttons would do nothing there.
  const rangeButtons = Object.entries(RANGES).map(([range, label]) => new ButtonBuilder()
    .setCustomId(buildCustomId('range', { ...state, range }))
    .setLabel(label)
    .setStyle(range === state.range ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(state.view === 'arcade' || range === state.range));
  return [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(rangeButtons),
  ];
}

function displayName(user, member) {
  return member?.displayName || user?.globalName || user?.username || 'Unknown member';
}

async function resolveName(guild, userId, fallback) {
  const member = guild?.members?.cache?.get(userId)
    || await guild?.members?.fetch?.(userId).catch(() => null);
  return member?.displayName || member?.user?.globalName || member?.user?.username || fallback || 'Unknown player';
}

function playsModel(insights, isMember) {
  const { details } = insights;
  return {
    plays: isMember ? insights.totalRequests : insights.summary.totalPlays,
    listenedMs: details.estimatedDuration,
    uniqueTracks: insights.summary?.uniqueTracks ?? 0,
    uniqueUsers: insights.summary?.uniqueUsers ?? 0,
    activeDays: details.activeDays,
    streak: details.longestStreakDays,
    avgPerDay: details.averagePerActiveDay || 0,
    autoplayPlays: details.autoplayPlays,
    retainedPlays: details.retainedEventCount,
    historyScoped: Boolean(details.historyScoped),
    retentionDays: insights.detailedHistoryDays,
    trend: insights.trend14d || [],
    hourCounts: details.hourCounts || Array(24).fill(0),
    weekdayCounts: details.weekdayCounts || Array(7).fill(0),
    mostActiveHour: details.mostActiveHour,
    timeZone: details.timeZone || 'UTC',
  };
}

const defaultData = {
  getGuildInsights,
  getUserInsights,
  getOriginInsights,
  getArcadeStats,
  getGuildArcadeStats,
  attachArtwork,
};

// Gathers the numbers one view needs; kept separate from drawing so it can be tested.
async function loadModel({ guild, guildId, target, view, range, getBalance, data = defaultData }) {
  const isMember = Boolean(target);
  const base = {
    isMember,
    subject: isMember ? displayName(target.user, target.member) : (guild?.name || 'This server'),
    rangeLabel: RANGES[range],
  };

  if (view === 'arcade') {
    if (isMember) {
      const balance = typeof getBalance === 'function' ? getBalance(target.user.id) : null;
      return { ...base, stats: data.getArcadeStats(target.user.id, guildId), balance: Number.isFinite(balance) ? balance : null };
    }
    const stats = data.getGuildArcadeStats(guildId, 5);
    const players = await Promise.all(stats.players.map(async (player) => ({
      ...player,
      name: await resolveName(guild, player.userId),
    })));
    return { ...base, stats, players, playerCount: stats.playerCount };
  }

  if (view === 'sources') {
    const insights = data.getOriginInsights(guildId, { range, userId: target?.user.id });
    const rangeLabel = range === 'all' ? `Last ${insights.detailedHistoryDays} days` : base.rangeLabel;
    return { ...base, rangeLabel, insights };
  }

  const insights = isMember
    ? data.getUserInsights(guildId, target.user.id, { range, limit: 5 })
    : data.getGuildInsights(guildId, { range, limit: 5 });
  const model = { ...base, ...playsModel(insights, isMember) };

  if (view === 'top') {
    const tracks = await data.attachArtwork(insights.topTracks.slice(0, 5));
    const requesters = isMember ? [] : await Promise.all(insights.topUsers.slice(0, 5).map(async (entry) => ({
      name: await resolveName(guild, entry.userId, entry.displayName),
      count: entry.count,
    })));
    const footer = isMember && range === 'all'
      ? `Rankings use the last ${insights.detailedHistoryDays} days of detailed history.`
      : model.historyScoped ? 'Tracks, artists and requesters are all-time.' : `${model.plays} plays in this period.`;
    return { ...model, tracks, artists: insights.details.topArtists.slice(0, 5), requesters, footer };
  }
  return model;
}

// Builds the whole reply: image when sharp works, otherwise the same numbers as an embed.
async function buildStatsReply(context, state, { guild, target, getBalance, data } = {}) {
  const { EmbedBuilder, BRAND_COLORS } = context;
  const model = await loadModel({ guild, guildId: state.guildId, target, view: state.view, range: state.range, getBalance, data });
  const { svg, text } = buildView(state.view, model);
  const components = buildComponents(context, state);
  try {
    const image = await renderSvg(svg);
    return {
      content: '',
      embeds: [],
      files: [new AttachmentBuilder(image, { name: `bread-stats-${state.view}.png` })],
      attachments: [],
      components,
    };
  } catch (error) {
    console.warn('[Stats] Image render failed, sending text instead:', error.message);
    const embed = new EmbedBuilder()
      .setTitle(`${VIEWS[state.view].emoji} ${VIEWS[state.view].label} - ${model.subject}`)
      .setDescription(`📅 ${state.view === 'arcade' ? 'All time' : model.rangeLabel}\n\n${text}`.slice(0, 4000))
      .setColor(BRAND_COLORS.primary);
    return { content: '', embeds: [embed], files: [], attachments: [], components };
  }
}

module.exports = {
  COMPONENT_PREFIX,
  RANGES,
  VIEW_KEYS,
  buildComponents,
  buildCustomId,
  buildStatsReply,
  loadModel,
  normalizeRange,
  normalizeView,
  parseCustomId,
};
