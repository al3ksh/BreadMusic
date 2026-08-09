const fs = require('node:fs/promises');
const path = require('node:path');
const React = require('../web/node_modules/react');
const { renderToStaticMarkup } = require('../web/node_modules/react-dom/server');
const sharp = require('../web/node_modules/sharp');
const {
  BookOpenText,
  LayoutDashboard,
  Pause,
  Play,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
} = require('../web/node_modules/lucide-react');

const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'discord-player-icons');
const ICON_SIZE = 128;
const GLYPH_SIZE = 92;
const GLYPH_OFFSET = (ICON_SIZE - GLYPH_SIZE) / 2;
const ICON_COLOR = '#ffffff';

const icons = [
  ['previous', SkipBack],
  ['play', Play],
  ['pause', Pause],
  ['skip', SkipForward],
  ['stop', Square],
  ['loop', Repeat2],
  ['shuffle', Shuffle],
  ['lyrics', BookOpenText],
  ['dashboard', LayoutDashboard],
];

function renderIcon(Icon) {
  const glyph = renderToStaticMarkup(React.createElement(Icon, {
    color: ICON_COLOR,
    fill: 'none',
    size: GLYPH_SIZE,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 2.35,
  }));

  return Buffer.from([
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">`,
    `<g transform="translate(${GLYPH_OFFSET} ${GLYPH_OFFSET})">${glyph}</g>`,
    '</svg>',
  ].join(''));
}

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]);
}

async function buildPreview(generated) {
  const tileWidth = 156;
  const tileHeight = 184;
  const padding = 20;
  const width = padding * 2 + tileWidth * generated.length;
  const height = padding * 2 + tileHeight;
  const tiles = generated.map(({ name, png }, index) => {
    const x = padding + index * tileWidth;
    const icon = png.toString('base64');
    return [
      `<rect x="${x + 8}" y="${padding + 8}" width="140" height="140" rx="18" fill="#232326" stroke="#3b3b42"/>`,
      `<image href="data:image/png;base64,${icon}" x="${x + 14}" y="${padding + 14}" width="128" height="128"/>`,
      `<text x="${x + 78}" y="${padding + 172}" text-anchor="middle" fill="#d8d8df" font-family="Arial, sans-serif" font-size="15" font-weight="600">${escapeXml(name)}</text>`,
    ].join('');
  }).join('');

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#111113"/>${tiles}</svg>`,
  );
  await sharp(svg).png().toFile(path.join(OUTPUT_DIR, 'preview.png'));
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const generated = [];

  for (const [name, Icon] of icons) {
    const png = await sharp(renderIcon(Icon)).png().toBuffer();
    await fs.writeFile(path.join(OUTPUT_DIR, `${name}.png`), png);
    generated.push({ name, png });
  }

  await buildPreview(generated);
  console.log(`Generated ${generated.length} Discord player icons in ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
