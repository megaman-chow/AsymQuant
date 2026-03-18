const { computeTargets } = require("./riskEngine");
const { updateTrailing } = require("./trailingEngine");

function processTrader(trader, signal, g, price, atr) {
  const events = {
    opened: null,
    closed: null
  };

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

    events.opened = {
      side: signal,
      entry: price,
      tp,
      sl,
      size,
      g
    };
  }

  // 2. MANAGE OPEN POSITION
  if (trader.openPosition) {
    const pos = trader.openPosition;

    // Update the trailing stop
    updateTrailing(pos, price);

    let isClosed = false;
    let pnl = 0;
    let hit = null;
    let exit = null;

    if (pos.side === "LONG") {
      if (price >= pos.tp) {
        exit = pos.tp;
        pnl = (exit - pos.entry) / pos.entry * pos.size;
        isClosed = true;
        hit = "TP";
      } else if (price <= pos.sl) {
        exit = pos.sl;
        pnl = (exit - pos.entry) / pos.entry * pos.size;
        isClosed = true;
        hit = "SL";
      }
    } else if (pos.side === "SHORT") {
      if (price <= pos.tp) {
        exit = pos.tp;
        pnl = (pos.entry - exit) / pos.entry * pos.size;
        isClosed = true;
        hit = "TP";
      } else if (price >= pos.sl) {
        exit = pos.sl;
        pnl = (pos.entry - exit) / pos.entry * pos.size;
        isClosed = true;
        hit = "SL";
      }
    }

    if (isClosed) {
      trader.balance += pnl;
      trader.pnl = (trader.pnl || 0) + pnl;
      
      if (pnl > 0) trader.wins++;
      else trader.losses++;

      trader.openPosition = null;

      events.closed = {
        side: pos.side,
        entry: pos.entry,
        exit,
        hit,
        size: pos.size,
        g: pos.g,
        pnl
      };
    }
  }

  return events;
}

module.exports = { processTrader };
