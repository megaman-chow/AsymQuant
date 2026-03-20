require("dotenv").config();

const config = require("./config");

const { connect } = require("./exchange/binance");
const {
  fetchClosedKlines,
  fetchClosedKlinesBetween,
  intervalToMs,
} = require("./exchange/binanceKlines");
const { CandleEngine } = require("./engine/candleEngine");
const { computeIndicators } = require("./engine/indicatorEngine");

const { createPool } = require("./traders/traderPool");
const { evaluate } = require("./strategies/strategyV2");

const { processTrader } = require("./engine/traderEngine");
const { renderDashboard } = require("./engine/dashboard");

const { evolve } = require("./engine/evolutionEngine");
const { hashSeed, createSeededRandom } = require("./engine/seededRandom");
const { createEventBuffer } = require("./engine/eventBuffer");

const { sendAlert } = require("./engine/notifier");
const { createLiveExecutor } = require("./engine/liveExecutionEngine");
const { createTelegramControl } = require("./engine/telegramControl");
const { startApiServer } = require("./api/server");

const {
  savePopulation,
  loadPopulation,
  saveRuntimeState,
  loadRuntimeState,
} = require("./engine/persistenceEngine");


/* ==================================================
   INITIALIZE
================================================== */

const candleEngine = new CandleEngine();

const restored = loadPopulation();
const restoredRuntime = loadRuntimeState();

function createDefaultRuntimeState() {
  return {
    version: 1,
    lastProcessedByTimeframe: {},
    lastEvolutionAt: null,
    lastReplayAt: null,
    lastReplaySummary: null,
    evolutionCount: 0,
    rngSeed: null,
    rngState: null,
  };
}

const runtimeState = {
  ...createDefaultRuntimeState(),
  ...(restoredRuntime || {}),
};

runtimeState.lastProcessedByTimeframe =
  runtimeState.lastProcessedByTimeframe || {};

if (!runtimeState.rngSeed) {
  runtimeState.rngSeed = String(
    process.env.SIM_SEED ||
    process.env.RNG_SEED ||
    "tradingbot-default"
  );
}

if (!Number.isFinite(Number(runtimeState.rngState))) {
  runtimeState.rngState = hashSeed(runtimeState.rngSeed);
}

if (!Number.isFinite(Number(runtimeState.evolutionCount))) {
  runtimeState.evolutionCount = 0;
}

const simRng = createSeededRandom(runtimeState.rngState);
const eventBuffer = createEventBuffer(Number(process.env.EVENT_BUFFER_LIMIT || 500));

function syncRngState() {
  runtimeState.rngState = simRng.getState();
}

function normalizeRestoredTraders(traders, timeframes) {
  if (!Array.isArray(traders) || !traders.length) return traders;
  if (!Array.isArray(timeframes) || !timeframes.length) return traders;

  let fallbackIdx = 0;
  return traders.map((t) => {
    const existingTf =
      typeof t.timeframe === "string" && timeframes.includes(t.timeframe)
        ? t.timeframe
        : null;

    return {
      ...t,
      timeframe: existingTf || timeframes[fallbackIdx++ % timeframes.length],
    };
  });
}

let traders =
  restored
    ? normalizeRestoredTraders(restored, config.market.timeframes)
    : createPool(config.population.size, simRng);

let isReplaying = false;
let lastReplaySummary = runtimeState.lastReplaySummary || null;
let apiServerHandle = null;

if (!Number.isFinite(runtimeState.lastEvolutionAt)) {
  runtimeState.lastEvolutionAt = Date.now();
}

function saveRuntimeOnly() {
  syncRngState();
  runtimeState.lastSavedAt = Date.now();
  saveRuntimeState(runtimeState);
}

function persistAllState() {
  savePopulation(traders);
  saveRuntimeOnly();
}

function recalcScores() {
  traders.forEach((t) => {
    t.score = (t.balance || 0) - config.population.startingBalance;
  });
}

function formatMoney(n) {
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function formatIso(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

function recordEvent(kind, payload = {}) {
  return eventBuffer.push({ kind, ...payload });
}

function serializeOpenPosition(pos) {
  if (!pos) return null;
  return {
    side: pos.side || null,
    entry: Number(pos.entry || 0),
    tp: Number(pos.tp || 0),
    sl: Number(pos.sl || 0),
    size: Number(pos.size || 0),
    g: Number(pos.g || 0),
  };
}

function serializeTrader(trader) {
  if (!trader) return null;
  const totalTrades = Number(trader.wins || 0) + Number(trader.losses || 0);
  const winRate = totalTrades ? (Number(trader.wins || 0) / totalTrades) * 100 : 0;
  return {
    id: String(trader.id),
    timeframe: trader.timeframe || "unknown",
    balance: Number(trader.balance || 0),
    pnl: Number(trader.pnl || 0),
    wins: Number(trader.wins || 0),
    losses: Number(trader.losses || 0),
    totalTrades,
    winRate,
    score: Number(trader.score || 0),
    invert: !!trader.invert,
    gThreshold: Number(trader.gThreshold || 0),
    openPosition: serializeOpenPosition(trader.openPosition),
  };
}

function getHealth() {
  const lastProcessedByTimeframe = {};
  for (const tf of config.market.timeframes) {
    const ts = Number(runtimeState.lastProcessedByTimeframe[tf] || 0);
    lastProcessedByTimeframe[tf] = {
      timestamp: ts || null,
      iso: formatIso(ts),
      ageSec: ts ? Math.max(0, Math.round((Date.now() - ts) / 1000)) : null,
    };
  }

  return {
    now: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    replaying: isReplaying,
    liveCapable: !!liveExec.capable,
    liveEnabled: !!liveExec.state?.enabled,
    queueDepth: telegramQueue.length,
    eventBufferSize: eventBuffer.size(),
    lastProcessedByTimeframe,
  };
}

async function getLiveExchangeData(force = false) {
  if (!liveExec.capable || typeof liveExec.getLiveSnapshot !== "function") {
    return null;
  }

  try {
    return await liveExec.getLiveSnapshot(force);
  } catch (err) {
    recordEvent("runtime_error", {
      message: "Failed to fetch live exchange snapshot",
      error: err.message || String(err),
    });
    return {
      error: err.message || String(err),
      fetchedAt: Date.now(),
    };
  }
}

function summarizeLiveSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    fetchedAt: formatIso(snapshot.fetchedAt),
    serverTime: formatIso(snapshot.serverTime),
    walletAddress: snapshot.user || null,
    accountValue: Number(snapshot.account?.accountValue || 0),
    withdrawable: Number(snapshot.account?.withdrawable || 0),
    totalMarginUsed: Number(snapshot.account?.totalMarginUsed || 0),
    totalNotionalPosition: Number(snapshot.account?.totalNotionalPosition || 0),
    openOrders: Array.isArray(snapshot.openOrders) ? snapshot.openOrders.length : 0,
    currentPosition: snapshot.currentPosition || null,
    recentFills: Array.isArray(snapshot.recentFills) ? snapshot.recentFills : [],
    error: snapshot.error || null,
  };
}

function getTimeframeStatsMap() {
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
  return tfStats;
}

function buildTimeframeSummaryLines() {
  const tfStats = getTimeframeStatsMap();
  return config.market.timeframes.map((tf) => {
    const s = tfStats[tf] || { count: 0, open: 0, equity: 0, wins: 0, losses: 0 };
    const trades = s.wins + s.losses;
    const wr = trades ? ((s.wins / trades) * 100).toFixed(1) : "—";
    const avgEq = s.count ? (s.equity / s.count).toFixed(2) : "—";
    return `• *${tf}*: traders=${s.count} open=${s.open} avgBal=$${avgEq} WR=${wr}%`;
  });
}

function getPopulationStats() {
  const totalEquity = traders.reduce((sum, t) => sum + (t.balance || 0), 0);
  const activePositions = traders.filter((t) => t.openPosition).length;
  const totalWins = traders.reduce((sum, t) => sum + (t.wins || 0), 0);
  const totalLosses = traders.reduce((sum, t) => sum + (t.losses || 0), 0);
  const totalTrades = totalWins + totalLosses;
  const winRate = totalTrades ? (totalWins / totalTrades) * 100 : 0;
  return {
    totalEquity,
    activePositions,
    totalWins,
    totalLosses,
    totalTrades,
    winRate,
  };
}

function getSortedTraders() {
  recalcScores();
  return [...traders].sort((a, b) => (b.score || 0) - (a.score || 0));
}

function getLeaderForTimeframe(timeframe) {
  const tfTraders = traders.filter((t) => (t.timeframe || "unknown") === timeframe);
  if (!tfTraders.length) return null;
  let leader = tfTraders[0];
  for (let i = 1; i < tfTraders.length; i++) {
    if ((tfTraders[i].score || 0) > (leader.score || 0)) leader = tfTraders[i];
  }
  return leader;
}

function getCurrentLeaderData(timeframe = LIVE_TF) {
  const leader = getLeaderForTimeframe(timeframe);
  if (!leader) {
    return {
      timeframe,
      trader: null,
      lastProcessedAt: formatIso(runtimeState.lastProcessedByTimeframe[timeframe]),
    };
  }
  return {
    timeframe,
    trader: serializeTrader(leader),
    lastProcessedAt: formatIso(runtimeState.lastProcessedByTimeframe[timeframe]),
    liveCandidate: timeframe === LIVE_TF,
  };
}

function getAllLeadersData() {
  return config.market.timeframes.map((tf) => getCurrentLeaderData(tf));
}

function getOpenPositionsData(limit = 20) {
  return getSortedTraders()
    .filter((t) => t.openPosition)
    .slice(0, Math.max(1, Number(limit) || 20))
    .map((t) => ({
      id: String(t.id),
      timeframe: t.timeframe || "unknown",
      balance: Number(t.balance || 0),
      score: Number(t.score || 0),
      openPosition: serializeOpenPosition(t.openPosition),
    }));
}

function getReplayStatusData() {
  const summary = lastReplaySummary || runtimeState.lastReplaySummary || null;
  return {
    replaying: isReplaying,
    lastReplayAt: formatIso(runtimeState.lastReplayAt),
    summary: summary
      ? {
          finishedAt: formatIso(summary.finishedAt),
          totalCandles: Number(summary.totalCandles || 0),
          evolutions: Number(summary.evolutions || 0),
          byTimeframe: summary.byTimeframe || {},
        }
      : null,
  };
}

function getSummaryData() {
  const tfStats = getTimeframeStatsMap();
  return {
    symbol: config.market.symbol,
    timeframes: config.market.timeframes.map((tf) => {
      const s = tfStats[tf] || { count: 0, open: 0, equity: 0, wins: 0, losses: 0 };
      const trades = s.wins + s.losses;
      const averageBalance = s.count ? s.equity / s.count : 0;
      const winRate = trades ? (s.wins / trades) * 100 : 0;
      return {
        timeframe: tf,
        traders: s.count,
        openPositions: s.open,
        averageBalance,
        wins: s.wins,
        losses: s.losses,
        winRate,
        lastProcessedAt: formatIso(runtimeState.lastProcessedByTimeframe[tf]),
      };
    }),
  };
}

async function getStatusData() {
  const stats = getPopulationStats();
  const liveState = liveExec.state || {};
  const liveSnapshot = summarizeLiveSnapshot(await getLiveExchangeData(false));
  return {
    symbol: config.market.symbol,
    population: traders.length,
    openPositions: stats.activePositions,
    totalEquity: stats.totalEquity,
    totalTrades: stats.totalTrades,
    winRate: stats.winRate,
    queueDepth: telegramQueue.length,
    simSeed: runtimeState.rngSeed,
    evolutionCount: Number(runtimeState.evolutionCount || 0),
    replaying: isReplaying,
    nextEvolutionIn: formatNextEvolution(),
    live: {
      capable: !!liveExec.capable,
      enabled: !!liveState.enabled,
      side: liveState.side || "FLAT",
      coin: liveState.coin || null,
      sizeCoin: Number(liveState.sizeCoin || 0),
      testnet: !!liveState.isTestnet,
      timeframe: LIVE_TF,
      exchange: liveSnapshot,
    },
    health: getHealth(),
    leader: getCurrentLeaderData(LIVE_TF),
  };
}

async function getCurrentSignalsData() {
  return {
    symbol: config.market.symbol,
    liveTimeframe: LIVE_TF,
    liveCandidate: getCurrentLeaderData(LIVE_TF),
    leadersByTimeframe: getAllLeadersData(),
    liveExchange: summarizeLiveSnapshot(await getLiveExchangeData(false)),
    recentSignals: eventBuffer.list({
      limit: 12,
      kinds: ["trade_open", "trade_close", "live_sync", "live_toggle"],
    }),
  };
}

function getRecentTradeEvents(limit = 20) {
  return eventBuffer.list({
    limit,
    kinds: [
      "trade_open",
      "trade_close",
      "live_toggle",
      "live_test_long",
      "live_flat",
      "replay_summary",
      "runtime_error",
      "evolution",
    ],
  });
}

function formatNextEvolution() {
  const nextAt = (runtimeState.lastEvolutionAt || Date.now()) + config.evolution.interval;
  const ms = Math.max(0, nextAt - Date.now());
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return hrs > 0 ? `${hrs}h ${remMins}m` : `${remMins}m`;
}

async function buildStatusText() {
  const stats = getPopulationStats();
  const liveState = liveExec.state || {};
  const liveSnapshot = summarizeLiveSnapshot(await getLiveExchangeData(false));
  return [
    `🤖 *Bot Status*`,
    ``,
    `Symbol: *${config.market.symbol}*`,
    `Population: *${traders.length}*`,
    `Open positions: *${stats.activePositions}*`,
    `Total equity: *$${stats.totalEquity.toFixed(2)}*`,
    `Total trades: *${stats.totalTrades}*`,
    `Win rate: *${stats.winRate.toFixed(1)}%*`,
    `Trade queue: *${telegramQueue.length}*`,
    `Replaying: *${isReplaying ? "YES" : "NO"}*`,
    `Sim seed: *${runtimeState.rngSeed}*`,
    `Evolution cycles: *${runtimeState.evolutionCount || 0}*`,
    `Next evolution: *~${formatNextEvolution()}*`,
    `Live capable: *${liveExec.capable ? "YES" : "NO"}*`,
    `Live armed: *${liveState.enabled ? "ON" : "OFF"}*`,
    `Live side: *${liveState.side || "FLAT"}*`,
    `Live TF: *${LIVE_TF}*`,
    `Live account: *${liveSnapshot ? `$${liveSnapshot.accountValue.toFixed(2)}` : "—"}*`,
    `Live withdrawable: *${liveSnapshot ? `$${liveSnapshot.withdrawable.toFixed(2)}` : "—"}*`,
    `Live orders: *${liveSnapshot ? liveSnapshot.openOrders : 0}*`,
  ].join("\n");
}

function buildTopText(limit = 7) {
  const top = getSortedTraders().slice(0, limit);
  const lines = top.map((t, idx) => {
    const totalTrades = (t.wins || 0) + (t.losses || 0);
    const wr = totalTrades ? ((t.wins / totalTrades) * 100).toFixed(1) : "—";
    const open = t.openPosition ? `${t.openPosition.side}` : "IDLE";
    return `${idx + 1}. \`${String(t.id).slice(0, 8)}\` ${t.timeframe} bal=$${t.balance.toFixed(
      2
    )} WR=${wr}% ${open}`;
  });

  return [
    `🏆 *Top Traders*`,
    ``,
    ...(lines.length ? lines : ["No traders available."]),
  ].join("\n");
}

function getTopTradersData(limit = 10) {
  return getSortedTraders()
    .slice(0, Math.max(1, Number(limit) || 10))
    .map((t) => serializeTrader(t));
}

function buildReplayText() {
  const replay = getReplayStatusData();
  const summary = replay.summary;
  if (!summary) {
    return [
      `⏪ *Replay Status*`,
      ``,
      `No replay has been recorded yet.`,
      `Precise downtime catch-up begins after \`bot_runtime_state.json\` exists.`,
    ].join("\n");
  }

  const byTf = Object.entries(summary.byTimeframe || {})
    .map(([tf, count]) => `• *${tf}*: ${count} candles`)
    .join("\n");

  return [
    `⏪ *Replay Status*`,
    ``,
    `Finished: *${summary.finishedAt}*`,
    `Candles replayed: *${summary.totalCandles || 0}*`,
    `Evolutions applied: *${summary.evolutions || 0}*`,
    byTf || `• No replayed candles`,
  ].join("\n");
}

function buildLeaderText(timeframe = LIVE_TF) {
  const leader = getCurrentLeaderData(timeframe);
  if (!leader?.trader) {
    return [
      `🥇 *Leader*`,
      ``,
      `No leader is available for *${timeframe}*.`,
    ].join("\n");
  }

  const t = leader.trader;
  return [
    `🥇 *Leader (${timeframe})*`,
    ``,
    `Trader: \`${String(t.id).slice(0, 12)}\``,
    `Balance: *$${t.balance.toFixed(2)}*`,
    `Score: *${t.score.toFixed(2)}*`,
    `Win Rate: *${t.winRate.toFixed(1)}%*`,
    `Trades: *${t.totalTrades}*`,
    `Mode: *${t.invert ? "Contrarian" : "Trend"}*`,
    `Open: *${t.openPosition ? t.openPosition.side : "IDLE"}*`,
    `Last Candle: *${leader.lastProcessedAt || "—"}*`,
  ].join("\n");
}

function buildPositionsText(limit = 12) {
  const positions = getOpenPositionsData(limit);
  if (!positions.length) {
    return [
      `📂 *Open Positions*`,
      ``,
      `There are no simulated open positions right now.`,
    ].join("\n");
  }

  return [
    `📂 *Open Positions*`,
    ``,
    ...positions.map((p) => {
      const pos = p.openPosition || {};
      return `• *${p.timeframe}* \`${String(p.id).slice(0, 8)}\` ${pos.side || "—"} entry=$${Number(
        pos.entry || 0
      ).toFixed(2)} tp=$${Number(pos.tp || 0).toFixed(2)} sl=$${Number(pos.sl || 0).toFixed(2)}`;
    }),
  ].join("\n");
}

function buildRecentText(limit = 10) {
  const events = getRecentTradeEvents(limit);
  if (!events.length) {
    return [
      `🕒 *Recent Activity*`,
      ``,
      `No recent events recorded yet.`,
    ].join("\n");
  }

  return [
    `🕒 *Recent Activity*`,
    ``,
    ...events.map((event) => {
      const when = formatIso(event.ts) || "—";
      if (event.kind === "trade_open") {
        return `• ${when} ${event.timeframe} OPEN ${event.side} \`${String(event.traderId).slice(0, 8)}\` @$${Number(
          event.entry || 0
        ).toFixed(2)}`;
      }
      if (event.kind === "trade_close") {
        return `• ${when} ${event.timeframe} CLOSE ${event.side} ${event.hit || ""} \`${String(
          event.traderId
        ).slice(0, 8)}\` PnL ${formatMoney(Number(event.pnl || 0))}`;
      }
      return `• ${when} ${event.kind} ${event.message || ""}`.trim();
    }),
  ].join("\n");
}

async function buildLiveText() {
  const snapshot = summarizeLiveSnapshot(await getLiveExchangeData(true));
  if (!snapshot) {
    return [
      `💹 *Live Exchange*`,
      ``,
      `Live exchange data is unavailable because live trading is not configured.`,
    ].join("\n");
  }

  if (snapshot.error) {
    return [
      `💹 *Live Exchange*`,
      ``,
      `Failed to fetch live exchange state.`,
      `Error: \`${snapshot.error}\``,
    ].join("\n");
  }

  const pos = snapshot.currentPosition;
  return [
    `💹 *Live Exchange*`,
    ``,
    `Wallet: \`${String(snapshot.walletAddress || "—").slice(0, 14)}...\``,
    `Fetched: *${snapshot.fetchedAt || "—"}*`,
    `Server Time: *${snapshot.serverTime || "—"}*`,
    `Account Value: *$${snapshot.accountValue.toFixed(2)}*`,
    `Withdrawable: *$${snapshot.withdrawable.toFixed(2)}*`,
    `Margin Used: *$${snapshot.totalMarginUsed.toFixed(2)}*`,
    `Open Orders: *${snapshot.openOrders}*`,
    `Position: *${pos ? pos.side : "FLAT"}*`,
    ...(pos
      ? [
          `Size: *${Math.abs(Number(pos.size || 0)).toFixed(6)} ${pos.coin}*`,
          `Entry: *$${Number(pos.entryPx || 0).toFixed(2)}*`,
          `Value: *$${Number(pos.positionValue || 0).toFixed(2)}*`,
          `Unrealized PnL: *${formatMoney(Number(pos.unrealizedPnl || 0))}*`,
          `Liq: *${pos.liquidationPx ? `$${Number(pos.liquidationPx).toFixed(2)}` : "—"}*`,
        ]
      : []),
  ].join("\n");
}

async function buildLiveFillsText(limit = 8) {
  const snapshot = summarizeLiveSnapshot(await getLiveExchangeData(true));
  const fills = snapshot?.recentFills || [];
  if (!snapshot || snapshot.error) {
    return [
      `🧾 *Live Fills*`,
      ``,
      `Live fill data is unavailable right now.`,
    ].join("\n");
  }
  if (!fills.length) {
    return [
      `🧾 *Live Fills*`,
      ``,
      `No recent fills found for *${LIVE_TF} / ${liveExec.state?.coin || "coin"}*.`,
    ].join("\n");
  }

  return [
    `🧾 *Live Fills*`,
    ``,
    ...fills.slice(0, limit).map((fill) =>
      `• ${formatIso(fill.time) || "—"} *${fill.side}* ${fill.coin} ${Number(fill.size).toFixed(
        6
      )} @ *$${Number(fill.price).toFixed(2)}* PnL ${formatMoney(Number(fill.closedPnl || 0))}`
    ),
  ].join("\n");
}

function buildHelpText() {
  return [
    `📘 *Telegram Commands*`,
    ``,
    `/live - live control panel`,
    `/status - overall bot status`,
    `/summary - timeframe summary`,
    `/leader - current leader on the live timeframe`,
    `/positions - simulated open positions`,
    `/recent - recent bot/live activity`,
    `/livestate - live exchange account and position snapshot`,
    `/livefills - recent live exchange fills`,
    `/top - top traders`,
    `/replay - last replay summary`,
    `/refresh - refresh the main control panel`,
    `/save - save traders + runtime state`,
    `/evolve - force one evolution cycle`,
    `/testlong - small live test order when live is OFF`,
    `/testflat - flatten tracked live position`,
  ].join("\n");
}

function markProcessedCandle(timeframe, candleTime) {
  const curr = Number(runtimeState.lastProcessedByTimeframe[timeframe] || 0);
  const next = Number(candleTime || 0);
  if (Number.isFinite(next) && next > curr) {
    runtimeState.lastProcessedByTimeframe[timeframe] = next;
  }
}

function runDueEvolutions(referenceTs = Date.now(), { announce = true, reason = "scheduled" } = {}) {
  const ref = Number(referenceTs || Date.now());
  if (!Number.isFinite(runtimeState.lastEvolutionAt)) {
    runtimeState.lastEvolutionAt = ref;
  }

  let count = 0;
  while (ref - runtimeState.lastEvolutionAt >= config.evolution.interval) {
    runtimeState.lastEvolutionAt += config.evolution.interval;
    runtimeState.evolutionCount += 1;
    traders = evolve(traders, {
      rng: simRng,
      generation: runtimeState.evolutionCount,
    });
    recalcScores();
    count++;
  }

  if (count > 0) {
    recordEvent("evolution", {
      message: `Applied ${count} evolution cycle(s)`,
      reason,
      cycles: count,
      totalEquity: getPopulationStats().totalEquity,
    });
    persistAllState();
    if (announce) {
      const stats = getPopulationStats();
      sendAlert(
`🧬 Evolution Complete

Cycles: ${count}
Reason: ${reason}
Pool Equity: $${stats.totalEquity.toFixed(2)}
Population: ${traders.length}`
      );
    }
  }

  return count;
}

function forceEvolution(reason = "manual") {
  runtimeState.evolutionCount += 1;
  traders = evolve(traders, {
    rng: simRng,
    generation: runtimeState.evolutionCount,
  });
  recalcScores();
  runtimeState.lastEvolutionAt = Date.now();
  recordEvent("evolution", {
    message: "Forced one evolution cycle",
    reason,
    cycles: 1,
    totalEquity: getPopulationStats().totalEquity,
  });
  persistAllState();

  const stats = getPopulationStats();
  sendAlert(
`🧬 Evolution Complete

Cycles: 1
Reason: ${reason}
Pool Equity: $${stats.totalEquity.toFixed(2)}
Population: ${traders.length}`
  );

  return {
    totalEquity: stats.totalEquity,
    population: traders.length,
  };
}

recalcScores();
saveRuntimeOnly();

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
  testOpenLong: async () => {
    throw new Error("Live trading not configured");
  },
  flattenLive: async () => {},
};

const LIVE_TF = process.env.LIVE_TIMEFRAME || "5m";
const API_ENABLED = String(process.env.API_ENABLED || "false").toLowerCase() === "true";
const API_HOST = process.env.API_HOST || "127.0.0.1";
const API_PORT = Number(process.env.API_PORT || 3000);
const API_BEARER_TOKEN = String(process.env.API_BEARER_TOKEN || "");

/* ==================================================
   TELEGRAM: TRADE + TIMEFRAME UPDATES (BATCHED)
================================================== */

const TELEGRAM_FLUSH_MS = 15000;
const TELEGRAM_MAX_LINES = 20;
const TELEGRAM_TF_SUMMARY_MS = 30 * 60 * 1000;
/** summary = one line per bar; all = every trader; leader = top-score trader only */
const TELEGRAM_TRADES_MODE = (
  process.env.TELEGRAM_TRADES_MODE || "summary"
).toLowerCase();

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
  sendAlert(
    [
      `🧭 *Timeframe Summary* (${config.market.symbol})`,
      "",
      ...buildTimeframeSummaryLines()
    ].join("\n")
  );
}

setInterval(sendTimeframeSummary, TELEGRAM_TF_SUMMARY_MS);


/* ==================================================
   START ALERT
================================================== */

sendAlert(
  [
    `🚀 Bot Started`,
    ``,
    `Symbol: ${config.market.symbol}`,
    `Population: ${traders.length} (${restored ? "restored from traders_state.json" : "fresh"})`,
    `Timeframes: ${config.market.timeframes.join(", ")}`,
    ``,
    `_Loading candle history and replay state from Binance…_`,
  ].join("\n")
);
recordEvent("startup", {
  message: "Bot process started",
  restored: !!restored,
  population: traders.length,
});


/* ==================================================
   DASHBOARD LOOP
================================================== */

setInterval(() => {
  recalcScores();
  renderDashboard(traders);
}, config.dashboard.refreshInterval || 5000);


/* ==================================================
   AUTO SAVE
================================================== */

setInterval(() => {
  persistAllState();
}, 600000); // 10 min


/* ==================================================
   EVOLUTION ENGINE
================================================== */

setInterval(() => {
  if (isReplaying) return;
  runDueEvolutions(Date.now(), { announce: true, reason: "timer" });
}, 10000);


/* ==================================================
   DATA STREAMS (warm history on startup, then WS)
================================================== */

async function warmCandleHistoryFromBinance() {
  const min = config.market.minCandles;
  const limit = Math.min(500, Math.max(min + 40, 130));
  const sym = config.market.symbol;
  const warmed = {};

  for (const tf of config.market.timeframes) {
    try {
      const tfMs = intervalToMs(tf);
      const anchorTime = Number(runtimeState.lastProcessedByTimeframe[tf]);
      const endTime = Number.isFinite(anchorTime) ? anchorTime + tfMs - 1 : undefined;
      const candles = await fetchClosedKlines(sym, tf, limit, endTime);
      candleEngine.seed(tf, candles);
      warmed[tf] = candles.length;
      if (!Number.isFinite(anchorTime) && candles.length) {
        runtimeState.lastProcessedByTimeframe[tf] = candles[candles.length - 1].time;
      }
      console.log(`📚 Warmed ${tf}: ${candles.length} candles (Binance REST)`);
    } catch (e) {
      console.error(`📚 Warm ${tf} failed:`, e.message || e);
      warmed[tf] = 0;
    }
  }

  saveRuntimeOnly();
  return warmed;
}

async function processClosedCandle(
  timeframe,
  candle,
  {
    source = "live",
    queueTelegram = true,
    allowLiveExecution = true,
    announceEvolution = true,
  } = {}
) {
  const history = candleEngine.update(timeframe, candle);
  markProcessedCandle(timeframe, candle.time);

  if (!history || history.length < config.market.minCandles) {
    saveRuntimeOnly();
    return { replayed: false, evolutions: 0 };
  }

  recalcScores();
  const indicators = computeIndicators(history);

  const tfTraders = traders.filter((t) => t.timeframe === timeframe);
  if (!tfTraders.length) {
    saveRuntimeOnly();
    return { replayed: false, evolutions: 0 };
  }

  const leader = getLeaderForTimeframe(timeframe);
  const opensAgg = [];
  const closesAgg = [];
  const mode =
    TELEGRAM_TRADES_MODE === "all" || TELEGRAM_TRADES_MODE === "leader"
      ? TELEGRAM_TRADES_MODE
      : "summary";

  for (const trader of tfTraders) {
    const { signal, g } = evaluate(history, indicators, trader);

    if (signal) {
      trader.totalG = (trader.totalG || 0) + g;
    }

    const events = processTrader(
      trader,
      signal,
      g,
      candle.close,
      indicators.atr
    );

    if (events?.opened) {
      recordEvent("trade_open", {
        timeframe,
        traderId: String(trader.id),
        side: events.opened.side,
        entry: events.opened.entry,
        g: events.opened.g,
        source,
      });
      if (queueTelegram) {
        if (mode === "all") {
          qTelegram(formatTradeLine("OPEN", trader, timeframe, events.opened));
        } else if (mode === "leader" && trader.id === leader?.id) {
          qTelegram(formatTradeLine("OPEN", trader, timeframe, events.opened));
        } else if (mode === "summary") {
          opensAgg.push({
            side: events.opened.side,
            entry: events.opened.entry,
          });
        }
      }

      if (
        allowLiveExecution &&
        timeframe === LIVE_TF &&
        liveExec.state?.enabled &&
        trader.id === leader?.id
      ) {
        liveExec
          .onOpened({ side: events.opened.side, g: events.opened.g })
          .catch((e) => {
            console.error("Live open failed:", e && e.stack ? e.stack : e);
            recordEvent("runtime_error", {
              message: "Live open failed",
              timeframe,
              error: e.message || String(e),
            });
            sendAlert(`❌ Live OPEN failed\n\n${e.message || e}`);
          });
      }
    }

    if (events?.closed) {
      recordEvent("trade_close", {
        timeframe,
        traderId: String(trader.id),
        side: events.closed.side,
        hit: events.closed.hit,
        exit: events.closed.exit,
        pnl: events.closed.pnl,
        source,
      });
      if (queueTelegram) {
        if (mode === "all") {
          qTelegram(formatTradeLine("CLOSE", trader, timeframe, events.closed));
        } else if (mode === "leader" && trader.id === leader?.id) {
          qTelegram(formatTradeLine("CLOSE", trader, timeframe, events.closed));
        } else if (mode === "summary") {
          closesAgg.push({
            side: events.closed.side,
            hit: events.closed.hit,
            exit: events.closed.exit,
            pnl: events.closed.pnl,
          });
        }
      }

      if (
        allowLiveExecution &&
        timeframe === LIVE_TF &&
        liveExec.state?.enabled &&
        trader.id === leader?.id
      ) {
        liveExec.onClosed().catch((e) => {
          console.error("Live close failed:", e && e.stack ? e.stack : e);
          recordEvent("runtime_error", {
            message: "Live close failed",
            timeframe,
            error: e.message || String(e),
          });
          sendAlert(`❌ Live CLOSE failed\n\n${e.message || e}`);
        });
      }
    }
  }

  if (queueTelegram && mode === "summary") {
    if (opensAgg.length) {
      const longN = opensAgg.filter((x) => x.side === "LONG").length;
      const shortN = opensAgg.filter((x) => x.side === "SHORT").length;
      const px = opensAgg[0].entry;
      const lid = String(leader?.id || "n/a").slice(0, 8);
      qTelegram(
        `• *${timeframe}* *${opensAgg.length}× OPEN* (${longN}L/${shortN}S) @ *$${px.toFixed(
          2
        )}*  leader \`${lid}\``
      );
    }
    if (closesAgg.length) {
      let tp = 0;
      let sl = 0;
      let pnlSum = 0;
      for (const x of closesAgg) {
        if (x.hit === "TP") tp++;
        else sl++;
        pnlSum += x.pnl || 0;
      }
      const s0 = closesAgg[0];
      qTelegram(
        `• *${timeframe}* *${closesAgg.length}× CLOSE* TP=${tp} SL=${sl}  ΣPnL *${formatMoney(
          pnlSum
        )}*  eg *${s0.side}* ${s0.hit} @$${s0.exit.toFixed(2)}`
      );
    }
  }

  recalcScores();
  const candleEventTs =
    Number(candle.closeTime) || (Number(candle.time) + intervalToMs(timeframe));
  const evolutions = runDueEvolutions(candleEventTs, {
    announce: announceEvolution,
    reason: source,
  });

  if (!evolutions) {
    saveRuntimeOnly();
  }

  return { replayed: source === "replay", evolutions };
}

async function replayMissedCandlesFromBinance() {
  const sym = config.market.symbol;
  const allReplayCandles = [];
  const byTimeframe = {};
  recordEvent("replay_start", {
    message: "Starting downtime replay",
  });

  for (const tf of config.market.timeframes) {
    const tfMs = intervalToMs(tf);
    const lastProcessed = Number(runtimeState.lastProcessedByTimeframe[tf]);
    if (!Number.isFinite(lastProcessed)) continue;

    const startTime = lastProcessed + tfMs;
    if (startTime > Date.now()) {
      byTimeframe[tf] = 0;
      continue;
    }

    try {
      const candles = await fetchClosedKlinesBetween(sym, tf, startTime, Date.now());
      byTimeframe[tf] = candles.length;
      candles.forEach((candle) => {
        allReplayCandles.push({ ...candle, timeframe: tf, tfMs });
      });
    } catch (e) {
      byTimeframe[tf] = 0;
      console.error(`⏪ Replay fetch failed for ${tf}:`, e.message || e);
    }
  }

  allReplayCandles.sort((a, b) => {
    const aClose = Number(a.closeTime) || (Number(a.time) + a.tfMs);
    const bClose = Number(b.closeTime) || (Number(b.time) + b.tfMs);
    if (aClose !== bClose) return aClose - bClose;
    return a.tfMs - b.tfMs;
  });

  let evolutionCount = 0;
  if (allReplayCandles.length) {
    isReplaying = true;
    for (const candle of allReplayCandles) {
      const res = await processClosedCandle(candle.timeframe, candle, {
        source: "replay",
        queueTelegram: false,
        allowLiveExecution: false,
        announceEvolution: false,
      });
      evolutionCount += res.evolutions || 0;
    }
    isReplaying = false;
  }

  lastReplaySummary = {
    finishedAt: Date.now(),
    totalCandles: allReplayCandles.length,
    byTimeframe,
    evolutions: evolutionCount,
  };
  recordEvent("replay_summary", {
    message: "Replay completed",
    totalCandles: allReplayCandles.length,
    evolutions: evolutionCount,
    byTimeframe,
  });
  runtimeState.lastReplayAt = lastReplaySummary.finishedAt;
  runtimeState.lastReplaySummary = lastReplaySummary;
  persistAllState();

  return lastReplaySummary;
}

function attachMarketStreams() {
  config.market.timeframes.forEach((tf) => {
    connect(config.market.symbol, tf, (timeframe, candle) => {
      processClosedCandle(timeframe, candle, {
        source: "live",
        queueTelegram: true,
        allowLiveExecution: true,
        announceEvolution: true,
      }).catch((e) => {
        console.error(`Closed candle processing failed on ${timeframe}:`, e && e.stack ? e.stack : e);
        recordEvent("runtime_error", {
          message: `Closed candle processing failed on ${timeframe}`,
          timeframe,
          error: e.message || String(e),
        });
        sendAlert(`❌ Candle processing failed (${timeframe})\n\n${e.message || e}`);
      });
    });
  });
}

async function saveStateAction(source = "manual") {
  persistAllState();
  recordEvent("save_state", {
    message: "Saved traders and runtime state",
    source,
  });
  return {
    queueDepth: telegramQueue.length,
    population: traders.length,
  };
}

async function toggleLiveAction(nextEnabled, source = "operator") {
  if (!liveExec.capable) {
    throw new Error("Live trading not capable. Set LIVE_TRADING env + confirmation first.");
  }

  await liveExec.setEnabled(nextEnabled);

  if (nextEnabled) {
    const leader = getLeaderForTimeframe(LIVE_TF);
    if (leader) {
      await liveExec.syncFromSim(leader.openPosition);
      recordEvent("live_sync", {
        message: "Synced live position from simulated leader",
        source,
        timeframe: LIVE_TF,
        leaderId: String(leader.id),
        side: leader.openPosition?.side || null,
      });
    }
  }

  recordEvent("live_toggle", {
    message: nextEnabled ? "Live trading armed" : "Live trading disarmed",
    enabled: !!nextEnabled,
    source,
    timeframe: LIVE_TF,
    leaderId: getLeaderForTimeframe(LIVE_TF)?.id || null,
  });

  await sendAlert(nextEnabled
    ? `🟢 LIVE TRADING ARMED (TF=${LIVE_TF})`
    : `⚪ LIVE TRADING DISARMED (TF=${LIVE_TF})`);

  return {
    enabled: !!nextEnabled,
    timeframe: LIVE_TF,
  };
}

async function testLongAction(source = "operator") {
  if (!liveExec.capable) {
    throw new Error("Live not capable (env + HYPERLIQUID key).");
  }
  const result = await liveExec.testOpenLong();
  recordEvent("live_test_long", {
    message: "Sent live test long",
    source,
    coin: result.coin,
    sizeCoin: result.sizeCoin,
    limitPx: result.limitPx,
    usd: result.usd,
  });
  return result;
}

async function flattenLiveAction(source = "operator") {
  if (!liveExec.capable) return { flattened: false };
  await liveExec.flattenLive();
  recordEvent("live_flat", {
    message: "Requested live flatten",
    source,
  });
  return { flattened: true };
}

const runtime = {
  getHealth,
  getStatus: getStatusData,
  getSummary: getSummaryData,
  getTopTraders: getTopTradersData,
  getReplayStatus: getReplayStatusData,
  getCurrentLeader: () => getCurrentLeaderData(LIVE_TF),
  getOpenPositions: getOpenPositionsData,
  getCurrentSignals: getCurrentSignalsData,
  getLiveState: async (force = false) => summarizeLiveSnapshot(await getLiveExchangeData(force)),
  getLiveFills: async (limit = 10, force = false) => {
    const snapshot = summarizeLiveSnapshot(await getLiveExchangeData(force));
    return (snapshot?.recentFills || []).slice(0, Math.max(1, Number(limit) || 10));
  },
  getRecentTradeEvents,
  getRecentEvents: (limit = 20) => eventBuffer.list({ limit }),
  getStatusText: buildStatusText,
  getSummaryText: () =>
    [
      `🧭 *Timeframe Summary* (${config.market.symbol})`,
      "",
      ...buildTimeframeSummaryLines(),
    ].join("\n"),
  getTopText: (limit = 7) => buildTopText(limit),
  getReplayText: buildReplayText,
  getHelpText: buildHelpText,
  getLeaderText: () => buildLeaderText(LIVE_TF),
  getPositionsText: () => buildPositionsText(12),
  getRecentText: () => buildRecentText(10),
  getLiveText: () => buildLiveText(),
  getLiveFillsText: () => buildLiveFillsText(8),
  saveState: saveStateAction,
  forceEvolution: async (source = "manual") => forceEvolution(source),
  toggleLive: toggleLiveAction,
  testLong: testLongAction,
  flattenLive: flattenLiveAction,
};

(async () => {
  let runtimeNote = "";
  if (restored && !restoredRuntime) {
    runtimeNote =
      "Precise replay metadata was not available on this restart, so downtime replay starts from now onward.";
  }

  await warmCandleHistoryFromBinance();
  const replay = await replayMissedCandlesFromBinance();
  attachMarketStreams();
  recordEvent("startup", {
    message: "Candle history warmed and market streams attached",
    replayCandles: replay.totalCandles || 0,
    replayEvolutions: replay.evolutions || 0,
  });
  sendAlert(
    [
      `📚 *Candle history warmed*`,
      "",
      `Each TF has *${config.market.minCandles}+* bars from Binance so signals run immediately after restart.`,
      `Downtime replay candles: *${replay.totalCandles || 0}*`,
      `Replay evolutions: *${replay.evolutions || 0}*`,
      "",
      `Trade Telegram mode: *${TELEGRAM_TRADES_MODE}*`,
      `_Set \`TELEGRAM_TRADES_MODE=all\` for per-trader spam._`,
      ...(runtimeNote ? ["", runtimeNote] : []),
    ].join("\n")
  );
})();


/* ==================================================
   SHUTDOWN HANDLERS
================================================== */

process.on("SIGINT", async () => {
  persistAllState();
  if (apiServerHandle) {
    try {
      await apiServerHandle.stop();
    } catch (e) {
      console.error("API stop failed on SIGINT:", e.message || e);
    }
  }

  await sendAlert(
    "⚠️ Manual Shutdown - state saved."
  );

  process.exit();
});

process.on("SIGTERM", async () => {
  persistAllState();
  if (apiServerHandle) {
    try {
      await apiServerHandle.stop();
    } catch (e) {
      console.error("API stop failed on SIGTERM:", e.message || e);
    }
  }

  await sendAlert(
    "⚠️ Process terminated - state saved."
  );

  process.exit();
});

process.on("uncaughtException", async err => {
  persistAllState();
  if (apiServerHandle) {
    try {
      await apiServerHandle.stop();
    } catch (e) {
      console.error("API stop failed after crash:", e.message || e);
    }
  }

  console.error("❌ BOT CRASH:", err && err.stack ? err.stack : err);

  await sendAlert(
`❌ BOT CRASH

${err.message}

State saved.`
  );

  process.exit(1);
});

(async () => {
  try {
    liveExec = await createLiveExecutor();
    recordEvent("live_capability", {
      message: liveExec.capable ? "Live execution is capable" : "Simulation only mode",
      capable: !!liveExec.capable,
      timeframe: LIVE_TF,
    });
    if (liveExec.capable) {
      sendAlert(
        `🧩 Live capable (Hyperliquid)\n\nArm: Telegram panel\nQuick test: /testlong (LIVE OFF) · /testflat\nCoin: ${liveExec.state.coin}\nTestnet: ${liveExec.state.isTestnet}\nLive TF: ${LIVE_TF}\nMax Notional: $${Number(process.env.LIVE_MAX_NOTIONAL_USD || 50)}`
      );
    } else {
      sendAlert("🧪 Live trading not enabled (simulation only).");
    }

    if (API_ENABLED) {
      apiServerHandle = startApiServer({
        runtime,
        host: API_HOST,
        port: API_PORT,
        bearerToken: API_BEARER_TOKEN,
      });
      recordEvent("api_server", {
        message: `Signals API listening on http://${API_HOST}:${API_PORT}`,
        host: API_HOST,
        port: API_PORT,
        secured: !!API_BEARER_TOKEN,
      });
    }

    createTelegramControl({
      getState: async () => {
        const status = await runtime.getStatus();
        const leader = runtime.getCurrentLeader();
        const liveExchange = status.live?.exchange || null;
        const lastProcessed = config.market.timeframes
          .map((tf) => `${tf}:${formatIso(runtimeState.lastProcessedByTimeframe[tf]) || "—"}`)
          .join(" | ");
        return {
          capable: status.live.capable,
          enabled: status.live.enabled,
          coin: liveExec.state?.coin,
          isTestnet: !!liveExec.state?.isTestnet,
          havePosition: !!liveExec.state?.havePosition,
          side: liveExec.state?.side || null,
          sizeCoin: Number(liveExec.state?.sizeCoin || 0),
          symbol: config.market.symbol,
          population: status.population,
          activePositions: status.openPositions,
          totalEquity: status.totalEquity,
          replaying: isReplaying,
          telegramQueue: telegramQueue.length,
          simSeed: runtimeState.rngSeed,
          evolutionCount: runtimeState.evolutionCount || 0,
          liveTimeframe: LIVE_TF,
          leaderId: leader?.trader?.id || null,
          leaderScore: leader?.trader?.score || 0,
          lastProcessedPreview: lastProcessed,
          liveAccountValue: liveExchange?.accountValue || 0,
          liveWithdrawable: liveExchange?.withdrawable || 0,
          liveOpenOrders: liveExchange?.openOrders || 0,
          liveEntryPx: liveExchange?.currentPosition?.entryPx || 0,
          liveUnrealizedPnl: liveExchange?.currentPosition?.unrealizedPnl || 0,
        };
      },
      getStatusText: runtime.getStatusText,
      getSummaryText: runtime.getSummaryText,
      getTopText: () => runtime.getTopText(),
      getReplayText: runtime.getReplayText,
      getHelpText: runtime.getHelpText,
      getLeaderText: runtime.getLeaderText,
      getPositionsText: runtime.getPositionsText,
      getRecentText: runtime.getRecentText,
      getLiveText: runtime.getLiveText,
      getLiveFillsText: runtime.getLiveFillsText,
      onSave: async () => {
        const saved = await runtime.saveState("telegram");
        return `💾 Saved traders and runtime state.\n\nQueue: ${saved.queueDepth}\nPopulation: ${saved.population}`;
      },
      onEvolve: async () => {
        const result = await runtime.forceEvolution("telegram");
        return `🧬 Forced one evolution cycle.\n\nPool Equity: $${result.totalEquity.toFixed(
          2
        )}\nPopulation: ${result.population}`;
      },
      onTestLong: () => runtime.testLong("telegram"),
      onTestFlat: () => runtime.flattenLive("telegram"),
      onToggle: (nextEnabled) => runtime.toggleLive(nextEnabled, "telegram"),
    });
  } catch (err) {
    console.error("Live executor init failed:", err && err.stack ? err.stack : err);
    recordEvent("runtime_error", {
      message: "Live executor init failed",
      error: err.message || String(err),
    });
    sendAlert(`❌ Live executor init failed\n\n${err.message || err}`);
  }
})();
