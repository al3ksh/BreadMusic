const sharp = require('sharp');
const { renderBrandMark } = require('../games/brandAssets');

// Shared frame and drawing helpers for the /stats images (1200x700, Arcade look).
const WIDTH = 1200;
const HEIGHT = 700;
const LEFT = 46;
const RIGHT = 1154;

const COLORS = {
  text: '#f4f2f8',
  muted: '#8f899e',
  soft: '#a9a4bb',
  line: '#302c3f',
  track: '#1d1b27',
  tile: '#17151f',
  tileStroke: '#2a2638',
  accent: '#8f82eb',
  good: '#61d59b',
  bad: '#ff6b6b',
  gold: '#e9bb63',
};

const PALETTE = ['#8f82eb', '#61d59b', '#5fa8ff', '#f06fb0', '#e9bb63', '#ff7a1a', '#3fb4c8', '#ff4e45'];

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

function formatCount(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(number) >= 10_000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(number));
}

function formatListened(ms) {
  const minutes = Math.round((Number(ms) || 0) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function tile({ x, y, width, height = 104, label, value, color = COLORS.text }) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="${COLORS.tile}" stroke="${COLORS.tileStroke}" stroke-width="2"/>
    <text x="${x + 22}" y="${y + 34}" class="tile-label">${escapeXml(String(label).toUpperCase())}</text>
    <text x="${x + 22}" y="${y + 82}" class="tile-value" fill="${color}">${escapeXml(value)}</text>`;
}

// Four tiles spread across the full content width.
function tileRow(tiles, y = 128) {
  const gap = 20;
  const width = (RIGHT - LEFT - gap * (tiles.length - 1)) / tiles.length;
  return tiles.map((entry, index) => tile({ ...entry, x: LEFT + index * (width + gap), y, width })).join('');
}

function sectionLabel(x, y, text, anchor = 'start') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="section">${escapeXml(String(text).toUpperCase())}</text>`;
}

function bar({ x, y, width, share, color, height = 8 }) {
  const filled = share > 0 ? Math.max(height, Math.round(width * Math.min(1, share))) : 0;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${COLORS.track}"/>
    ${filled ? `<rect x="${x}" y="${y}" width="${filled}" height="${height}" rx="${height / 2}" fill="${color}"/>` : ''}`;
}

// Vertical bars with labels underneath; the highlighted index gets the accent colour.
function columnChart({ x, y, width, height, values, labels, highlight = -1, color = COLORS.accent, showValues = true, labelEvery = 1 }) {
  const max = Math.max(1, ...values);
  const slot = width / values.length;
  const barWidth = Math.max(6, Math.min(56, slot * 0.66));
  const baseline = y + height;
  return values.map((value, index) => {
    const barHeight = value > 0 ? Math.max(6, Math.round((value / max) * (height - 28))) : 3;
    const cx = x + slot * index + slot / 2;
    const fill = index === highlight ? COLORS.gold : value > 0 ? color : COLORS.track;
    const label = index % labelEvery === 0 && labels[index]
      ? `<text x="${cx.toFixed(1)}" y="${baseline + 28}" text-anchor="middle" class="axis">${escapeXml(labels[index])}</text>`
      : '';
    const count = showValues && value > 0
      ? `<text x="${cx.toFixed(1)}" y="${baseline - barHeight - 8}" text-anchor="middle" class="axis-value">${escapeXml(formatCount(value))}</text>`
      : '';
    return `<rect x="${(cx - barWidth / 2).toFixed(1)}" y="${baseline - barHeight}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="${Math.min(8, barWidth / 3).toFixed(1)}" fill="${fill}"/>${count}${label}`;
  }).join('');
}

function frame({ eyebrow, title, scope, subject, body, footer, defs = '' }) {
  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="brandLogoClip"><circle cx="58" cy="54" r="24"/></clipPath>
      <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1926"/><stop offset="0.55" stop-color="#111116"/><stop offset="1" stop-color="#17151f"/></linearGradient>
      ${defs}
      <style>
        text { font-family: Inter, Arial, DejaVu Sans, sans-serif; }
        .eyebrow { font-size: 18px; font-weight: 700; letter-spacing: 2px; fill: ${COLORS.soft}; }
        .title { font-size: 34px; font-weight: 800; fill: ${COLORS.text}; }
        .detail { font-size: 17px; font-weight: 500; fill: ${COLORS.muted}; }
        .section { font-size: 16px; font-weight: 750; letter-spacing: 2.5px; fill: ${COLORS.soft}; }
        .tile-label { font-size: 15px; font-weight: 750; letter-spacing: 2px; fill: ${COLORS.muted}; }
        .tile-value { font-size: 38px; font-weight: 850; }
        .axis { font-size: 15px; font-weight: 600; fill: ${COLORS.muted}; }
        .axis-value { font-size: 14px; font-weight: 700; fill: ${COLORS.soft}; }
        .row-label { font-size: 23px; font-weight: 750; fill: ${COLORS.text}; }
        .row-small { font-size: 19px; font-weight: 700; fill: ${COLORS.text}; }
        .row-sub { font-size: 17px; font-weight: 500; fill: ${COLORS.muted}; }
        .row-value { font-size: 23px; font-weight: 850; fill: ${COLORS.text}; }
        .row-count { font-size: 18px; font-weight: 600; fill: ${COLORS.muted}; }
        .donut-value { font-size: 64px; font-weight: 850; fill: ${COLORS.text}; }
        .donut-label { font-size: 17px; font-weight: 750; letter-spacing: 3px; fill: ${COLORS.muted}; }
        .top { font-size: 20px; font-weight: 750; }
        .empty { font-size: 24px; font-weight: 700; fill: ${COLORS.muted}; }
      </style>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" rx="28" fill="#0c0c10"/>
    <rect x="2" y="2" width="1196" height="696" rx="26" fill="url(#surface)" stroke="${COLORS.line}" stroke-width="2"/>
    ${renderBrandMark()}
    <text x="96" y="47" class="eyebrow">${escapeXml(String(eyebrow).toUpperCase())}</text>
    <text x="96" y="76" class="title">${escapeXml(title)}</text>
    <text x="${RIGHT}" y="49" text-anchor="end" class="eyebrow">${escapeXml(scope)}</text>
    <text x="${RIGHT}" y="78" text-anchor="end" class="title">${escapeXml(truncate(subject, 24))}</text>
    <line x1="${LEFT}" y1="102" x2="${RIGHT}" y2="102" stroke="${COLORS.line}" stroke-width="2"/>
    ${body}
    <line x1="${LEFT}" y1="626" x2="${RIGHT}" y2="626" stroke="${COLORS.line}" stroke-width="2"/>
    <text x="600" y="662" text-anchor="middle" class="detail">${escapeXml(truncate(footer, 110))}</text>
  </svg>`;
}

async function renderSvg(svg) {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = {
  COLORS,
  HEIGHT,
  LEFT,
  PALETTE,
  RIGHT,
  WIDTH,
  bar,
  columnChart,
  escapeXml,
  formatCount,
  formatListened,
  frame,
  percent,
  renderSvg,
  sectionLabel,
  tileRow,
  truncate,
};
