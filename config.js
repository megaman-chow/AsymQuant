/**
 * Global Configuration
 * Genetic Multi-Timeframe Adaptive Trading System
 */

module.exports = {

  /* --------------------------
     MARKET SETTINGS
  --------------------------- */

  market: {

    symbol: "BTCUSDT",

    timeframes: [
      "5m",
      "15m",
      "1h",
      "4h",
      "1d"
    ],

    minCandles: 100
  },

  /* --------------------------
     POPULATION SETTINGS
  --------------------------- */

  population: {

    size: 300,

    startingBalance: 10000,

    topTraderCount: 10,

    maxOpenTradesPerTrader: 12
  },

  /* --------------------------
     STRATEGY SETTINGS
  --------------------------- */

  strategy: {

    pullbackDepth: 0.002,

    trendThreshold: 0.001,

    minVolumeMultiplier: 0.8
  },

  /* --------------------------
     REGIME DETECTION
  --------------------------- */

  regime: {

    trendStrength: 0.003,

    rangeStrength: 0.001,

    volatilityLow: 0.0015,

    volatilityHigh: 0.004
  },

  /* --------------------------
     RISK MANAGEMENT
  --------------------------- */

  risk: {

    baseRiskPerTrade: 0.02,

    maxPositionSize: 0.1,

    maxDrawdown: 0.30,

    atrStopMultiplier: 1.5,

    atrTakeMultiplier: 2.5
  },

  /* --------------------------
     EVOLUTION SETTINGS
  --------------------------- */

  evolution: {

    interval: 3600000, // 1 hour

    minTrades: 10,

    mutationRate: 0.15,

    eliteSurvivalRate: 0.10,

    cloneRate: 0.30
  },

  /* --------------------------
     SCORING WEIGHTS
  --------------------------- */

  scoring: {

    pnl: 0.6,

    winRate: 0.3,

    avgG: 0.1
  },

  /* --------------------------
     DASHBOARD
  --------------------------- */

  dashboard: {

    refreshInterval: 20000,

    snapshotLogging: true
  }

};
