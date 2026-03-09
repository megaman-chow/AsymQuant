const { RSI, SMA } = require("technicalindicators");

/**
 * Simple Technical Indicator Engine
 */
function computeIndicators(candles) {
  if (candles.length < 50) return {};

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume || 0);

  const ema = (period) => {
    const k = 2 / (period + 1);
    let val = closes[0];
    for (let i = 1; i < closes.length; i++) {
      val = closes[i] * k + val * (1 - k);
    }
    return val;
  };

  // True Range / ATR(14) similar to browser lab
  const tr = [0];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const range1 = curr.high - curr.low;
    const range2 = Math.abs(curr.high - prev.close);
    const range3 = Math.abs(curr.low - prev.close);
    tr.push(Math.max(range1, range2, range3));
  }

  const period = 14;
  let atr = 0;
  if (candles.length > period) {
    // initial ATR = simple average of first `period` TRs (skip tr[0])
    let s = 0;
    for (let i = 1; i <= period; i++) s += tr[i];
    s /= period;
    // smooth over the rest
    for (let i = period + 1; i < tr.length; i++) {
      s = (s * (period - 1) + tr[i]) / period;
    }
    atr = s;
  }

  const lastCandle = candles[candles.length - 1];

  // RSI (14-period) on closes
  const rsiSeries = RSI.calculate({ period: 14, values: closes });
  const rsi = rsiSeries.length ? rsiSeries[rsiSeries.length - 1] : 50;

  // Volume moving average (20-period)
  const volumeMASeries = SMA.calculate({ period: 20, values: volumes });
  const volumeMA = volumeMASeries.length
    ? volumeMASeries[volumeMASeries.length - 1]
    : volumes[volumes.length - 1] || 0;

  return {
    ema20: ema(20),
    ema50: ema(50),
    atr: atr || lastCandle.close * 0.01,
    close: lastCandle.close,
    rsi,
    volumeMA
  };
}

module.exports = { computeIndicators };
