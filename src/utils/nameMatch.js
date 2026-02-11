const Fuse = require('fuse.js');

/**
 * Find the best fuzzy match for an investor name within a list.
 *
 * @param {string} searchName - The name to search for
 * @param {Array}  investors  - Array of investor objects (each must have a 'name' property)
 * @returns {Object|null} Match result:
 *   { match: investorObject, score: number, alternatives?: Array }
 *   or null if no match found
 */
function findBestMatch(searchName, investors) {
  if (!searchName || !investors || investors.length === 0) return null;

  // Prepare investors with cleaned names (strip leading red circle emoji and whitespace)
  const prepared = investors.map((inv) => ({
    ...inv,
    cleanName: inv.name.replace(/^\u{1F534}\s*/u, '').trim(),
  }));

  const fuse = new Fuse(prepared, {
    keys: ['cleanName'],
    threshold: 0.4,
    includeScore: true,
  });

  const results = fuse.search(searchName);

  if (results.length === 0) return null;

  const topResult = results[0];

  // If only one result or top result is clearly the best
  if (topResult.score > 0.4) return null; // score too high means poor match

  // Check for close alternatives (score difference < 0.1 between top matches)
  const closeAlternatives = results
    .slice(1)
    .filter((r) => Math.abs(r.score - topResult.score) < 0.1)
    .map((r) => ({
      name: r.item.name,
      score: r.score,
    }));

  const result = {
    match: topResult.item,
    score: topResult.score,
  };

  if (closeAlternatives.length > 0) {
    result.alternatives = closeAlternatives;
  }

  return result;
}

module.exports = { findBestMatch };
