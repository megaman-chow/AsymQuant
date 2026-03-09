/**
 * CandleEngine: Manages multi-timeframe candle history.
 */
class CandleEngine {
  constructor() {
    this.store = {};
  }

  update(tf, candle) {
    if (!this.store[tf]) this.store[tf] = [];
    
    const arr = this.store[tf];
    arr.push(candle);

    // Keep the last 500 candles for indicator calculations
    if (arr.length > 500) arr.shift();
    
    return arr;
  }

  get(tf) {
    return this.store[tf] || [];
  }
}

// Export the class directly so "new CandleEngine()" works
module.exports = { CandleEngine };
