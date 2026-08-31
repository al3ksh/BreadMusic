const sharp = require('sharp');
const { logoDataUri, renderBrandMark } = require('./brandAssets');

const WIDTH = 1200;
const HEIGHT = 700;

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
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function compactNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Number(value) || 0));
}

function metric(label, value, x, width = 330) {
  return `
    <text x="${x}" y="625" class="metric-label">${escapeXml(label)}</text>
    <text x="${x}" y="654" class="metric-value">${escapeXml(value)}</text>
    <line x1="${x + width}" y1="616" x2="${x + width}" y2="654" stroke="#302c3f" stroke-width="2"/>`;
}

function slotSymbol(symbol) {
  if (symbol === '🍞') {
    return `<path d="M42 112 V82 C42 53 62 35 92 35 H108 C138 35 158 53 158 82 V112 C158 129 146 140 129 140 H71 C54 140 42 129 42 112Z" fill="#e9bb63" stroke="#b98431" stroke-width="6"/>
      <path d="M71 58 C78 72 78 85 70 99 M100 48 C108 64 108 80 99 96 M130 58 C137 72 137 85 129 99" fill="none" stroke="#fff0c4" stroke-width="8" stroke-linecap="round"/>`;
  }
  if (symbol === '🍒') {
    return `<path d="M98 69 C103 43 120 29 145 26 M102 69 C95 48 82 38 62 35" fill="none" stroke="#4f9d69" stroke-width="9" stroke-linecap="round"/>
      <path d="M121 36 C136 23 153 22 167 30 C153 45 137 49 121 36Z" fill="#61d59b"/>
      <circle cx="72" cy="111" r="34" fill="#ef6877" stroke="#bd3e50" stroke-width="6"/>
      <circle cx="132" cy="111" r="34" fill="#dc4f61" stroke="#bd3e50" stroke-width="6"/>
      <circle cx="61" cy="99" r="8" fill="#ffd7db" opacity="0.8"/>`;
  }
  if (symbol === '🔔') {
    return `<path d="M47 123 H153 L138 104 V78 C138 51 122 35 100 35 C78 35 62 51 62 78 V104Z" fill="#e9bb63" stroke="#b98431" stroke-width="6" stroke-linejoin="round"/>
      <path d="M48 123 H152" stroke="#fff0c4" stroke-width="9" stroke-linecap="round"/>
      <circle cx="100" cy="142" r="14" fill="#d49a3e" stroke="#b98431" stroke-width="5"/>
      <path d="M77 68 C80 54 88 48 98 46" fill="none" stroke="#fff0c4" stroke-width="8" stroke-linecap="round" opacity="0.75"/>`;
  }
  if (symbol === '💎') {
    return `<path d="M30 72 L62 34 H138 L170 72 L100 151Z" fill="#78c8ee" stroke="#3f91bd" stroke-width="6" stroke-linejoin="round"/>
      <path d="M30 72 H170 M62 34 L78 72 L100 151 M138 34 L122 72 L100 151 M78 72 H122" fill="none" stroke="#d8f4ff" stroke-width="5" stroke-linejoin="round" opacity="0.85"/>`;
  }
  return `<path d="M52 39 H153 L139 69 H104 L73 151 H37 L72 69 H52Z" fill="#8f82eb" stroke="#574da3" stroke-width="7" stroke-linejoin="round"/>
    <path d="M68 53 H134" stroke="#d9d3ff" stroke-width="7" stroke-linecap="round" opacity="0.75"/>`;
}

function slotsVisual(data) {
  return data.symbols.map((symbol, index) => {
    const x = 260 + index * 240;
    return `<g transform="translate(${x} 242)">
      <rect width="200" height="190" rx="22" fill="#f4f2f0" stroke="#d8d4de" stroke-width="3"/>
      ${slotSymbol(symbol)}
    </g>`;
  }).join('');
}

function rouletteVisual(data) {
  const color = data.color === 'red' ? '#dc5d6b' : data.color === 'green' ? '#43b581' : '#2b2b35';
  const ballAngle = Number.isFinite(data.ballAngle) ? data.ballAngle : -Math.PI / 2;
  const rotation = Number.isFinite(data.rotation) ? data.rotation : 0;
  const ballX = Math.cos(ballAngle) * 160;
  const ballY = Math.sin(ballAngle) * 160;
  const ticks = Array.from({ length: 18 }, (_, index) => {
    const angle = rotation + index * 20;
    const tickColor = index % 2 === 0 ? '#dc5d6b' : '#262630';
    return `<rect x="-8" y="-145" width="16" height="34" rx="4" fill="${tickColor}" transform="rotate(${angle})"/>`;
  }).join('');
  return `<g transform="translate(600 334)">
    <circle r="148" fill="#121218" stroke="#393442" stroke-width="24"/>
    ${ticks}
    <circle r="110" fill="${color}" stroke="#eeeaf5" stroke-width="4"/>
    <text y="32" text-anchor="middle" font-size="92" font-weight="900" fill="#ffffff">${escapeXml(data.number)}</text>
    <circle cx="${ballX.toFixed(2)}" cy="${ballY.toFixed(2)}" r="12" fill="#f4f2f8"/>
  </g>`;
}

function coinVisual(data) {
  const heads = data.result === 'heads';
  const scaleX = Number.isFinite(data.scaleX) ? Math.max(0.08, Math.abs(data.scaleX)) : 1;
  const face = heads && logoDataUri
    ? `<image x="-82" y="-82" width="164" height="164" href="${logoDataUri}" preserveAspectRatio="xMidYMid slice" clip-path="url(#coinLogoClip)"/>
      <circle r="83" fill="none" stroke="#fff0c4" stroke-width="5"/>`
    : `<path d="M-64 43 V-3 C-64-44-35-67 0-67 C35-67 64-44 64-3 V43 C64 61 51 72 32 72 H-32 C-51 72-64 61-64 43Z" fill="#f1c96f" stroke="#fff0c4" stroke-width="7"/>
      <path d="M-36-36 C-25-19-25-2-36 14 M0-50 C11-29 11-9 0 12 M36-36 C47-19 47-2 36 14" fill="none" stroke="#fff8dc" stroke-width="9" stroke-linecap="round"/>`;
  return `<g transform="translate(600 334)" filter="url(#shadow)">
    <g transform="scale(${scaleX.toFixed(3)} 1)">
    <circle r="145" fill="${heads ? '#e9bb63' : '#7164cf'}" stroke="${heads ? '#ffe1a0' : '#aaa2f5'}" stroke-width="12"/>
    <circle r="112" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.38"/>
    ${face}
    </g>
  </g>`;
}

function rpsMark(choice, accent) {
  if (choice === 'rock') {
    return `<path d="M96 93 L122 49 L179 35 L225 67 L235 120 L205 154 L143 160 L96 132 Z" fill="${accent}" opacity="0.95"/>
      <path d="M122 49 L145 91 L205 73 M145 91 L143 160" fill="none" stroke="#ffffff" stroke-width="6" opacity="0.25"/>`;
  }
  if (choice === 'paper') {
    return `<rect x="103" y="31" width="114" height="139" rx="12" fill="#f4f2f0" stroke="${accent}" stroke-width="7"/>
      <path d="M125 68 H196 M125 94 H196 M125 120 H178" stroke="#777181" stroke-width="7" stroke-linecap="round"/>`;
  }
  if (choice === 'scissors') {
    return `<circle cx="126" cy="137" r="24" fill="none" stroke="${accent}" stroke-width="12"/>
      <circle cx="192" cy="137" r="24" fill="none" stroke="${accent}" stroke-width="12"/>
      <path d="M143 120 L218 43 M176 119 L102 43" stroke="#f4f2f0" stroke-width="14" stroke-linecap="round"/>
      <circle cx="159" cy="104" r="9" fill="${accent}"/>`;
  }
  return `<circle cx="160" cy="94" r="54" fill="#262330" stroke="${accent}" stroke-width="5" stroke-dasharray="12 9"/>
    <text x="160" y="111" text-anchor="middle" font-size="52" font-weight="900" fill="${accent}">?</text>`;
}

function rpsIcon(choice, x, owner, accent) {
  const labels = { rock: 'ROCK', paper: 'PAPER', scissors: 'SCISSORS' };
  return `<g transform="translate(${x} 236)">
    <rect width="320" height="218" rx="26" fill="#15141b" stroke="${accent}" stroke-width="3"/>
    ${rpsMark(choice, accent)}
    <text x="160" y="180" text-anchor="middle" class="choice">${labels[choice] || 'HIDDEN'}</text>
    <text x="160" y="207" text-anchor="middle" class="owner">${escapeXml(truncate(owner, 22))}</text>
  </g>`;
}

function rpsVisual(data) {
  return `${rpsIcon(data.playerChoice, 210, data.playerName, '#8f82eb')}
    <text x="600" y="356" text-anchor="middle" font-size="35" font-weight="900" fill="#918b9e">VS</text>
    ${rpsIcon(data.botChoice, 670, data.opponentName || 'Bread', '#e9bb63')}`;
}

function ballVisual(data) {
  return `<g transform="translate(600 328)" filter="url(#shadow)">
    <circle r="165" fill="#0b0b0e" stroke="#393442" stroke-width="7"/>
    <circle r="86" fill="#6256bb" stroke="#8f82eb" stroke-width="5"/>
    <path d="M0 -65 L58 43 L-58 43 Z" fill="#17151f" opacity="0.82"/>
    <circle cx="0" cy="-3" r="17" fill="#f4f2f8" opacity="0.9"/>
    <path d="M-31 42 H31" stroke="#f4f2f8" stroke-width="8" stroke-linecap="round" opacity="0.9"/>
  </g>`;
}

function diceVisual(data) {
  const values = data.rolls.slice(0, 8);
  const size = values.length > 4 ? 116 : 146;
  const gap = 22;
  const total = values.length * size + Math.max(0, values.length - 1) * gap;
  const start = Math.max(54, (WIDTH - total) / 2);
  return values.map((value, index) => `<g transform="translate(${start + index * (size + gap)} ${286 - size / 2})">
    <rect width="${size}" height="${size}" rx="22" fill="#f4f2f0" stroke="#d8d4de" stroke-width="3"/>
    <text x="${size / 2}" y="${size / 2 + 24}" text-anchor="middle" font-size="68" font-weight="900" fill="#292533">${escapeXml(value)}</text>
  </g>`).join('');
}

function visual(type, data) {
  if (type === 'slots') return slotsVisual(data);
  if (type === 'roulette') return rouletteVisual(data);
  if (type === 'coinflip') return coinVisual(data);
  if (type === 'rps') return rpsVisual(data);
  if (type === '8ball') return ballVisual(data);
  if (type === 'dice') return diceVisual(data);
  return '';
}

function buildArcadeSvg({ type, title, username, status, detail, accent = '#8f82eb', data = {}, metrics = [] }) {
  const normalizedMetrics = metrics.slice(0, 3);
  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="brandLogoClip"><circle cx="58" cy="54" r="24"/></clipPath>
      <clipPath id="coinLogoClip"><circle cx="0" cy="0" r="82"/></clipPath>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity="0.4"/></filter>
      <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1926"/><stop offset="0.55" stop-color="#111116"/><stop offset="1" stop-color="#17151f"/></linearGradient>
      <style>
        text { font-family: Inter, Arial, DejaVu Sans, sans-serif; }
        .eyebrow { font-size: 18px; font-weight: 700; letter-spacing: 2px; fill: #a9a4bb; }
        .title { font-size: 34px; font-weight: 800; fill: #f4f2f8; }
        .status { font-size: 27px; font-weight: 850; }
        .detail { font-size: 18px; font-weight: 500; fill: #aaa5b6; }
        .metric-label { font-size: 15px; font-weight: 750; letter-spacing: 1.5px; fill: #8f899e; }
        .metric-value { font-size: 24px; font-weight: 800; fill: #f4f2f8; }
        .tile-label { font-size: 17px; font-weight: 850; letter-spacing: 1px; fill: #34303e; }
        .choice { font-size: 28px; font-weight: 900; fill: #f4f2f8; }
        .owner { font-size: 18px; font-weight: 600; fill: #aaa5b6; }
      </style>
    </defs>
    <rect width="1200" height="700" rx="28" fill="#0c0c10"/>
    <rect x="2" y="2" width="1196" height="696" rx="26" fill="url(#surface)" stroke="#302c3f" stroke-width="2"/>
    ${renderBrandMark()}
    <text x="96" y="47" class="eyebrow">BREAD ARCADE</text><text x="96" y="76" class="title">${escapeXml(title)}</text>
    <text x="1138" y="49" text-anchor="end" class="eyebrow">PLAYER</text><text x="1138" y="78" text-anchor="end" class="title">${escapeXml(truncate(username, 22))}</text>
    <line x1="46" y1="102" x2="1154" y2="102" stroke="#302c3f" stroke-width="2"/>
    ${visual(type, data)}
    <rect x="330" y="490" width="540" height="83" rx="18" fill="#17151e" stroke="${accent}" stroke-width="2"/>
    <text x="600" y="524" text-anchor="middle" class="status" fill="${accent}">${escapeXml(status)}</text>
    <text x="600" y="554" text-anchor="middle" class="detail">${escapeXml(truncate(detail, 72))}</text>
    <rect x="46" y="596" width="1108" height="74" rx="16" fill="#111116" stroke="#292631"/>
    ${normalizedMetrics.map((item, index) => metric(item.label, item.value, 78 + index * 370, 330)).join('')}
  </svg>`;
}

async function renderArcadeImage(input) {
  return sharp(Buffer.from(buildArcadeSvg(input))).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { WIDTH, HEIGHT, compactNumber, buildArcadeSvg, renderArcadeImage };
