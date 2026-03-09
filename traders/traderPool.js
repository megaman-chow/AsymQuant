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
function createTrader(id) {
  return {
    id,
    balance: config.startingBalance,
    pnl: 0,
    wins: 0,
    losses: 0,
    totalG: 0,
    score: 0,

    // Genetic DNA
    timeframe: rand(config.timeframes), 
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
  for (let i = 0; i < n; i++) {
    traders.push(createTrader(i));
  }
  return traders;
}

module.exports = { createPool };
