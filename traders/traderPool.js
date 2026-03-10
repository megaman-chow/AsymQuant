const config = require("../config");

/**
 * Utility to pick a random element from an array.
 */
function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Creates a trader with a unique genetic profile.
 * Traders are now "Timeframe Specialized" based on the global config.
 */
function createTrader(id, timeframe) {
  return {
    id,
    balance: config.population.startingBalance,
    pnl: 0,
    wins: 0,
    losses: 0,
    totalG: 0,
    score: 0,

    // Genetic DNA
    timeframe, 
    emaFast: rand([10, 20, 30]),
    emaSlow: rand([50, 100, 200]),
    gThreshold: rand([0.3, 0.4, 0.5, 0.6]),
    invert: Math.random() > 0.5,

    openPosition: null
  };
}

/**
 * Populates the trader pool.
 */
function createPool(n) {
  const traders = [];
  const timeframes = config.market.timeframes;

  for (let i = 0; i < n; i++) {
    const tf = timeframes[i % timeframes.length]; // round‑robin across all timeframes
    traders.push(createTrader(i, tf));
  }

  return traders;
}

module.exports = { createPool };
