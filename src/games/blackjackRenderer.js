const sharp = require('sharp');
const { renderBrandMark } = require('./brandAssets');

const WIDTH = 1200;
const HEIGHT = 700;
const SUIT_CODES = {
  '♠': '&#9824;',
  '♥': '&#9829;',
  '♦': '&#9830;',
  '♣': '&#9827;',
};

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function compactNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Number(value) || 0));
}

function truncate(value, maxLength) {
  const text = String(value ?? 'Player');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function cardColor(suit) {
  return suit === '♥' || suit === '♦' ? '#dc5d6b' : '#1a1a22';
}

function renderCard(card, x, y, hidden = false) {
  if (hidden) {
    return `
      <g transform="translate(${x} ${y})">
        <rect width="112" height="154" rx="12" fill="#7164cf" stroke="#978cf0" stroke-width="3"/>
        <rect x="10" y="10" width="92" height="134" rx="8" fill="none" stroke="#aaa2f5" stroke-width="2" opacity="0.7"/>
        <path d="M24 31 L88 123 M88 31 L24 123" stroke="#c8c3ff" stroke-width="8" opacity="0.32"/>
        <circle cx="56" cy="77" r="25" fill="#17171d" stroke="#c8c3ff" stroke-width="3"/>
        <text x="56" y="88" text-anchor="middle" class="card-back">B</text>
      </g>`;
  }

  const color = cardColor(card.suit);
  const suit = SUIT_CODES[card.suit] ?? escapeXml(card.suit);
  const rank = escapeXml(card.rank);
  return `
    <g transform="translate(${x} ${y})" filter="url(#cardShadow)">
      <rect width="112" height="154" rx="12" fill="#f6f4f1" stroke="#d8d5d2" stroke-width="2"/>
      <text x="15" y="37" class="card-rank" fill="${color}">${rank}</text>
      <text x="15" y="65" class="card-suit-small" fill="${color}">${suit}</text>
      <text x="56" y="105" text-anchor="middle" class="card-suit" fill="${color}">${suit}</text>
      <g transform="translate(112 154) rotate(180)">
        <text x="15" y="37" class="card-rank" fill="${color}">${rank}</text>
        <text x="15" y="65" class="card-suit-small" fill="${color}">${suit}</text>
      </g>
    </g>`;
}

function renderHand(cards, y, hideSecondCard) {
  const count = Math.max(1, cards.length);
  const availableWidth = 770;
  const spacing = count <= 6 ? 128 : Math.max(58, (availableWidth - 112) / (count - 1));
  const totalWidth = 112 + spacing * (count - 1);
  const startX = 600 - totalWidth / 2;

  return cards
    .map((card, index) => renderCard(card, Math.round(startX + index * spacing), y, hideSecondCard && index === 1))
    .join('');
}

function outcome(game) {
  if (!game.finished) {
    return { label: 'YOUR TURN', detail: 'Hit, stand, or double down', color: '#8f82eb' };
  }

  const result = String(game.result ?? '').toLowerCase();
  if (result.includes('blackjack')) {
    return { label: 'BLACKJACK', detail: game.result, color: '#61d59b' };
  }
  if (result.includes('push')) {
    return { label: 'PUSH', detail: game.result, color: '#e9bb63' };
  }
  if (game.winnings > 0) {
    return { label: 'YOU WIN', detail: game.result, color: '#61d59b' };
  }
  if (result.includes('bust')) {
    return { label: 'BUST', detail: game.result, color: '#ef6877' };
  }
  return { label: 'DEALER WINS', detail: game.result || 'Round complete', color: '#ef6877' };
}

function buildBlackjackSvg({ username, game, balance, dealerValue, playerValue }) {
  const state = outcome(game);
  const bet = compactNumber(game.bet);
  const payout = game.finished ? compactNumber(game.winnings) : '—';
  const dealerDisplay = game.finished ? dealerValue : '?';

  return `
  <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="brandLogoClip"><circle cx="58" cy="54" r="24"/></clipPath>
      <filter id="cardShadow" x="-30%" y="-20%" width="160%" height="170%">
        <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000000" flood-opacity="0.35"/>
      </filter>
      <linearGradient id="tableGlow" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1b1926"/>
        <stop offset="0.55" stop-color="#111116"/>
        <stop offset="1" stop-color="#17151f"/>
      </linearGradient>
      <style>
        text { font-family: Inter, Arial, DejaVu Sans, sans-serif; }
        .eyebrow { font-size: 18px; font-weight: 700; letter-spacing: 2px; fill: #a9a4bb; }
        .title { font-size: 34px; font-weight: 750; fill: #f4f2f8; }
        .hand-label { font-size: 20px; font-weight: 700; fill: #b4afc2; }
        .value { font-size: 20px; font-weight: 800; fill: #f4f2f8; }
        .card-rank { font-size: 27px; font-weight: 800; }
        .card-suit-small { font-size: 23px; font-weight: 700; }
        .card-suit { font-size: 48px; font-weight: 700; }
        .card-back { font-size: 38px; font-weight: 900; fill: #eeeaff; }
        .status { font-size: 26px; font-weight: 850; }
        .status-detail { font-size: 17px; font-weight: 500; fill: #aba6b8; }
        .metric-label { font-size: 15px; font-weight: 750; letter-spacing: 1.5px; fill: #8f899e; }
        .metric-value { font-size: 24px; font-weight: 800; fill: #f4f2f8; }
      </style>
    </defs>

    <rect width="1200" height="700" rx="28" fill="#0c0c10"/>
    <rect x="2" y="2" width="1196" height="696" rx="26" fill="url(#tableGlow)" stroke="#302c3f" stroke-width="2"/>
    ${renderBrandMark()}
    <text x="96" y="47" class="eyebrow">BREAD ARCADE</text>
    <text x="96" y="76" class="title">Blackjack</text>
    <text x="1138" y="49" text-anchor="end" class="eyebrow">BET</text>
    <text x="1138" y="78" text-anchor="end" class="title">${bet} BREAD</text>

    <line x1="46" y1="102" x2="1154" y2="102" stroke="#302c3f" stroke-width="2"/>

    <text x="84" y="150" class="hand-label">DEALER</text>
    <rect x="82" y="166" width="66" height="38" rx="19" fill="#24212e" stroke="#383345"/>
    <text x="115" y="192" text-anchor="middle" class="value">${dealerDisplay}</text>
    ${renderHand(game.dealer, 128, !game.finished)}

    <rect x="355" y="314" width="490" height="80" rx="18" fill="#17151e" stroke="${state.color}" stroke-width="2"/>
    <text x="600" y="347" text-anchor="middle" class="status" fill="${state.color}">${escapeXml(state.label)}</text>
    <text x="600" y="376" text-anchor="middle" class="status-detail">${escapeXml(truncate(state.detail, 58))}</text>

    <text x="84" y="446" class="hand-label">${escapeXml(truncate(username, 24).toUpperCase())}</text>
    <rect x="82" y="462" width="66" height="38" rx="19" fill="#29253a" stroke="#4c4569"/>
    <text x="115" y="488" text-anchor="middle" class="value">${playerValue}</text>
    ${renderHand(game.player, 424, false)}

    <rect x="46" y="612" width="1108" height="58" rx="16" fill="#111116" stroke="#292631"/>
    <text x="78" y="637" class="metric-label">BET</text>
    <text x="78" y="661" class="metric-value">${bet} BREAD</text>
    <line x1="360" y1="625" x2="360" y2="657" stroke="#302c3f" stroke-width="2"/>
    <text x="400" y="637" class="metric-label">PAYOUT</text>
    <text x="400" y="661" class="metric-value">${payout} BREAD</text>
    <line x1="760" y1="625" x2="760" y2="657" stroke="#302c3f" stroke-width="2"/>
    <text x="800" y="637" class="metric-label">BALANCE</text>
    <text x="800" y="661" class="metric-value">${compactNumber(balance)} BREAD</text>
  </svg>`;
}

async function renderBlackjackImage(input) {
  const svg = buildBlackjackSvg(input);
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = {
  WIDTH,
  HEIGHT,
  buildBlackjackSvg,
  renderBlackjackImage,
};
