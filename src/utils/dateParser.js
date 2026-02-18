const chrono = require('chrono-node');

/**
 * Parse a natural-language date/time expression into a Date object.
 * Defaults to 9:00 AM Central Time if no specific time is provided.
 *
 * @param {string} expression - Natural language date string (e.g. "tomorrow at 2pm", "next Monday")
 * @returns {{ date: Date, hasTime: boolean }|null} Parsed result, or null if parsing fails
 */
function parseNaturalDate(expression) {
  if (!expression || typeof expression !== 'string') return null;

  const refDate = new Date();
  const parseOptions = { forwardDate: true };

  // Try parsing the expression directly
  let results = chrono.parse(expression, refDate, parseOptions);

  // If no results, try prepending common prefixes
  if (results.length === 0) {
    results = chrono.parse('on ' + expression, refDate, parseOptions);
  }
  if (results.length === 0) {
    results = chrono.parse('at ' + expression, refDate, parseOptions);
  }

  if (results.length === 0) return null;

  const parsed = results[0];
  const date = parsed.start.date();

  // Check if the user explicitly specified a time
  const hasTime = parsed.start.isCertain('hour');

  // If hour was not explicitly stated, default to 9:00 AM Central Time
  if (!hasTime) {
    // Dynamically determine if CDT or CST is in effect
    // by checking the timezone offset for the target date
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);
    const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
    const isDST = date.getTimezoneOffset() < stdOffset;
    const centralOffsetHours = isDST ? 5 : 6; // CDT = UTC-5, CST = UTC-6
    date.setUTCHours(9 + centralOffsetHours, 0, 0, 0);
  }

  return { date, hasTime };
}

module.exports = { parseNaturalDate };
