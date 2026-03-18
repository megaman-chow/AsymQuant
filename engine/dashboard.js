/**
 * Dashboard Engine
 * Visualizes trader population performance,
 * regime bias, and evolutionary health.
 */

const fs = require("fs");
const path = require("path");

function ensureLogDir() {
  const dir = path.join(__dirname, "logs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  return dir;
}

function saveSnapshot(data) {
  try {
    const dir = ensureLogDir();

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-");

    const file = path.join(dir, `dashboard_${timestamp}.json`);

    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Snapshot save error:", err.message);
  }
}

function renderDashboard(traders) {

  // Smooth terminal refresh (only when running in a real TTY)
  if (process.stdout && process.stdout.isTTY) {
    if (typeof process.stdout.cursorTo === "function") {
      process.stdout.cursorTo(0, 0);
    }
    if (typeof process.stdout.clearScreenDown === "function") {
      process.stdout.clearScreenDown();
    }
  }

  const divider = "=".repeat(70);

  console.log(divider);
  console.log("🧬 GENETIC MULTI-TIMEFRAME AUTONOMOUS BOT STATUS");
  console.log(divider);

  if (!traders || traders.length === 0) {
    console.log("No traders available.");
    return;
  }

  /* ---------------------------
     SORT + TOP TRADERS
  ----------------------------*/

  const sorted = [...traders].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 10);

  const topTable = top.map(t => {

    const totalTrades = t.wins + t.losses;

    const winRate =
      totalTrades > 0
        ? (t.wins / totalTrades) * 100
        : 0;

    return {
      id: t.id,
      timeframe: t.timeframe,
      balance: t.balance,
      wins: t.wins,
      losses: t.losses,
      winRate,
      score: t.score,
      open: t.openPosition ? t.openPosition.side : null,
      invert: t.invert,
      gThreshold: t.gThreshold
    };
  });

  console.log("\n🏆 TOP 10 ALPHA TRADERS\n");

  console.table(
    topTable.map(t => ({
      ID: t.id.toString().slice(0, 6),
      TF: t.timeframe,
      Balance: `$${t.balance.toFixed(2)}`,
      "W/L": `${t.wins}/${t.losses}`,
      "Win%": `${t.winRate.toFixed(1)}%`,
      Score: Math.round(t.score),
      Status: t.open ? `🟢 ${t.open}` : "⚪ IDLE",
      Traits: `G:${t.gThreshold} | ${t.invert ? "REV" : "TRD"}`
    }))
  );

  /* ---------------------------
     TIMEFRAME PERFORMANCE
  ----------------------------*/

  const tfStats = {};

  traders.forEach(t => {

    if (!tfStats[t.timeframe]) {
      tfStats[t.timeframe] = {
        count: 0,
        balance: 0,
        open: 0
      };
    }

    tfStats[t.timeframe].count++;
    tfStats[t.timeframe].balance += t.balance;

    if (t.openPosition) {
      tfStats[t.timeframe].open++;
    }
  });

  const tfTable = Object.entries(tfStats).map(([tf, data]) => {

    const avgBalance = data.balance / data.count;

    return {
      timeframe: tf,
      traders: data.count,
      avgBalance,
      exposure: data.open
    };
  });

  console.log("\n📊 TIMEFRAME PERFORMANCE\n");

  console.table(
    tfTable.map(t => ({
      Timeframe: t.timeframe,
      Traders: t.traders,
      "Avg Balance": `$${t.avgBalance.toFixed(2)}`,
      Exposure: t.exposure,
      Health: t.avgBalance >= 10000 ? "📈 PROFIT" : "📉 DRAWDOWN"
    }))
  );

  /* ---------------------------
     POPULATION METRICS
  ----------------------------*/

  const totalEquity = traders.reduce(
    (sum, t) => sum + t.balance,
    0
  );

  const activePositions = traders.filter(
    t => t.openPosition
  ).length;

  const totalWins = traders.reduce(
    (sum, t) => sum + t.wins,
    0
  );

  const totalLosses = traders.reduce(
    (sum, t) => sum + t.losses,
    0
  );

  const totalTrades = totalWins + totalLosses;

  const winRate =
    totalTrades > 0
      ? (totalWins / totalTrades) * 100
      : 0;

  console.log("\n🌍 POPULATION METRICS\n");

  console.table([
    {
      "Total Traders": traders.length,
      "Total Equity": `$${totalEquity.toFixed(2)}`,
      "Active Positions": activePositions,
      "Total Trades": totalTrades,
      "Win Rate": `${winRate.toFixed(2)}%`
    }
  ]);

  /* ---------------------------
     STRATEGY DISTRIBUTION
  ----------------------------*/

  const trendBots = traders.filter(t => !t.invert).length;
  const reversalBots = traders.filter(t => t.invert).length;

  console.log("\n🧠 STRATEGY DISTRIBUTION\n");

  console.table([
    {
      "Trend Followers": trendBots,
      "Reversal Traders": reversalBots,
      "Trend %": `${((trendBots / traders.length) * 100).toFixed(1)}%`,
      "Reversal %": `${((reversalBots / traders.length) * 100).toFixed(1)}%`
    }
  ]);

  console.log(
    `\n🔥 ACTIVE POSITIONS: ${activePositions} | 💰 TOTAL EQUITY: $${totalEquity.toFixed(
      2
    )}`
  );

  console.log(divider);

  /* ---------------------------
     SAVE SNAPSHOT
  ----------------------------*/

  const snapshot = {
    timestamp: new Date().toISOString(),
    totalTraders: traders.length,
    totalEquity,
    activePositions,
    totalTrades,
    winRate,
    topTraders: topTable,
    timeframeStats: tfTable
  };

  saveSnapshot(snapshot);
}

module.exports = {
  renderDashboard
};
