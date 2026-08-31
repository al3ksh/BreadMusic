const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateFixedOddsRtp, roundExpectedPayout } = require('../src/games/arcadeOdds');

test('fixed-odds Arcade games retain a sustainable house edge', () => {
  const rtp = calculateFixedOddsRtp();
  for (const [game, value] of Object.entries(rtp)) {
    assert.ok(value >= 0.94, `${game} RTP ${value} is too punitive`);
    assert.ok(value <= 0.98, `${game} RTP ${value} does not preserve a house edge`);
  }
  assert.equal(rtp.slots, 0.96);
  assert.equal(rtp.coinflip, 0.96);
  assert.ok(Math.abs(rtp.rouletteEvenMoney - (36 / 37)) < Number.EPSILON);
  assert.ok(Math.abs(rtp.rouletteGreen - (35 / 37)) < Number.EPSILON);
});

test('fractional slot payouts retain integer balances without changing expected value', () => {
  assert.equal(roundExpectedPayout(1.25, () => 0.20), 2);
  assert.equal(roundExpectedPayout(1.25, () => 0.30), 1);
  assert.equal(roundExpectedPayout(5, () => 0), 5);
});
