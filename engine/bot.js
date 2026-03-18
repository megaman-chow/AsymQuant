const fs = require("fs");
const config = require("../config");
const { connect } = require("../exchange/binance");
const { CandleEngine } = require("./engine/candleEngine");
const { createPool } = require("../traders/traderPool");
const { computeIndicators } = require("./engine/indicatorEngine");
const { evaluate } = require("../strategies/strategyV2");
const { processTrader } = require("./engine/traderEngine");
const { renderDashboard } = require("./engine/dashboard");
const { evolve } = require("./engine/evolutionEngine");

const candleEngine = new CandleEngine();
let traders = createPool(config.population.size);

// Initialize CSV file with headers
if (!fs.existsSync("equity_curve.csv")) {
  fs.writeFileSync("equity_curve.csv", "Timestamp,TotalEquity,TopTraderBalance\n");
}

// 1. Dashboard Loop (5s)
setInterval(() => {
  traders.forEach(t => t.score = (t.balance - config.population.startingBalance));
  renderDashboard(traders);
}, 5000);

// 2. Evolution Cycle (6 Hours)
setInterval(() => {
  traders = evolve(traders);
}, 21600000);

// 3. Equity Curve Logger (Every Hour)
setInterval(() => {
  const totalEquity = traders.reduce((sum, t) => sum + t.balance, 0);
  const topTrader = [...traders].sort((a, b) => b.balance - a.balance)[0];
  const timestamp = new Date().toISOString();
  
  const logLine = `${timestamp},${totalEquity.toFixed(2)},${topTrader.balance.toFixed(2)}\n`;
  fs.appendFileSync("equity_curve.csv", logLine);
  
  console.log("📈 Equity log updated in equity_curve.csv");
}, 3600000);

// 4. Data Processing Loop
config.timeframes.forEach(tf => {
config.market.timeframes.forEach(tf => {
  connect(config.market.symbol, tf, (timeframe, candle) => {
    const history = candleEngine.update(timeframe, candle);
    if (history.length < 50) return;

    const indicators = computeIndicators(history);

    traders
      .filter(t => t.timeframe === timeframe)
      .forEach(trader => {
        const { signal, g } = evaluate(history, indicators, trader);
        if (signal) trader.totalG += g;
        processTrader(trader, signal, g, candle.close, indicators.atr);
      });
  });
});
