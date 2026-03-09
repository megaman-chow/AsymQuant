const WebSocket = require("ws");

/**
 * Connects to Binance WebSocket for a specific symbol and timeframe.
 * Filters for closed candles only to ensure signal stability.
 */
function connect(symbol, timeframe, onCandle) {
  const stream = `${symbol.toLowerCase()}@kline_${timeframe}`;
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);

  ws.on("open", () => {
    console.log(`📡 Connected to stream: ${stream}`);
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    // Only proceed if the candle is closed
    if (!data.k.x) return;

    const candle = {
      open: parseFloat(data.k.o),
      high: parseFloat(data.k.h),
      low: parseFloat(data.k.l),
      close: parseFloat(data.k.c),
      volume: parseFloat(data.k.v),
      time: data.k.t
    };

    onCandle(timeframe, candle);
  });

  ws.on("error", (err) => {
    console.error(`❌ WebSocket Error on ${timeframe}:`, err.message);
  });

  ws.on("close", () => {
    console.log(`⚠️ Connection closed for ${timeframe}. Reconnecting...`);
    setTimeout(() => connect(symbol, timeframe, onCandle), 5000);
  });
}

module.exports = { connect };
