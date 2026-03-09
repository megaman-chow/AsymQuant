const { computeTargets } = require("./riskEngine");
const { updateTrailing } = require("./trailingEngine");

function processTrader(trader, signal, g, price, atr) {
  // 1. OPEN POSITION
  if (signal && !trader.openPosition) {
    const { tp, sl } = computeTargets(price, atr, signal);
    
    // Dynamic Size based on conviction G
    const baseRisk = trader.balance * 0.02;
    const size = baseRisk * g;

    trader.openPosition = {
      side: signal,
      entry: price,
      tp,
      sl,
      size,
      g
    };

    // Track for scoringEngine
    trader.totalG = (trader.totalG || 0) + g;
  }

  // 2. MANAGE OPEN POSITION
  if (trader.openPosition) {
    const pos = trader.openPosition;

    // Update the trailing stop
    updateTrailing(pos, price);

    let isClosed = false;
    let pnl = 0;

    if (pos.side === "LONG") {
      if (price >= pos.tp) {
        pnl = (pos.tp - pos.entry) / pos.entry * pos.size;
        isClosed = true;
      } else if (price <= pos.sl) {
        pnl = (pos.sl - pos.entry) / pos.entry * pos.size;
        isClosed = true;
      }
    } else if (pos.side === "SHORT") {
      if (price <= pos.tp) {
        pnl = (pos.entry - pos.tp) / pos.entry * pos.size;
        isClosed = true;
      } else if (price >= pos.sl) {
        pnl = (pos.entry - pos.sl) / pos.entry * pos.size;
        isClosed = true;
      }
    }

    if (isClosed) {
      trader.balance += pnl;
      trader.pnl = (trader.pnl || 0) + pnl;
      
      if (pnl > 0) trader.wins++;
      else trader.losses++;

      trader.openPosition = null;
    }
  }
}

module.exports = { processTrader };
