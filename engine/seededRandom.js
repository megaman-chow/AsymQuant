function hashSeed(input) {
  const str = String(input ?? "tradingbot-default");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalizeState(state) {
  const n = Number(state);
  if (!Number.isFinite(n)) return 0x6d2b79f5;
  const normalized = (Math.floor(n) >>> 0);
  return normalized === 0 ? 0x6d2b79f5 : normalized;
}

function createSeededRandom(initialState) {
  let state = normalizeState(initialState);

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    pick(arr) {
      if (!Array.isArray(arr) || !arr.length) return undefined;
      return arr[Math.floor(next() * arr.length)];
    },
    bool(probability = 0.5) {
      return next() < probability;
    },
    range(min, max) {
      return min + (max - min) * next();
    },
    getState() {
      return state >>> 0;
    },
    setState(nextState) {
      state = normalizeState(nextState);
    },
  };
}

module.exports = {
  hashSeed,
  normalizeState,
  createSeededRandom,
};
