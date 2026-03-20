/**
 * EvolutionEngine: The Darwinian core.
 * Sorts traders by score, keeps the elite, and breeds new ones.
 */
function createRandomHelpers(rng) {
  if (rng && typeof rng.next === "function") {
    return {
      next: () => rng.next(),
      bool: (p = 0.5) => (rng.bool ? rng.bool(p) : rng.next() < p),
      pick: (arr) => (rng.pick ? rng.pick(arr) : arr[Math.floor(rng.next() * arr.length)]),
      range: (min, max) => (rng.range ? rng.range(min, max) : min + (max - min) * rng.next()),
    };
  }

  return {
    next: () => Math.random(),
    bool: (p = 0.5) => Math.random() < p,
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    range: (min, max) => min + (max - min) * Math.random(),
  };
}

function evolve(traders, options = {}) {
  if (!traders || traders.length === 0) return [];
  const random = createRandomHelpers(options.rng);
  const generation = Number(options.generation || 0);

  // 1. Sort by score (descending)
  const sorted = [...traders].sort((a, b) => b.score - a.score);
  
  // 2. Define the Elites (Top 10%)
  const eliteCount = Math.max(1, Math.floor(traders.length * 0.1));
  const elites = sorted.slice(0, eliteCount);
  
  // 3. Define the survivors (Top 50%) to use as parents
  const parentCount = Math.max(1, Math.floor(traders.length * 0.5));
  const parents = sorted.slice(0, parentCount);

  const newGeneration = [...elites];

  // 4. Fill the rest of the pool with offspring
  while (newGeneration.length < traders.length) {
    const parentA = random.pick(parents);
    const parentB = random.pick(parents);
    
    newGeneration.push(breed(parentA, parentB, newGeneration.length, generation, random));
  }

  return newGeneration;
}

/**
 * Breeding logic: Crossover genes + slight mutation
 */
function breed(a, b, newId, generation, random) {
  const mutateThreshold = random.bool(0.05);
  return {
    id: `gen_${generation}_${newId}`,
    balance: 10000, // Children start with fresh capital
    wins: 0,
    losses: 0,
    totalG: 0,
    score: 0,
    
    // Genetic Crossover
    timeframe: random.bool(0.5) ? a.timeframe : b.timeframe,
    emaFast: random.bool(0.5) ? a.emaFast : b.emaFast,
    emaSlow: random.bool(0.5) ? a.emaSlow : b.emaSlow,
    gThreshold: random.bool(0.5) ? a.gThreshold : b.gThreshold,
    invert: random.bool(0.5) ? a.invert : b.invert,
    
    // Mutation (5% chance to change a trait entirely)
    ...(mutateThreshold && {
      gThreshold: Number(random.range(0.2, 0.7).toFixed(2))
    }),
    
    openPosition: null
  };
}

module.exports = { evolve };
