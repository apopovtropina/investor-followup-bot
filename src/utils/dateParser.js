const chrono = require('chrono-node');

/**
 * Parse a natural-language date/time expression into a Date object.
 * Defaults to 9:00 AM EST if no specific time is provided.
 *
 * @param {string} expression - Natural language date string (e.g. "tomorrow at 2pm", "next Monday")
 * @returns {Date|null} Parsed Date object, or null if parsing fails
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

  // If hour was not explicitly stated, default to 9:00 AM Eastern
  // chrono's isCertain('hour') tells us whether the user specified a time
  if (!parsed.start.isCertain('hour')) {
    // Dynamically determine if EDT or EST is in effect
    // by checking the timezone offset for the target date
    const testDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const utcEquivalent = new Date(date);
    utcEquivalent.setFullYear(testDate.getFullYear(), testDate.getMonth(), testDate.getDate());
    // Get the actual offset for this date (handles DST)
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);
    const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
    const isDST = date.getTimezoneOffset() < stdOffset;
    const easternOffsetHours = isDST ? 4 : 5; // EDT = UTC-4, EST = UTC-5
    date.setUTCHours(9 + easternOffsetHours, 0, 0, 0);
  }

  return date;
}

module.exports = { parseNaturalDate };
