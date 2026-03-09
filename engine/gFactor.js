const { detectLiquidity } = require("./liquidityEngine");

/**
 * G-Factor v3: High-Conviction Engine with Liquidity Awareness
 * Now weights liquidity traps (wicks) heavily to boost position sizing.
 */
function computeG(data) {
  let g = 0;

  // 1. Trend Strength (EMA Separation)
  const sep = Math.abs(data.ema20 - data.ema50) / data.price;
  g += sep * 10;

  // 2. Momentum Velocity
  g += Math.abs(data.velocity || 0) * 2;

  // 3. RSI Alignment (The "Sweet Spot")
  if (data.rsi > 45 && data.rsi < 70) {
    g += 0.3;
  }

  // 4. Volume Confirmation
  if (data.volume > (data.volumeMA || 0)) {
    g += 0.3;
  }

  // 5. Liquidity Analysis
  // If a candle shows a trap (long wick), boost conviction by 0.5
  if (data.candle) {
    const liq = detectLiquidity(data.candle);
    
    if (liq.bullTrap) g += 0.5;
    if (liq.bearTrap) g += 0.5;
  }

  return parseFloat(g.toFixed(4));
}

module.exports = { computeG };
