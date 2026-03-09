const fs = require('fs');
const path = './traders_state.json';

/**
 * Saves the current population to a JSON file.
 */
function savePopulation(traders) {
  try {
    const data = JSON.stringify(traders, null, 2);
    fs.writeFileSync(path, data);
    console.log("💾 Population state saved to disk.");
  } catch (err) {
    console.error("❌ Failed to save population:", err.message);
  }
}

/**
 * Loads the population from disk if it exists.
 */
function loadPopulation() {
  if (fs.existsSync(path)) {
    try {
      const data = fs.readFileSync(path);
      console.log("📂 Previous population state loaded.");
      return JSON.parse(data);
    } catch (err) {
      console.error("❌ Failed to load population, starting fresh.");
      return null;
    }
  }
  return null;
}

module.exports = { savePopulation, loadPopulation };
