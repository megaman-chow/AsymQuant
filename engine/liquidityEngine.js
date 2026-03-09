/**
 * Detects liquidity sweeps and potential traps.
 * bullTrap: Long lower wick (rejection of lower prices).
 * bearTrap: Long upper wick (rejection of higher prices).
 */
function detectLiquidity(candle) {
  const body = Math.abs(candle.close - candle.open) || 0.00000001; // Avoid div by zero

  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  return {
    // Rejection of lows = Potential Bullish Reversal
    bullTrap: lowerWick > body * 1.5,
    
    // Rejection of highs = Potential Bearish Reversal
    bearTrap: upperWick > body * 1.5
  };
}

module.exports = { detectLiquidity };
