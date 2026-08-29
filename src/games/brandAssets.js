const fs = require('node:fs');
const path = require('node:path');

const logoPath = path.join(__dirname, '../../assets/breadarcade-logo.png');

let logoDataUri = null;
try {
  logoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
} catch (error) {
  console.warn(`[Arcade] Brand logo unavailable, using the text fallback: ${error.message}`);
}

function renderBrandMark({ x = 34, y = 30, size = 48, clipId = 'brandLogoClip' } = {}) {
  if (!logoDataUri) {
    return `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="#7164cf"/>
      <text x="${x + size / 2}" y="${y + size * 0.7}" text-anchor="middle" font-size="${size * 0.54}" font-weight="900" fill="#ffffff">B</text>`;
  }
  return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${logoDataUri}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>
    <circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2 - 1}" fill="none" stroke="#514a6d" stroke-width="2"/>`;
}

module.exports = { logoDataUri, renderBrandMark };
