/**
 * Dashboard Engine: Visualizes the population performance and regime bias.
 */
function renderDashboard(traders) {
  console.clear();
  console.log("===============================================================");
  console.log("   🧬 GENETIC MULTI-TIMEFRAME AUTONOMOUS BOT STATUS");
  console.log("===============================================================");

  const sorted = [...traders].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 10);

  console.log("\n🏆 TOP 10 ALPHA TRADERS\n");
  console.table(top.map(t => {
    const totalTrades = t.wins + t.losses;
    return {
      ID: t.id.toString().substring(0, 6),
      TF: t.timeframe,
      Balance: `$${t.balance.toFixed(2)}`,
      "W/L": `${t.wins}/${t.losses}`,
      "Win%": totalTrades > 0 ? `${((t.wins / totalTrades) * 100).toFixed(1)}%` : "0%",
      Score: t.score.toFixed(0),
      Status: t.openPosition ? `OPEN ${t.openPosition.side}` : "IDLE",
      Traits: `G:${t.gThreshold} | ${t.invert ? 'REV' : 'TRD'}`
    };
  }));

  // Aggregate stats by Timeframe
  const tfStats = {};
  traders.forEach(t => {
    if (!tfStats[t.timeframe]) {
      tfStats[t.timeframe] = { count: 0, totalBalance: 0, open: 0 };
    }
    tfStats[t.timeframe].count++;
    tfStats[t.timeframe].totalBalance += t.balance;
    if (t.openPosition) tfStats[t.timeframe].open++;
  });

  console.log("\n📊 TIMEFRAME REGIME PERFORMANCE\n");
  console.table(Object.keys(tfStats).map(tf => ({
    Timeframe: tf,
    Traders: tfStats[tf].count,
    "Avg Balance": `$${(tfStats[tf].totalBalance / tfStats[tf].count).toFixed(2)}`,
    "Total Exposure": tfStats[tf].open,
    Health: tfStats[tf].totalBalance / tfStats[tf].count > 10000 ? "📈 PROFIT" : "📉 DRAWDOWN"
  })));

  const activePositions = traders.filter(t => t.openPosition).length;
  console.log(`\n🔥 TOTAL ACTIVE POSITIONS: ${activePositions} | TOTAL POOL EQUITY: $${traders.reduce((s, t) => s + t.balance, 0).toFixed(2)}`);
}

module.exports = { renderDashboard };
