const SLOTS_SYMBOLS = ['🍞', '🍒', '🔔', '💎', '7️⃣'];
const SLOTS_MULTIPLIERS = {
  '🍞🍞🍞': 2,
  '🍒🍒🍒': 3,
  '🔔🔔🔔': 5,
  '💎💎💎': 10,
  '7️⃣7️⃣7️⃣': 25,
};
const SLOTS_PAIR_MULTIPLIER = 1.25;
const COINFLIP_WIN_CHANCE = 0.48;
const COINFLIP_MULTIPLIER = 2;
const ROULETTE_EVEN_MONEY_MULTIPLIER = 2;
const ROULETTE_GREEN_MULTIPLIER = 35;
const ROULETTE_NUMBER_MULTIPLIER = 35;

function roundExpectedPayout(value, random = Math.random) {
  const base = Math.floor(value);
  const fraction = value - base;
  return base + (fraction > 0 && random() < fraction ? 1 : 0);
}

function calculateFixedOddsRtp() {
  const symbolCount = SLOTS_SYMBOLS.length;
  const slotsOutcomes = symbolCount ** 3;
  const tripleReturn = Object.values(SLOTS_MULTIPLIERS)
    .reduce((total, multiplier) => total + multiplier, 0) / slotsOutcomes;
  const exactPairOutcomes = symbolCount * (symbolCount - 1) * 3;
  const pairReturn = (exactPairOutcomes * SLOTS_PAIR_MULTIPLIER) / slotsOutcomes;

  return {
    slots: tripleReturn + pairReturn,
    coinflip: COINFLIP_WIN_CHANCE * COINFLIP_MULTIPLIER,
    rouletteEvenMoney: (18 / 37) * ROULETTE_EVEN_MONEY_MULTIPLIER,
    rouletteGreen: (1 / 37) * ROULETTE_GREEN_MULTIPLIER,
    rouletteNumber: (1 / 37) * ROULETTE_NUMBER_MULTIPLIER,
  };
}

module.exports = {
  COINFLIP_MULTIPLIER,
  COINFLIP_WIN_CHANCE,
  ROULETTE_EVEN_MONEY_MULTIPLIER,
  ROULETTE_GREEN_MULTIPLIER,
  ROULETTE_NUMBER_MULTIPLIER,
  SLOTS_MULTIPLIERS,
  SLOTS_PAIR_MULTIPLIER,
  SLOTS_SYMBOLS,
  calculateFixedOddsRtp,
  roundExpectedPayout,
};
