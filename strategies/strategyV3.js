const { detectPullback } = require("../engine/pullbackEngine");
const { computeMomentum } = require("../engine/momentumEngine");
const { computeG } = require("../engine/gFactor");

/**
 * Strategy V3
 * Multi-Factor Sniper with Momentum & Volatility Filters
 */

function evaluate(candles, indicators, trader) {

  if (candles.length < 10) {
    return { signal: null, g: 0 };
  }

  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const price = current.close;

  /* ---------------------------
     MOMENTUM PHYSICS
  ---------------------------- */

  const momentum = computeMomentum(
    candles.map(c => c.close)
  );

  const velocity = momentum.velocity;

  /* ---------------------------
     PULLBACK DETECTION
  ---------------------------- */

  const pull = detectPullback(
    price,
    indicators.ema20,
    prev.close
  );

  /* ---------------------------
     CONVICTION MODEL
  ---------------------------- */

  const data = {
    price,
    ema20: indicators.ema20,
    ema50: indicators.ema50,
    rsi: indicators.rsi,
    volume: current.volume,
    volumeMA: indicators.volumeMA,
    velocity,
    candle: current
  };

  const g = computeG(data);

  let signal = null;

  /* ---------------------------
     TREND DETECTION
  ---------------------------- */

  const emaSpread =
    Math.abs(indicators.ema20 - indicators.ema50);

  const trendStrength = emaSpread / price;

  const bullishTrend =
    indicators.ema20 > indicators.ema50;

  const bearishTrend =
    indicators.ema20 < indicators.ema50;

  /* ---------------------------
     FILTERS
  ---------------------------- */

  const hasConviction =
    g > (trader.gThreshold || 0);

  const momentumBull = velocity > 0;
  const momentumBear = velocity < 0;

  const volumeHealthy =
    current.volume > indicators.volumeMA * 0.8;

  const trendHealthy =
    trendStrength > 0.001;

  /* ---------------------------
     ENTRY LOGIC
  ---------------------------- */

  if (
    bullishTrend &&
    pull.pullBull &&
    momentumBull &&
    hasConviction &&
    volumeHealthy &&
    trendHealthy
  ) {
    signal = "LONG";
  }

  else if (
    bearishTrend &&
    pull.pullBear &&
    momentumBear &&
    hasConviction &&
    volumeHealthy &&
    trendHealthy
  ) {
    signal = "SHORT";
  }

  /* ---------------------------
     GENETIC CONTRARIAN
  ---------------------------- */

  if (trader.invert && signal) {
    signal =
      signal === "LONG"
        ? "SHORT"
        : "LONG";
  }

  return { signal, g };
}

module.exports = { evaluate };
