/**
 * Detects price crossovers with the EMA 20.
 * A "Bullish Pullback" is often defined as price dipping below and 
 * then reclaiming the EMA 20 while the overall trend remains bullish.
 */
function detectPullback(price, ema20, prevPrice) {
  let pullBull = false;
  let pullBear = false;

  // Bullish Cross: Price moves from below EMA 20 to above EMA 20
  if (prevPrice < ema20 && price > ema20) {
    pullBull = true;
  }

  // Bearish Cross: Price moves from above EMA 20 to below EMA 20
  if (prevPrice > ema20 && price < ema20) {
    pullBear = true;
  }

  return {
    pullBull,
    pullBear
  };
}

module.exports = { detectPullback };
