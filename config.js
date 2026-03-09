/**
 * Global Configuration for Multi-Timeframe Adaptive Bot
 */
module.exports = {
  // Market Settings
  symbol: "BTCUSDT",
  timeframes: ["5m", "15m", "1h", "4h", "1d"],

  // Population Settings
  virtualTraders: 300,
  startingBalance: 10000,
  topTraderCount: 5,

  // Risk Management
  riskPerTrade: 0.02, // 2% base risk
  
  // Evolution Settings
  evolutionInterval: 3600000, // 1 Hour
  minTradesForEvolution: 10,
  
  // Scoring Weights
  weights: {
    pnl: 0.6,
    winRate: 0.3,
    avgG: 0.1
  }
}
