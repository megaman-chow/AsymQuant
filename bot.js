require("dotenv").config();

const config = require("./config");

const { connect } = require("./exchange/binance");
const { CandleEngine } = require("./engine/candleEngine");
const { computeIndicators } = require("./engine/indicatorEngine");

const { createPool } = require("./traders/traderPool");
const { evaluate } = require("./strategies/strategyV3");

const { processTrader } = require("./engine/traderEngine");
const { renderDashboard } = require("./engine/dashboard");

const { evolve } = require("./engine/evolutionEngine");

const { sendAlert } = require("./engine/notifier");

const {
  savePopulation,
  loadPopulation
} = require("./engine/persistenceEngine");


/* ==================================================
   INITIALIZE
================================================== */

const candleEngine = new CandleEngine();

const restored = loadPopulation();

// Ensure every timeframe has traders, even when restoring older state
function normalizeTimeframes(traders, timeframes) {
  if (!Array.isArray(traders) || !traders.length) return traders;
  if (!Array.isArray(timeframes) || !timeframes.length) return traders;

  // Simple round‑robin reassignment so each timeframe gets coverage
  return traders.map((t, idx) => ({
    ...t,
    timeframe: timeframes[idx % timeframes.length]
  }));
}

let traders =
  restored
    ? normalizeTimeframes(restored, config.market.timeframes)
    : createPool(config.population.size);


/* ==================================================
   START ALERT
================================================== */

sendAlert(
`🚀 Bot Started

Symbol: ${config.market.symbol}

Mode: ${restored ? "RESUME" : "FRESH START"}

Population: ${traders.length}

Timeframes: ${config.market.timeframes.join(", ")}
`
);


/* ==================================================
   DASHBOARD LOOP
================================================== */

setInterval(() => {

  traders.forEach(t => {

    t.score =
      t.balance - config.population.startingBalance;

  });

  renderDashboard(traders);

}, config.dashboard.refreshInterval || 5000);


/* ==================================================
   AUTO SAVE
================================================== */

setInterval(() => {

  savePopulation(traders);

}, 600000); // 10 min


/* ==================================================
   EVOLUTION ENGINE
================================================== */

setInterval(() => {

  traders = evolve(traders);

  savePopulation(traders);

  const totalEquity =
    traders.reduce(
      (sum, t) => sum + t.balance,
      0
    );

  sendAlert(
`🧬 Evolution Complete

Pool Equity: $${totalEquity.toFixed(2)}

Population: ${traders.length}`
  );

}, config.evolution.interval);


/* ==================================================
   DATA STREAMS
================================================== */

config.market.timeframes.forEach(tf => {

  connect(
    config.market.symbol,
    tf,
    (timeframe, candle) => {

      const history =
        candleEngine.update(timeframe, candle);

      if (
        history.length <
        config.market.minCandles
      ) return;

      const indicators =
        computeIndicators(history);

      const tfTraders =
        traders.filter(
          t => t.timeframe === timeframe
        );

      if (!tfTraders.length) return;

      tfTraders.forEach(trader => {

        const {
          signal,
          g,
          regime
        } = evaluate(
          history,
          indicators,
          trader
        );

        if (signal) {
          trader.totalG =
            (trader.totalG || 0) + g;
        }

        processTrader(
          trader,
          signal,
          g,
          candle.close,
          indicators.atr
        );

      });

    }
  );

});


/* ==================================================
   SHUTDOWN HANDLERS
================================================== */

process.on("SIGINT", async () => {

  savePopulation(traders);

  await sendAlert(
    "⚠️ Manual Shutdown — state saved."
  );

  process.exit();

});


process.on("uncaughtException", async err => {

  savePopulation(traders);

  await sendAlert(
`❌ BOT CRASH

${err.message}

State saved.`
  );

  process.exit(1);

});
