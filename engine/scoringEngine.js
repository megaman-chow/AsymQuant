/**
 * Calculates the performance score of a virtual trader.
 * Rewards Capital (50%), Consistency (Winrate), and Selection Quality (avgG).
 */
function scoreTrader(trader) {
  const totalTrades = trader.wins + trader.losses;

  // Avoid division by zero
  if (totalTrades === 0) return 0;

  const winrate = trader.wins / totalTrades;
  
  // Ensure totalG exists on the trader object to avoid NaN
  const avgG = (trader.totalG || 0) / totalTrades;

  // Scoring Formula:
  // (Balance * 0.5) + (Winrate * 1000) + (AvgG * 500)
  const score = (trader.balance * 0.5) + (winrate * 1000) + (avgG * 500);

  trader.score = parseFloat(score.toFixed(2));
  
  return trader.score;
}

module.exports = { scoreTrader };
