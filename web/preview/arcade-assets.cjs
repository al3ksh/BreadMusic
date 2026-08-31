const fs = require('node:fs/promises');
const path = require('node:path');
const { renderArcadeImage } = require('../../src/games/arcadeRenderer');
const { renderAnimation } = require('../../src/games/arcadeAnimationCore');

async function main() {
  const rounds = [
    ['\uD83C\uDF5E', '\uD83C\uDF52', '\uD83D\uDC8E'],
    ['\uD83D\uDD14', '\uD83D\uDD14', '\uD83C\uDF52'],
    ['\uD83C\uDF5E', '\uD83C\uDF5E', '\uD83C\uDF5E'],
    ['\uD83D\uDC8E', '\uD83C\uDF52', '\uD83D\uDD14'],
  ];
  for (const [index, symbols] of rounds.entries()) {
    const matched = new Set(symbols).size < 3;
    const input = {
      type: 'slots', title: 'Slots', username: 'You', status: matched ? 'YOU WIN' : 'HOUSE WINS',
      detail: 'Just for fun', accent: matched ? '#61d59b' : '#ef6877',
      data: { symbols }, metrics: [{ label: 'BET', value: 'JUST FOR FUN' }, { label: 'MULTIPLIER', value: matched ? 'WIN' : '0x' }, { label: 'BALANCE', value: '0 BREAD' }],
    };
    const prefix = path.resolve(__dirname, `../public/assets/landing-preview/slots-${index}`);
    await fs.writeFile(`${prefix}.png`, await renderArcadeImage(input));
    await fs.writeFile(`${prefix}.gif`, await renderAnimation('slots', input));
  }
  console.log('Rendered four sample rounds with the actual bot image and animation renderers. No economy imports.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
