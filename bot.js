require("dotenv").config();

const config = require("./config");

const { connect } = require("./exchange/binance");
const { CandleEngine } = require("./engine/candleEngine");
const { computeIndicators } = require("./engine/indicatorEngine");

const { createPool } = require("./traders/traderPool");
const { evaluate } = require("./strategies/strategyV2");

const { processTrader } = require("./engine/traderEngine");
const { renderDashboard } = require("./engine/dashboard");

const { evolve } = require("./engine/evolutionEngine");

const { sendAlert } = require("./engine/notifier");
const { createLiveExecutor } = require("./engine/liveExecutionEngine");
const { createTelegramControl } = require("./engine/telegramControl");

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
   LIVE EXECUTION (HYPERLIQUID)
================================================== */

let liveExec = {
  capable: false,
  enabled: false,
  state: { enabled: false },
  onOpened: async () => {},
  onClosed: async () => {},
  setEnabled: async () => {},
  syncFromSim: async () => {},
};

const LIVE_TF = process.env.LIVE_TIMEFRAME || "5m";

(async () => {
  try {
    liveExec = await createLiveExecutor();
    if (liveExec.capable) {
      sendAlert(
        `🧩 Live trading capable (Hyperliquid)\n\nArming: via Telegram button\nCoin: ${liveExec.state.coin}\nTestnet: ${liveExec.state.isTestnet}\nLive TF: ${LIVE_TF}\nMax Notional: $${Number(process.env.LIVE_MAX_NOTIONAL_USD || 50)}`
      );
    } else {
      sendAlert("🧪 Live trading not enabled (simulation only).");
    }

    // Telegram button controller
    createTelegramControl({
      getState: () => ({
        capable: !!liveExec.capable,
        enabled: !!liveExec.state?.enabled,
        coin: liveExec.state?.coin,
        isTestnet: !!liveExec.state?.isTestnet,
      }),
      onToggle: async (nextEnabled) => {
        if (!liveExec.capable) {
          await sendAlert("❌ Live trading not capable. Set LIVE_TRADING env + confirmation first.");
          return;
        }

        await liveExec.setEnabled(nextEnabled);

        // When enabling, immediately sync to current 5m winner state (no waiting).
        if (nextEnabled) {
          const tfTraders = traders.filter((t) => (t.timeframe || "unknown") === LIVE_TF);
          if (tfTraders.length) {
            let leader = tfTraders[0];
            for (let i = 1; i < tfTraders.length; i++) {
              if ((tfTraders[i].score || 0) > (leader.score || 0)) leader = tfTraders[i];
            }
            await liveExec.syncFromSim(leader.openPosition);
          }
          await sendAlert(`🟢 LIVE TRADING ARMED (TF=${LIVE_TF})`);
        } else {
          await sendAlert(`⚪ LIVE TRADING DISARMED (TF=${LIVE_TF})`);
        }
      },
    });
  } catch (err) {
    console.error("Live executor init failed:", err && err.stack ? err.stack : err);
    sendAlert(`❌ Live executor init failed\n\n${err.message || err}`);
  }
})();

/* ==================================================
   TELEGRAM: TRADE + TIMEFRAME UPDATES (BATCHED)
================================================== */

const TELEGRAM_FLUSH_MS = 15000;
const TELEGRAM_MAX_LINES = 20;
const TELEGRAM_TF_SUMMARY_MS = 30 * 60 * 1000;

let telegramQueue = [];

function qTelegram(line) {
  if (!line) return;
  telegramQueue.push(line);
  // prevent unbounded growth if market is very active
  if (telegramQueue.length > 200) {
    telegramQueue = telegramQueue.slice(-200);
  }
}

function flushTelegramQueue() {
  if (!telegramQueue.length) return;
  const lines = telegramQueue.splice(0, TELEGRAM_MAX_LINES);
  const more = telegramQueue.length;
  const header = `📣 *Trade Updates* (${config.market.symbol})`;
  const footer = more > 0 ? `\n…plus *${more}* more queued` : "";
  sendAlert([header, "", ...lines].join("\n") + footer);
}

setInterval(flushTelegramQueue, TELEGRAM_FLUSH_MS);

function formatMoney(n) {
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function formatTradeLine(type, trader, timeframe, details) {
  const id = String(trader.id).slice(0, 8);
  if (type === "OPEN") {
    return `• *${timeframe}* \`${id}\` OPEN *${details.side}* @ *$${details.entry.toFixed(
      2
    )}*  g=${details.g.toFixed(3)}`;
  }
  if (type === "CLOSE") {
    return `• *${timeframe}* \`${id}\` CLOSE *${details.side}* ${details.hit} @ *$${details.exit.toFixed(
      2
    )}*  PnL *${formatMoney(details.pnl)}*  Bal *$${trader.balance.toFixed(2)}*`;
  }
  return null;
}

function sendTimeframeSummary() {
  const tfStats = {};
  for (const t of traders) {
    const tf = t.timeframe || "unknown";
    if (!tfStats[tf]) {
      tfStats[tf] = { count: 0, open: 0, equity: 0, wins: 0, losses: 0 };
    }
    tfStats[tf].count++;
    tfStats[tf].equity += t.balance || 0;
    tfStats[tf].wins += t.wins || 0;
    tfStats[tf].losses += t.losses || 0;
    if (t.openPosition) tfStats[tf].open++;
  }

  const lines = config.market.timeframes.map(tf => {
    const s = tfStats[tf] || { count: 0, open: 0, equity: 0, wins: 0, losses: 0 };
    const trades = s.wins + s.losses;
    const wr = trades ? ((s.wins / trades) * 100).toFixed(1) : "—";
    const avgEq = s.count ? (s.equity / s.count).toFixed(2) : "—";
    return `• *${tf}*: traders=${s.count} open=${s.open} avgBal=$${avgEq} WR=${wr}%`;
  });

  sendAlert(
    [
      `🧭 *Timeframe Summary* (${config.market.symbol})`,
      "",
      ...lines
    ].join("\n")
  );
}

setInterval(sendTimeframeSummary, TELEGRAM_TF_SUMMARY_MS);


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

      // Leader = highest score trader in this timeframe (mirrors into ONE live position)
      let leader = tfTraders[0];
      for (let i = 1; i < tfTraders.length; i++) {
        if ((tfTraders[i].score || 0) > (leader.score || 0)) leader = tfTraders[i];
      }

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

        const events = processTrader(
          trader,
          signal,
          g,
          candle.close,
          indicators.atr
        );

        if (events?.opened) {
          qTelegram(formatTradeLine("OPEN", trader, timeframe, events.opened));
          if (timeframe === LIVE_TF && liveExec.state?.enabled && trader.id === leader.id) {
            liveExec.onOpened({ side: events.opened.side, g: events.opened.g }).catch((e) => {
              console.error("Live open failed:", e && e.stack ? e.stack : e);
              sendAlert(`❌ Live OPEN failed\n\n${e.message || e}`);
            });
          }
        }

        if (events?.closed) {
          qTelegram(formatTradeLine("CLOSE", trader, timeframe, events.closed));
          if (timeframe === LIVE_TF && liveExec.state?.enabled && trader.id === leader.id) {
            liveExec.onClosed().catch((e) => {
              console.error("Live close failed:", e && e.stack ? e.stack : e);
              sendAlert(`❌ Live CLOSE failed\n\n${e.message || e}`);
            });
          }
        }

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

  console.error("❌ BOT CRASH:", err && err.stack ? err.stack : err);

  await sendAlert(
`❌ BOT CRASH

${err.message}

State saved.`
  );

  process.exit(1);

});
