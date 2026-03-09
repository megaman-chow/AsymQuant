const { createPool } = require("../traders/traderPool");

/**
 * EvolutionEngine: The Darwinian core.
 * Sorts traders by score, keeps the elite, and breeds new ones.
 */
function evolve(traders) {
  if (!traders || traders.length === 0) return [];

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
    const parentA = parents[Math.floor(Math.random() * parents.length)];
    const parentB = parents[Math.floor(Math.random() * parents.length)];
    
    newGeneration.push(breed(parentA, parentB, newGeneration.length));
  }

  return newGeneration;
}

/**
 * Breeding logic: Crossover genes + slight mutation
 */
function breed(a, b, newId) {
  return {
    id: `gen_${newId}_${Date.now().toString().slice(-4)}`,
    balance: 10000, // Children start with fresh capital
    wins: 0,
    losses: 0,
    totalG: 0,
    score: 0,
    
    // Genetic Crossover
    timeframe: Math.random() > 0.5 ? a.timeframe : b.timeframe,
    emaFast: Math.random() > 0.5 ? a.emaFast : b.emaFast,
    emaSlow: Math.random() > 0.5 ? a.emaSlow : b.emaSlow,
    gThreshold: Math.random() > 0.5 ? a.gThreshold : b.gThreshold,
    invert: Math.random() > 0.5 ? a.invert : b.invert,
    
    // Mutation (5% chance to change a trait entirely)
    ...(Math.random() < 0.05 && { gThreshold: Number((Math.random() * 0.5 + 0.2).toFixed(2)) }),
    
    openPosition: null
  };
}

module.exports = { evolve };
