const { detectPullback } = require("../engine/pullbackEngine");
const { computeMomentum } = require("../engine/momentumEngine");
const { computeG } = require("../engine/gFactor");

/**
 * Strategy V2: Multi-Factor Sniper
 * Requirements: Trend Alignment, G-Factor Conviction, and Pullback Trigger.
 */
function evaluate(candles, indicators, trader) {
  if (candles.length < 5) return { signal: null, g: 0 };

  const currentCandle = candles[candles.length - 1];
  const price = currentCandle.close;
  const prevPrice = candles[candles.length - 2].close;

  // 1. Calculate Momentum Physics
  const momentum = computeMomentum(candles.map(c => c.close));

  // 2. Detect Value-Area Pullbacks
  const pull = detectPullback(price, indicators.ema20, prevPrice);

  // 3. Quantify Conviction
  const data = {
    price,
    ema20: indicators.ema20,
    ema50: indicators.ema50,
    rsi: indicators.rsi,
    volume: currentCandle.volume,
    volumeMA: indicators.volumeMA,
    velocity: momentum.velocity,
    candle: currentCandle
  };

  const g = computeG(data);
  let signal = null;

  // 4. Entry Logic (Trend + Conviction + Trigger)
  const isBullishTrend = indicators.ema20 > indicators.ema50;
  const isBearishTrend = indicators.ema20 < indicators.ema50;
  const hasConviction = g > (trader.gThreshold || 0);

  if (isBullishTrend && pull.pullBull && hasConviction) {
    signal = "LONG";
  } else if (isBearishTrend && pull.pullBear && hasConviction) {
    signal = "SHORT";
  }

  // 5. Contrarian Logic (Genetic Variation)
  if (trader.invert && signal) {
    signal = signal === "LONG" ? "SHORT" : "LONG";
  }

  return { signal, g };
}

module.exports = { evaluate };
