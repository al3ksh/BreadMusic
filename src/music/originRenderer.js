const sharp = require('sharp');
const { renderBrandMark } = require('../games/brandAssets');
const { ORIGINS, originLabel } = require('./trackOrigin');

const WIDTH = 1200;
const HEIGHT = 700;
const MAX_ROWS = 7;
const OTHER_COLOR = '#6b6880';

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function truncate(value, maxLength) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function percent(share) {
  const value = share * 100;
  if (value > 0 && value < 1) return '<1%';
  return `${Math.round(value)}%`;
}

// Folds the long tail into one "Everything else" row so the legend fits.
function toRows(origins) {
  const rows = origins.slice(0, MAX_ROWS).map((entry) => ({
    ...entry,
    label: originLabel(entry.origin),
    color: ORIGINS[entry.origin]?.color ?? OTHER_COLOR,
  }));
  const rest = origins.slice(MAX_ROWS);
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
  const ring = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#1d1b27" stroke-width="58"/>`;
  if (rows.length === 0) {
    return `${ring}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-value">0</text>
      <text x="${cx}" y="${cy + 30}" text-anchor="middle" class="donut-label">PLAYS</text>`;
  }

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
    <text x="${cx}" y="${cy + 6}" text-anchor="middle" class="donut-value">${escapeXml(total)}</text>
    <text x="${cx}" y="${cy + 40}" text-anchor="middle" class="donut-label">PLAYS</text>`;
}

function legend(rows) {
  if (rows.length === 0) {
    return `<text x="560" y="300" class="row-label">Nothing recorded yet.</text>
      <text x="560" y="336" class="detail">Play something with /play, a link or the dashboard.</text>`;
  }
  const top = 168;
  const step = rows.length > 6 ? 56 : 64;
  return rows.map((row, index) => {
    const y = top + index * step;
    const barWidth = Math.max(6, Math.round(550 * row.share));
    return `<g transform="translate(560 ${y})">
      <circle cx="9" cy="-7" r="9" fill="${row.color}"/>
      <text x="30" y="0" class="row-label">${escapeXml(row.label)}</text>
      <text x="580" y="0" text-anchor="end" class="row-value">${escapeXml(percent(row.share))}</text>
      <text x="500" y="0" text-anchor="end" class="row-count">${escapeXml(row.count)}×</text>
      <rect x="30" y="14" width="550" height="8" rx="4" fill="#1d1b27"/>
      <rect x="30" y="14" width="${Math.min(550, barWidth)}" height="8" rx="4" fill="${row.color}"/>
    </g>`;
  }).join('');
}

function buildOriginSvg({ title, subject, rangeLabel, insights }) {
  const rows = toRows(insights.origins);
  const top = rows[0];
  const footer = insights.untracked > 0
    ? `${insights.untracked} older plays were recorded before Bread tracked how songs were requested.`
    : `Counts the last ${insights.detailedHistoryDays} days at most. Radio streams are not counted.`;

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="brandLogoClip"><circle cx="58" cy="54" r="24"/></clipPath>
      <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1926"/><stop offset="0.55" stop-color="#111116"/><stop offset="1" stop-color="#17151f"/></linearGradient>
      <style>
        text { font-family: Inter, Arial, DejaVu Sans, sans-serif; }
        .eyebrow { font-size: 18px; font-weight: 700; letter-spacing: 2px; fill: #a9a4bb; }
        .title { font-size: 34px; font-weight: 800; fill: #f4f2f8; }
        .detail { font-size: 17px; font-weight: 500; fill: #8f899e; }
        .donut-value { font-size: 64px; font-weight: 850; fill: #f4f2f8; }
        .donut-label { font-size: 17px; font-weight: 750; letter-spacing: 3px; fill: #8f899e; }
        .row-label { font-size: 23px; font-weight: 750; fill: #f4f2f8; }
        .row-value { font-size: 23px; font-weight: 850; fill: #f4f2f8; }
        .row-count { font-size: 18px; font-weight: 600; fill: #8f899e; }
        .top { font-size: 20px; font-weight: 750; }
      </style>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" rx="28" fill="#0c0c10"/>
    <rect x="2" y="2" width="1196" height="696" rx="26" fill="url(#surface)" stroke="#302c3f" stroke-width="2"/>
    ${renderBrandMark()}
    <text x="96" y="47" class="eyebrow">BREAD STATS · ${escapeXml(rangeLabel.toUpperCase())}</text>
    <text x="96" y="76" class="title">${escapeXml(title)}</text>
    <text x="1154" y="49" text-anchor="end" class="eyebrow">${escapeXml(insights.userId ? 'MEMBER' : 'SERVER')}</text>
    <text x="1154" y="78" text-anchor="end" class="title">${escapeXml(truncate(subject, 24))}</text>
    <line x1="46" y1="102" x2="1154" y2="102" stroke="#302c3f" stroke-width="2"/>
    ${donut(rows, insights.tracked)}
    ${top ? `<text x="300" y="590" text-anchor="middle" class="top" fill="${top.color}">Top input: ${escapeXml(top.label)}</text>` : ''}
    ${legend(rows)}
    <line x1="46" y1="626" x2="1154" y2="626" stroke="#302c3f" stroke-width="2"/>
    <text x="600" y="662" text-anchor="middle" class="detail">${escapeXml(footer)}</text>
  </svg>`;
}

async function renderOriginImage(input) {
  return sharp(Buffer.from(buildOriginSvg(input))).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { buildOriginSvg, renderOriginImage, toRows };
