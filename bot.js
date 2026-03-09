const fs = require("fs");
require('dotenv').config();
const config = require("./config");
const { connect } = require("./exchange/binance");
const { CandleEngine } = require("./engine/candleEngine");
const { createPool } = require("./traders/traderPool");
const { computeIndicators } = require("./engine/indicatorEngine");
const { evaluate } = require("./strategies/strategyV2");
const { processTrader } = require("./engine/traderEngine");
const { renderDashboard } = require("./engine/dashboard");
const { evolve } = require("./engine/evolutionEngine");
const { sendAlert } = require("./engine/notifier");
const { savePopulation, loadPopulation } = require("./engine/persistenceEngine");

const candleEngine = new CandleEngine();

// 1. Initialize Traders (Resume or Start Fresh)
const restored = loadPopulation();
let traders = restored || createPool(config.virtualTraders);

// 2. Lifecycle Notifications
sendAlert(`🚀 *Bot Started:* ${config.symbol}
Mode: ${restored ? "RESUME" : "FRESH START"}
Pop: ${traders.length} traders across ${config.timeframes.length} TFs`);

// 3. Periodic Loops
setInterval(() => {
  traders.forEach(t => t.score = (t.balance - 10000));
  renderDashboard(traders);
}, 5000);

// Auto-Save every 10 minutes
setInterval(() => savePopulation(traders), 600000);

// Evolution Cycle
setInterval(() => {
  traders = evolve(traders);
  savePopulation(traders); // Save immediately after evolution
  const totalEquity = traders.reduce((sum, t) => sum + t.balance, 0);
  sendAlert(`🧬 *Evolution Complete*\nPool Equity: $${totalEquity.toFixed(2)}`);
}, config.evolutionInterval || 21600000);

// 4. Data Streams
config.timeframes.forEach(tf => {
  connect(config.symbol, tf, (timeframe, candle) => {
    const history = candleEngine.update(timeframe, candle);
    if (history.length < 50) return;
    const indicators = computeIndicators(history);

    traders.filter(t => t.timeframe === timeframe).forEach(trader => {
      const { signal, g } = evaluate(history, indicators, trader);
      if (signal) trader.totalG += g;
      processTrader(trader, signal, g, candle.close, indicators.atr);
    });
  });
});

// Shutdown Handlers
process.on('SIGINT', async () => {
  savePopulation(traders);
  await sendAlert("⚠️ *Manual Shutdown:* State saved. Bot offline.");
  process.exit();
});

process.on('uncaughtException', async (err) => {
  savePopulation(traders);
  await sendAlert(`❌ *CRASH:* ${err.message}. State saved.`);
  process.exit(1);
});
