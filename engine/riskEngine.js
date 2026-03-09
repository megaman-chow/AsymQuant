/**
 * Dynamic Take Profit (TP) and Stop Loss (SL) Calculation
 * Uses ATR to adjust for current market volatility.
 */
function computeTargets(price, atr, side) {
  // TP is set to roughly 2.6x the current volatility, with a minimum floor
  const tpOffset = Math.max(price * 0.002, atr * 2.6);
  
  // SL is set to roughly 1.3x the current volatility (2:1 Reward/Risk ratio)
  const slOffset = Math.max(price * 0.001, atr * 1.3);

  let tp, sl;

  if (side === "LONG") {
    tp = price + tpOffset;
    sl = price - slOffset;
  } else if (side === "SHORT") {
    tp = price - tpOffset;
    sl = price + slOffset;
  }

  return {
    tp: parseFloat(tp.toFixed(2)),
    sl: parseFloat(sl.toFixed(2))
  };
}

module.exports = { computeTargets };
