/**
 * Calculates the first and second derivatives of price movement.
 * Velocity: Change in price (Speed)
 * Acceleration: Change in Velocity (Momentum Shift)
 */
function computeMomentum(closes) {
  if (closes.length < 3) {
    return { velocity: 0, acceleration: 0 };
  }

  const n = closes.length;

  // First Derivative: Current Price - Previous Price
  const v = closes[n - 1] - closes[n - 2];

  // Second Derivative: Current Velocity - Previous Velocity
  const a = (closes[n - 1] - closes[n - 2]) - (closes[n - 2] - closes[n - 3]);

  return {
    velocity: parseFloat(v.toFixed(8)),
    acceleration: parseFloat(a.toFixed(8))
  };
}

module.exports = { computeMomentum };
