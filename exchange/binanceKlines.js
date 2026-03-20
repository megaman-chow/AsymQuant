const axios = require("axios");

function mapKline(row) {
  return {
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
    time: row[0],
    closeTime: row[6],
  };
}

function intervalToMs(interval) {
  const m = String(interval).match(/^(\d+)([mhdw])$/i);
  if (!m) {
    throw new Error(`Unsupported Binance interval: ${interval}`);
  }
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  const unitMs = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  }[unit];
  return value * unitMs;
}

async function fetchKlinesRaw(symbol, interval, params) {
  const { data } = await axios.get("https://api.binance.com/api/v3/klines", {
    params: {
      symbol: symbol.toUpperCase(),
      interval,
      ...params,
    },
    timeout: 20000,
  });
  if (!Array.isArray(data)) throw new Error("Unexpected klines response");
  return data;
}

/**
 * Fetch last N *closed* candles from Binance (public REST).
 * Used to warm CandleEngine after restart so sim continues without waiting minCandles.
 */
async function fetchClosedKlines(symbol, interval, limit = 150, endTime) {
  const cap = Math.min(1000, Math.max(1, limit));
  const rows = await fetchKlinesRaw(symbol, interval, {
    limit: cap,
    ...(Number.isFinite(endTime) ? { endTime: Math.floor(endTime) } : {}),
  });
  return rows.map(mapKline);
}

async function fetchClosedKlinesBetween(symbol, interval, startTime, endTime = Date.now()) {
  const tfMs = intervalToMs(interval);
  const rows = [];
  let cursor = Math.max(0, Math.floor(Number(startTime) || 0));
  const finalEnd = Math.floor(Number(endTime) || Date.now());

  while (cursor <= finalEnd) {
    const batch = await fetchKlinesRaw(symbol, interval, {
      startTime: cursor,
      endTime: finalEnd,
      limit: 1000,
    });

    if (!batch.length) break;

    const mapped = batch
      .map(mapKline)
      .filter((candle) => candle.time >= cursor && candle.closeTime <= finalEnd);

    rows.push(...mapped);

    const last = batch[batch.length - 1];
    const nextCursor = Number(last[0]) + tfMs;
    if (!Number.isFinite(nextCursor) || nextCursor <= cursor || batch.length < 1000) {
      break;
    }
    cursor = nextCursor;
  }

  return rows;
}

module.exports = {
  fetchClosedKlines,
  fetchClosedKlinesBetween,
  intervalToMs,
};
