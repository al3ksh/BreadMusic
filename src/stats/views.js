const { ORIGINS, originLabel } = require('../music/trackOrigin');
const {
  COLORS,
  LEFT,
  PALETTE,
  RIGHT,
  bar,
  columnChart,
  escapeXml,
  formatCount,
  formatListened,
  frame,
  percent,
  sectionLabel,
  tileRow,
  truncate,
} = require('./card');

// Each view turns a plain model into { svg, text }; text is the embed fallback.
const VIEWS = {
  overview: { label: 'Overview', description: 'Plays, time listened and the last 14 days', emoji: '📊' },
  top: { label: 'Top tracks & artists', description: 'Most played songs, artists and requesters', emoji: '🏆' },
  sources: { label: 'Sources', description: 'Links, search, uploads, autoplay and platforms', emoji: '🔗' },
  rhythm: { label: 'Rhythm', description: 'Busiest hours and weekdays', emoji: '🕒' },
  arcade: { label: 'Arcade', description: 'Games, wins and BREAD', emoji: '🎰' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OTHER_COLOR = '#6b6880';
const MAX_ORIGIN_ROWS = 7;

const PLATFORMS = {
  youtube: { label: 'YouTube', color: '#ff4e45' },
  spotify: { label: 'Spotify', color: '#1ed760' },
  soundcloud: { label: 'SoundCloud', color: '#ff7a1a' },
  deezer: { label: 'Deezer', color: '#a238ff' },
  applemusic: { label: 'Apple Music', color: '#fa5c82' },
  bandcamp: { label: 'Bandcamp', color: '#3fb4c8' },
  localupload: { label: 'Upload', color: '#e9bb63' },
  http: { label: 'Direct link', color: '#9aa0b4' },
  unknown: { label: 'Unknown', color: '#4a4658' },
};

function platformInfo(source) {
  const key = String(source || 'unknown').replace(/[\s_-]+/g, '').toLowerCase();
  return PLATFORMS[key] ?? { label: String(source), color: OTHER_COLOR };
}

function dayLabel(dateKey) {
  const [, month, day] = String(dateKey).split('-').map(Number);
  return month ? `${MONTHS[month - 1]} ${day}` : '';
}

function hourLabel(hour) {
  return hour === null || hour === undefined ? '-' : `${String(hour).padStart(2, '0')}:00`;
}

function scopeOf(model) {
  return model.isMember ? 'MEMBER' : 'SERVER';
}

function eyebrow(model) {
  return `Bread stats · ${model.rangeLabel}`;
}

function emptyState(text, y = 380) {
  return `<text x="600" y="${y}" text-anchor="middle" class="empty">${escapeXml(text)}</text>`;
}

function maxIndex(values) {
  let best = -1;
  values.forEach((value, index) => {
    if (value > 0 && (best === -1 || value > values[best])) best = index;
  });
  return best;
}

function overviewView(model) {
  const tiles = model.isMember
    ? [
      { label: 'Requests', value: formatCount(model.plays), color: COLORS.accent },
      { label: 'Listened', value: formatListened(model.listenedMs) },
      { label: 'Active days', value: formatCount(model.activeDays) },
      { label: 'Best streak', value: `${model.streak}d`, color: COLORS.gold },
    ]
    : [
      { label: 'Plays', value: formatCount(model.plays), color: COLORS.accent },
      { label: 'Listened', value: formatListened(model.listenedMs) },
      { label: 'Tracks', value: formatCount(model.uniqueTracks) },
      { label: 'Requesters', value: formatCount(model.uniqueUsers), color: COLORS.good },
    ];
  const counts = model.trend.map((day) => day.count);
  const chart = counts.some((count) => count > 0)
    ? columnChart({
      x: LEFT,
      y: 300,
      width: RIGHT - LEFT,
      height: 262,
      values: counts,
      labels: model.trend.map((day) => dayLabel(day.dateKey)),
      highlight: counts.length - 1,
    })
    : emptyState('Nothing played in the last 14 days.', 440);
  const autoplayShare = model.plays ? model.autoplayPlays / Math.max(1, model.retainedPlays || model.plays) : 0;
  const footer = model.historyScoped && model.isMember
    ? `Requests are all-time · listened, active days and streak use the last ${model.retentionDays} days.`
    : model.historyScoped
    ? `Totals are all-time · autoplay ${percent(autoplayShare)} and streaks use the last ${model.retentionDays} days.`
    : `${model.avgPerDay.toFixed(1)} plays per active day · ${model.autoplayPlays} picked by autoplay.`;

  const svg = frame({
    eyebrow: eyebrow(model),
    title: model.isMember ? 'Listening overview' : 'Server overview',
    scope: scopeOf(model),
    subject: model.subject,
    body: `${tileRow(tiles)}
      ${sectionLabel(LEFT, 278, 'Last 14 days')}
      ${sectionLabel(RIGHT, 278, `${formatCount(counts.reduce((sum, count) => sum + count, 0))} plays`, 'end')}
      ${chart}`,
    footer,
  });
  const text = [
    ...tiles.map((entry) => `**${entry.label}:** ${entry.value}`),
    `**Last 14 days:** ${counts.reduce((sum, count) => sum + count, 0)} plays`,
  ].join('\n');
  return { svg, text };
}

function trackRows(tracks) {
  const defs = [];
  const rows = tracks.map((track, index) => {
    const y = 160 + index * 88;
    const color = PALETTE[index % PALETTE.length];
    defs.push(`<clipPath id="art${index}"><rect x="${LEFT}" y="${y}" width="68" height="68" rx="12"/></clipPath>`);
    const art = track.art
      ? `<image x="${LEFT}" y="${y}" width="68" height="68" href="${track.art}" preserveAspectRatio="xMidYMid slice" clip-path="url(#art${index})"/>`
      : `<rect x="${LEFT}" y="${y}" width="68" height="68" rx="12" fill="${color}" opacity="0.85"/>
        <text x="${LEFT + 34}" y="${y + 45}" text-anchor="middle" class="row-value" fill="#0c0c10">${index + 1}</text>`;
    return `${art}
      <text x="${LEFT + 88}" y="${y + 28}" class="row-label">${escapeXml(truncate(track.title, 36))}</text>
      <text x="${LEFT + 88}" y="${y + 56}" class="row-sub">${escapeXml(truncate(track.author, 46))}</text>
      <text x="690" y="${y + 44}" text-anchor="end" class="row-value">${escapeXml(formatCount(track.count))}×</text>`;
  });
  return { defs: defs.join(''), rows: rows.join('') };
}

function rankedBars(items, { x, y, width, step, max, nameLength = 26 }) {
  return items.map((item, index) => {
    const rowY = y + index * step;
    return `<text x="${x}" y="${rowY}" class="row-small">${escapeXml(truncate(item.name, nameLength))}</text>
      <text x="${x + width}" y="${rowY}" text-anchor="end" class="row-count">${escapeXml(formatCount(item.count))}×</text>
      ${bar({ x, y: rowY + 10, width, share: item.count / max, color: PALETTE[index % PALETTE.length], height: 6 })}`;
  }).join('');
}

function topView(model) {
  const { defs, rows } = trackRows(model.tracks);
  const right = 744;
  const rightWidth = RIGHT - right;
  const artistMax = Math.max(1, ...model.artists.map((item) => item.count));
  let side;
  if (model.isMember) {
    side = `${sectionLabel(right, 140, 'Top artists')}
      ${model.artists.length ? rankedBars(model.artists, { x: right, y: 190, width: rightWidth, step: 88, max: artistMax }) : ''}`;
  } else {
    const requesterMax = Math.max(1, ...model.requesters.map((item) => item.count));
    side = `${sectionLabel(right, 140, 'Top artists')}
      ${rankedBars(model.artists, { x: right, y: 178, width: rightWidth, step: 44, max: artistMax })}
      ${sectionLabel(right, 404, 'Top requesters')}
      ${rankedBars(model.requesters, { x: right, y: 442, width: rightWidth, step: 38, max: requesterMax })}`;
  }
  const body = model.tracks.length
    ? `${sectionLabel(LEFT, 140, 'Top tracks')}${rows}
      <line x1="716" y1="128" x2="716" y2="604" stroke="${COLORS.line}" stroke-width="2"/>${side}`
    : emptyState('No plays recorded in this period.');

  const svg = frame({
    eyebrow: eyebrow(model),
    title: 'Top tracks & artists',
    scope: scopeOf(model),
    subject: model.subject,
    body,
    defs,
    footer: model.footer,
  });
  const text = [
    '**Top tracks**',
    ...model.tracks.map((track, index) => `${index + 1}. ${track.title} — ${track.author} (${track.count}×)`),
    '',
    '**Top artists**',
    ...model.artists.map((item, index) => `${index + 1}. ${item.name} (${item.count}×)`),
    ...(model.isMember ? [] : ['', '**Top requesters**', ...model.requesters.map((item, index) => `${index + 1}. ${item.name} (${item.count}×)`)]),
  ].join('\n') || 'No plays recorded in this period.';
  return { svg, text };
}

// Folds the long tail into one "Everything else" row so the legend fits.
function toOriginRows(origins) {
  const rows = origins.slice(0, MAX_ORIGIN_ROWS).map((entry) => ({
    ...entry,
    label: originLabel(entry.origin),
    color: ORIGINS[entry.origin]?.color ?? OTHER_COLOR,
  }));
  const rest = origins.slice(MAX_ORIGIN_ROWS);
  if (rest.length > 0) {
    const last = rows.pop();
    const folded = [last, ...rest];
    rows.push({
      origin: 'other',
      label: 'Everything else',
      color: OTHER_COLOR,
      count: folded.reduce((sum, entry) => sum + entry.count, 0),
      share: folded.reduce((sum, entry) => sum + entry.share, 0),
    });
  }
  return rows;
}

function donut(rows, total) {
  const cx = 300;
  const cy = 372;
  const radius = 150;
  const circumference = 2 * Math.PI * radius;
  const ring = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${COLORS.track}" stroke-width="58"/>`;
  // A small gap between slices reads better than touching arcs, unless one slice is the whole ring.
  const gap = rows.length > 1 ? 4 : 0;
  let offset = 0;
  const slices = rows.map((row) => {
    const length = row.share * circumference;
    const visible = Math.max(0, length - gap);
    const slice = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${row.color}" stroke-width="58"
      stroke-dasharray="${visible.toFixed(2)} ${(circumference - visible).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += length;
    return slice;
  });
  return `${ring}${slices.join('')}
    <text x="${cx}" y="${cy + 6}" text-anchor="middle" class="donut-value">${escapeXml(formatCount(total))}</text>
    <text x="${cx}" y="${cy + 40}" text-anchor="middle" class="donut-label">PLAYS</text>`;
}

function originLegend(rows) {
  const step = rows.length > 6 ? 56 : 64;
  return rows.map((row, index) => {
    const y = 168 + index * step;
    return `<g transform="translate(560 ${y})">
      <circle cx="9" cy="-7" r="9" fill="${row.color}"/>
      <text x="30" y="0" class="row-label">${escapeXml(row.label)}</text>
      <text x="580" y="0" text-anchor="end" class="row-value">${escapeXml(percent(row.share))}</text>
      <text x="500" y="0" text-anchor="end" class="row-count">${escapeXml(formatCount(row.count))}×</text>
      ${bar({ x: 30, y: 14, width: 550, share: row.share, color: row.color })}
    </g>`;
  }).join('');
}

// One stacked bar for the platform the audio actually came from.
function platformStrip(platforms) {
  if (!platforms.length) return '';
  const x = 590;
  const width = 550;
  let offset = 0;
  const segments = platforms.map((entry) => {
    const info = platformInfo(entry.source);
    const segmentWidth = entry.share * width;
    const rect = `<rect x="${(x + offset).toFixed(1)}" y="574" width="${Math.max(0, segmentWidth - 2).toFixed(1)}" height="12" fill="${info.color}"/>`;
    offset += segmentWidth;
    return rect;
  }).join('');
  const legend = platforms.slice(0, 4)
    .map((entry) => `${platformInfo(entry.source).label} ${percent(entry.share)}`)
    .join('  ·  ');
  return `${sectionLabel(x, 562, 'Audio streamed from')}
    <clipPath id="platformClip"><rect x="${x}" y="574" width="${width}" height="12" rx="6"/></clipPath>
    <g clip-path="url(#platformClip)"><rect x="${x}" y="574" width="${width}" height="12" fill="${COLORS.track}"/>${segments}</g>
    <text x="${x}" y="610" class="row-sub">${escapeXml(legend)}</text>`;
}

function sourcesView(model) {
  const { insights } = model;
  const rows = toOriginRows(insights.origins);
  const top = rows[0];
  const footer = insights.untracked > 0
    ? `${insights.untracked} older plays were recorded before Bread tracked how songs were requested.`
    : `Counts the last ${insights.detailedHistoryDays} days at most. Radio streams are not counted.`;
  const body = rows.length
    ? `${donut(rows, insights.tracked)}
      ${top ? `<text x="300" y="590" text-anchor="middle" class="top" fill="${top.color}">Top input: ${escapeXml(top.label)}</text>` : ''}
      ${originLegend(rows)}
      ${platformStrip(insights.platforms || [])}`
    : `${emptyState('Nothing recorded yet.', 360)}
      <text x="600" y="400" text-anchor="middle" class="detail">Play something with /play, a link or the dashboard.</text>`;
  const svg = frame({
    eyebrow: eyebrow(model),
    title: model.isMember ? 'How they request music' : 'Where the music came from',
    scope: scopeOf(model),
    subject: model.subject,
    body,
    footer,
  });
  const text = [
    ...rows.map((row) => `**${row.label}:** ${row.count} (${percent(row.share)})`),
    insights.platforms?.length
      ? `\n**Audio from:** ${insights.platforms.map((entry) => `${platformInfo(entry.source).label} ${percent(entry.share)}`).join(', ')}`
      : '',
  ].join('\n').trim() || 'Nothing recorded yet.';
  return { svg, text };
}

function rhythmView(model) {
  const busiestDay = maxIndex(model.weekdayCounts);
  const tiles = [
    { label: 'Peak hour', value: hourLabel(model.mostActiveHour), color: COLORS.gold },
    { label: 'Busiest day', value: busiestDay === -1 ? '-' : WEEKDAYS[busiestDay], color: COLORS.accent },
    { label: 'Active days', value: formatCount(model.activeDays) },
    { label: 'Per active day', value: model.avgPerDay.toFixed(1), color: COLORS.good },
  ];
  const hasData = model.hourCounts.some((count) => count > 0);
  const charts = hasData
    ? `${sectionLabel(LEFT, 278, `By hour · ${model.timeZone}`)}
      ${columnChart({
        x: LEFT,
        y: 300,
        width: 714,
        height: 252,
        values: model.hourCounts,
        labels: model.hourCounts.map((_, hour) => String(hour).padStart(2, '0')),
        highlight: model.mostActiveHour ?? -1,
        showValues: false,
        labelEvery: 3,
      })}
      ${sectionLabel(800, 278, 'By weekday')}
      ${columnChart({
        x: 800,
        y: 300,
        width: RIGHT - 800,
        height: 252,
        values: model.weekdayCounts,
        labels: WEEKDAYS,
        highlight: busiestDay,
        color: COLORS.good,
      })}`
    : emptyState('No plays recorded in this period.', 440);
  const svg = frame({
    eyebrow: eyebrow(model),
    title: 'When the music plays',
    scope: scopeOf(model),
    subject: model.subject,
    body: `${tileRow(tiles)}${charts}`,
    footer: model.historyScoped
      ? `Patterns use the last ${model.retentionDays} days · best streak ${model.streak} days in a row.`
      : `${formatCount(model.plays)} plays in this period · best streak ${model.streak} days in a row.`,
  });
  const text = [
    ...tiles.map((entry) => `**${entry.label}:** ${entry.value}`),
    `**Best streak:** ${model.streak} days`,
    `Hours are shown in ${model.timeZone}.`,
  ].join('\n');
  return { svg, text };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function signed(value) {
  const number = Math.round(Number(value) || 0);
  return `${number > 0 ? '+' : number < 0 ? '−' : ''}${formatCount(Math.abs(number))}`;
}

function arcadeView(model) {
  const { stats } = model;
  const net = stats.totalPayout - stats.totalWagered;
  const winRate = stats.games ? stats.wins / stats.games : 0;
  const tiles = [
    { label: 'Games', value: formatCount(stats.games), color: COLORS.accent },
    model.isMember
      ? { label: 'Win rate', value: percent(winRate), color: COLORS.good }
      : { label: 'Players', value: formatCount(model.playerCount) },
    { label: 'Net BREAD', value: signed(net), color: net >= 0 ? COLORS.good : COLORS.bad },
    { label: 'Biggest payout', value: formatCount(stats.biggestPayout), color: COLORS.gold },
  ];

  const total = Math.max(1, stats.games);
  const record = [
    { share: stats.wins / total, color: COLORS.good },
    { share: stats.losses / total, color: COLORS.bad },
    { share: stats.draws / total, color: COLORS.muted },
  ];
  let offset = 0;
  const recordBar = record.map((part) => {
    const width = part.share * 644;
    const rect = width > 0 ? `<rect x="${(LEFT + offset).toFixed(1)}" y="300" width="${Math.max(0, width - 2).toFixed(1)}" height="18" fill="${part.color}"/>` : '';
    offset += width;
    return rect;
  }).join('');

  const games = Object.entries(stats.byGame)
    .sort((left, right) => right[1].games - left[1].games)
    .slice(0, 5);
  const gameMax = Math.max(1, ...games.map(([, value]) => value.games));
  const gameRows = games.map(([name, value], index) => {
    const y = 432 + index * 42;
    return `<text x="${LEFT}" y="${y}" class="row-small">${escapeXml(truncate(capitalize(name), 18))}</text>
      <text x="690" y="${y}" text-anchor="end" class="row-count">${escapeXml(`${value.games} games · ${value.wins || 0} wins`)}</text>
      ${bar({ x: LEFT, y: y + 10, width: 644, share: value.games / gameMax, color: PALETTE[index % PALETTE.length], height: 6 })}`;
  }).join('');

  const right = 744;
  let side;
  if (model.isMember) {
    const lines = [
      ['Wagered', formatCount(stats.totalWagered)],
      ['Paid out', formatCount(stats.totalPayout)],
      ['Balance now', model.balance === null ? '-' : formatCount(model.balance)],
      ['Favourite', games[0] ? capitalize(games[0][0]) : '-'],
    ];
    side = `${sectionLabel(right, 278, 'Economy')}
      ${lines.map(([label, value], index) => `<text x="${right}" y="${330 + index * 66}" class="row-sub">${escapeXml(label)}</text>
        <text x="${RIGHT}" y="${330 + index * 66}" text-anchor="end" class="row-value">${escapeXml(truncate(value, 14))}</text>`).join('')}`;
  } else {
    side = `${sectionLabel(right, 278, 'Top players')}
      ${model.players.map((player, index) => {
        const playerNet = player.totalPayout - player.totalWagered;
        const y = 326 + index * 56;
        return `<text x="${right}" y="${y}" class="row-small">${escapeXml(`${index + 1}. ${truncate(player.name, 18)}`)}</text>
          <text x="${RIGHT}" y="${y}" text-anchor="end" class="row-value" fill="${playerNet >= 0 ? COLORS.good : COLORS.bad}">${escapeXml(signed(playerNet))}</text>
          <text x="${right}" y="${y + 24}" class="row-sub">${escapeXml(`${player.games} games · ${player.wins} wins`)}</text>`;
      }).join('')}`;
  }

  const body = stats.games
    ? `${tileRow(tiles)}
      ${sectionLabel(LEFT, 278, 'Record')}
      <clipPath id="recordClip"><rect x="${LEFT}" y="300" width="644" height="18" rx="9"/></clipPath>
      <g clip-path="url(#recordClip)"><rect x="${LEFT}" y="300" width="644" height="18" fill="${COLORS.track}"/>${recordBar}</g>
      <text x="${LEFT}" y="348" class="row-sub">${escapeXml(`${stats.wins} wins · ${stats.losses} losses · ${stats.draws} draws`)}</text>
      ${sectionLabel(LEFT, 396, 'Games')}
      ${gameRows}
      <line x1="716" y1="256" x2="716" y2="604" stroke="${COLORS.line}" stroke-width="2"/>
      ${side}`
    : `${tileRow(tiles)}${emptyState('No Arcade games played yet. Try /slots or /blackjack.', 420)}`;

  const svg = frame({
    eyebrow: 'Bread stats · All time',
    title: 'Arcade record',
    scope: scopeOf(model),
    subject: model.subject,
    body,
    footer: 'Arcade records are all-time for this server.',
  });
  const text = [
    `**Games:** ${stats.games} (${stats.wins}W / ${stats.losses}L / ${stats.draws}D)`,
    `**Net BREAD:** ${signed(net)} · wagered ${stats.totalWagered} · biggest payout ${stats.biggestPayout}`,
    ...games.map(([name, value]) => `**${name}:** ${value.games} games, ${value.wins || 0} wins`),
    ...(model.isMember ? [] : model.players.map((player, index) => `${index + 1}. ${player.name}: ${signed(player.totalPayout - player.totalWagered)}`)),
  ].join('\n');
  return { svg, text };
}

const BUILDERS = { overview: overviewView, top: topView, sources: sourcesView, rhythm: rhythmView, arcade: arcadeView };

function buildView(view, model) {
  const builder = BUILDERS[view] ?? overviewView;
  return builder(model);
}

module.exports = { VIEWS, buildView, platformInfo, toOriginRows };
