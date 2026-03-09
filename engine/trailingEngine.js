/**
 * Step-based Trailing Stop Logic
 * Protects capital by moving SL to break-even at 1R profit,
 * and trails the price at 2R profit and beyond.
 */
function updateTrailing(position, price) {
  // R = Initial Risk (distance between entry and stop loss)
  const r = Math.abs(position.entry - position.sl);

  if (position.side === "LONG") {
    // Stage 1: Move to Break-even at 1R profit
    if (price >= position.entry + r && position.sl < position.entry) {
      position.sl = position.entry;
    }

    // Stage 2: Trail the price at 2R profit
    if (price >= position.entry + 2 * r) {
      const newSl = price - r;
      if (newSl > position.sl) {
        position.sl = newSl;
      }
    }
  }

  if (position.side === "SHORT") {
    // Stage 1: Move to Break-even at 1R profit
    if (price <= position.entry - r && position.sl > position.entry) {
      position.sl = position.entry;
    }

    // Stage 2: Trail the price at 2R profit
    if (price <= position.entry - 2 * r) {
      const newSl = price + r;
      if (newSl < position.sl) {
        position.sl = newSl;
      }
    }
  }
}

module.exports = { updateTrailing };
