const fs = require('node:fs/promises');
const path = require('node:path');
const { renderArcadeImage } = require('../../src/games/arcadeRenderer');
const { renderBlackjackImage } = require('../../src/games/blackjackRenderer');
async function main() {
  const out = path.resolve(__dirname, '../public/assets/landing-preview');
  await fs.writeFile(path.join(out, 'carousel-rps.png'), await renderArcadeImage({ type: 'rps', title: 'RPS Duel', username: 'You', status: 'YOU WIN', detail: 'Paper covers rock', accent: '#61d59b', data: { playerChoice: 'paper', botChoice: 'rock', playerName: 'You', opponentName: 'Bread' }, metrics: [{ label: 'MODE', value: 'JUST FOR FUN' }, { label: 'YOUR PICK', value: 'PAPER' }, { label: 'BREAD', value: 'ROCK' }] }));
  await fs.writeFile(path.join(out, 'carousel-roulette.png'), await renderArcadeImage({ type: 'roulette', title: 'Roulette', username: 'You', status: 'RED 23', detail: 'Just for fun', accent: '#ef6877', data: { number: 23, color: 'red' }, metrics: [{ label: 'BET', value: 'JUST FOR FUN' }, { label: 'RESULT', value: 'RED 23' }, { label: 'BALANCE', value: 'UNCHANGED' }] }));
  await fs.writeFile(path.join(out, 'carousel-blackjack.png'), await renderBlackjackImage({ username: 'You', balance: 0, dealerValue: 18, playerValue: 21, game: { bet: 0, finished: true, result: 'Blackjack! Just for fun.', winnings: 0, dealer: [{ rank: 'K', suit: '\u2660' }, { rank: '8', suit: '\u2666' }], player: [{ rank: 'A', suit: '\u2660' }, { rank: 'K', suit: '\u2665' }] } }));
  console.log('Rendered RPS, Blackjack and Roulette with production renderers; no economy or bot startup.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
