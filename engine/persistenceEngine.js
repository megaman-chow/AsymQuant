const fs = require("fs");

const tradersPath = "./traders_state.json";
const runtimePath = "./bot_runtime_state.json";

/**
 * Saves the current population to a JSON file.
 */
function savePopulation(traders) {
  try {
    const data = JSON.stringify(traders, null, 2);
    fs.writeFileSync(tradersPath, data);
    console.log("💾 Population state saved to disk.");
  } catch (err) {
    console.error("❌ Failed to save population:", err.message);
  }
}

/**
 * Loads the population from disk if it exists.
 */
function loadPopulation() {
  if (fs.existsSync(tradersPath)) {
    try {
      const data = fs.readFileSync(tradersPath);
      console.log("📂 Previous population state loaded.");
      return JSON.parse(data);
    } catch (err) {
      console.error("❌ Failed to load population, starting fresh.");
      return null;
    }
  }
  return null;
}

function saveRuntimeState(state) {
  try {
    const data = JSON.stringify(state, null, 2);
    fs.writeFileSync(runtimePath, data);
  } catch (err) {
    console.error("❌ Failed to save runtime state:", err.message);
  }
}

function loadRuntimeState() {
  if (fs.existsSync(runtimePath)) {
    try {
      const data = fs.readFileSync(runtimePath);
      console.log("🕓 Previous runtime state loaded.");
      return JSON.parse(data);
    } catch (err) {
      console.error("❌ Failed to load runtime state, continuing without it.");
      return null;
    }
  }
  return null;
}

module.exports = {
  savePopulation,
  loadPopulation,
  saveRuntimeState,
  loadRuntimeState,
};
