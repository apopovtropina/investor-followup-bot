const config = require('../config');
const { mondayApi } = require('./client');
const { findBestMatch } = require('../utils/nameMatch');

const cols = config.monday.columns;
const rmCols = config.monday.rmColumns;

// ---------------------------------------------------------------------------
// GraphQL fragments
// ---------------------------------------------------------------------------

const ITEMS_PAGE_QUERY = `
  query ($boardId: [ID!], $cursor: String) {
    boards(ids: $boardId) {
      items_page(limit: 500, cursor: $cursor) {
        cursor
        items {
          id
          name
          group { id title }
          column_values {
            id
            text
            value
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Column-value parsing helpers
// ---------------------------------------------------------------------------

function safeParse(jsonStr) {
  if (!jsonStr || jsonStr === 'null') return null;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function getColumnById(columnValues, colId) {
  return columnValues.find((c) => c.id === colId) || null;
}

function getTextValue(columnValues, colId) {
  const col = getColumnById(columnValues, colId);
  return col ? (col.text || '') : '';
}

function getEmailValue(columnValues, colId) {
  const col = getColumnById(columnValues, colId);
  if (!col) return '';
  const parsed = safeParse(col.value);
  return parsed ? (parsed.email || '') : (col.text || '');
}

function getPhoneValue(columnValues, colId) {
  const col = getColumnById(columnValues, colId);
  if (!col) return '';
  const parsed = safeParse(col.value);
  return parsed ? (parsed.phone || '') : (col.text || '');
}

function getDateValue(columnValues, colId) {
  const col = getColumnById(columnValues, colId);
  if (!col) return null;
  const parsed = safeParse(col.value);
  if (parsed && parsed.date) {
    const timeStr = parsed.time || '00:00:00';
    const d = new Date(parsed.date + 'T' + timeStr);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function getLongTextValue(columnValues, colId) {
  const col = getColumnById(columnValues, colId);
  if (!col) return '';
  const parsed = safeParse(col.value);
  return parsed ? (parsed.text || '') : (col.text || '');
}

function getPersonValue(columnValues, colId) {
  const col = getColumnById(columnValues, colId);
  if (!col) return [];
  const parsed = safeParse(col.value);
  return parsed ? (parsed.personsAndTeams || []) : [];
}

// ---------------------------------------------------------------------------
// Parse a raw Monday item into a clean investor object
// ---------------------------------------------------------------------------

function parseInvestor(item) {
  const cv = item.column_values;
  return {
    id: item.id,
    name: item.name,
    status: getTextValue(cv, cols.status),
    email: getEmailValue(cv, cols.email),
    phone: getPhoneValue(cv, cols.phone),
    company: getTextValue(cv, cols.company),
    investorType: getTextValue(cv, cols.investorType),
    source: getTextValue(cv, cols.source),
    referredBy: getTextValue(cv, cols.referredBy),
    investmentInterest: getTextValue(cv, cols.investmentInterest),
    dealInterest: getTextValue(cv, cols.dealInterest),
    assignedTo: getPersonValue(cv, cols.assignedTo),
    lastContactDate: getDateValue(cv, cols.lastContactDate),
    nextFollowUp: getDateValue(cv, cols.nextFollowUp),
    notes: getLongTextValue(cv, cols.notes),
    link: /^\d+$/.test(String(item.id)) ? config.monday.boardUrl + item.id : '#',
  };
}

// ---------------------------------------------------------------------------
// Fetch all items from a board using cursor pagination
// ---------------------------------------------------------------------------

async function fetchAllBoardItems(boardId) {
  const allItems = [];
  let cursor = undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const variables = { boardId: [String(boardId)] };
    if (cursor) variables.cursor = cursor;

    const data = await mondayApi(ITEMS_PAGE_QUERY, variables);

    const board = data.boards && data.boards[0];
    if (!board || !board.items_page) break;

    const page = board.items_page;
    if (page.items) {
      allItems.push(...page.items);
    }

    if (!page.cursor) break; // no more pages
    cursor = page.cursor;
  }

  return allItems;
}

// ---------------------------------------------------------------------------
// Public query functions
// ---------------------------------------------------------------------------

/**
 * Returns all investors whose status is NOT "Passed / Inactive".
 */
async function getActiveInvestors() {
  try {
    const items = await fetchAllBoardItems(config.monday.boards.investorList);
    const investors = items.map(parseInvestor);

    // Filter out passed / inactive investors
    return investors.filter(
      (inv) => !inv.status.toLowerCase().includes('passed') &&
               !inv.status.toLowerCase().includes('inactive')
    );
  } catch (err) {
    console.error('[monday/queries] getActiveInvestors failed:', err.message);
    return [];
  }
}

/**
 * Returns ALL investors regardless of status.
 */
async function getAllInvestors() {
  try {
    const items = await fetchAllBoardItems(config.monday.boards.investorList);
    return items.map(parseInvestor);
  } catch (err) {
    console.error('[monday/queries] getAllInvestors failed:', err.message);
    return [];
  }
}

/**
 * Search for an investor by exact or partial name match (case-insensitive).
 */
async function getInvestorByName(name) {
  try {
    const investors = await getAllInvestors();
    const lowerName = name.toLowerCase();
    return investors.filter((inv) =>
      inv.name.toLowerCase().includes(lowerName)
    );
  } catch (err) {
    console.error('[monday/queries] getInvestorByName failed:', err.message);
    return [];
  }
}

/**
 * Returns items from the Communications Log board created/updated in the last
 * N days.
 */
async function getRecentCommunications(daysSince = 7) {
  try {
    const items = await fetchAllBoardItems(config.monday.boards.communicationsLog);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSince);

    // We filter client-side — Monday returns all items and we check the
    // date columns or updated_at information available in column values.
    // Since items_page doesn't expose updated_at directly, we look for any
    // date-type column or fall back to returning all items fetched.
    return items.filter((item) => {
      // Check each column for a date value within range
      for (const col of item.column_values) {
        const parsed = safeParse(col.value);
        if (parsed && parsed.date) {
          const d = new Date(parsed.date + 'T00:00:00');
          if (!isNaN(d.getTime()) && d >= cutoff) return true;
        }
      }
      return false;
    });
  } catch (err) {
    console.error('[monday/queries] getRecentCommunications failed:', err.message);
    return [];
  }
}

/**
 * Returns all items from the Active Offerings board.
 */
async function getActiveOfferings() {
  try {
    const items = await fetchAllBoardItems(config.monday.boards.activeOfferings);

    // Return items with basic parsing — id, name, and all column texts
    return items.map((item) => {
      const obj = { id: item.id, name: item.name };
      for (const col of item.column_values) {
        obj[col.id] = col.text || '';
      }
      return obj;
    });
  } catch (err) {
    console.error('[monday/queries] getActiveOfferings failed:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Relationship Management board query functions
// ---------------------------------------------------------------------------

/**
 * Parse a raw RM board item into a clean follow-up object.
 */
function parseRMItem(item) {
  const cv = item.column_values;
  return {
    id: item.id,
    name: item.name,
    investorStatus: getTextValue(cv, rmCols.investorStatus),
    followUpCadence: getTextValue(cv, rmCols.followUpCadence),
    lastContactDate: getDateValue(cv, rmCols.lastContactDate),
    nextFollowUp: getDateValue(cv, rmCols.nextFollowUp),
    communicationMethod: getTextValue(cv, rmCols.communicationMethod),
    email: getEmailValue(cv, rmCols.email),
    phone: getPhoneValue(cv, rmCols.phone),
    notes: getLongTextValue(cv, rmCols.notes),
    link: /^\d+$/.test(String(item.id))
      ? config.monday.rmBoardUrl + item.id
      : '#',
  };
}

/**
 * Returns all items from the Relationship Management board.
 */
async function getRMBoardItems() {
  try {
    const items = await fetchAllBoardItems(config.monday.boards.relationshipManagement);
    return items.map(parseRMItem);
  } catch (err) {
    console.error('[monday/queries] getRMBoardItems failed:', err.message);
    return [];
  }
}

/**
 * Search the RM board for items matching an investor name (fuzzy match).
 * Returns all items that match above the threshold.
 *
 * @param {string} name - Investor name to search for
 * @returns {Promise<Array>} Matching RM items
 */
async function searchRMByInvestorName(name) {
  try {
    const rmItems = await getRMBoardItems();
    if (!rmItems || rmItems.length === 0) return [];

    const result = findBestMatch(name, rmItems);
    if (!result || result.score > 0.35) return [];

    // Return the best match and any close alternatives
    const matches = [result.match];
    if (result.alternatives) {
      // Also fetch the actual items for close alternatives
      for (const alt of result.alternatives) {
        const altItem = rmItems.find((i) => i.name === alt.name);
        if (altItem) matches.push(altItem);
      }
    }
    return matches;
  } catch (err) {
    console.error('[monday/queries] searchRMByInvestorName failed:', err.message);
    return [];
  }
}

module.exports = {
  getActiveInvestors,
  getAllInvestors,
  getInvestorByName,
  getRecentCommunications,
  getActiveOfferings,
  getRMBoardItems,
  searchRMByInvestorName,
};
