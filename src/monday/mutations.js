const config = require('../config');
const { mondayApi } = require('./client');

const BOARD_ID = String(config.monday.boards.investorList);

// ---------------------------------------------------------------------------
// GraphQL mutation templates
// ---------------------------------------------------------------------------

const CHANGE_SIMPLE_VALUE = `
  mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
    change_simple_column_value(
      board_id: $boardId,
      item_id: $itemId,
      column_id: $columnId,
      value: $value
    ) {
      id
    }
  }
`;

const CHANGE_MULTIPLE_VALUES = `
  mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
    change_multiple_column_values_v2(
      board_id: $boardId,
      item_id: $itemId,
      column_values: $columnValues
    ) {
      id
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

/**
 * Update one or more column values on an item.
 *
 * @param {string|number} itemId      - The Monday item ID
 * @param {string}        columnId    - Ignored when using change_multiple; kept for API compat
 * @param {string}        value       - JSON string of column values, e.g. '{"date_col": {"date": "2025-01-01"}}'
 */
async function updateColumnValue(itemId, columnId, value) {
  try {
    const data = await mondayApi(CHANGE_MULTIPLE_VALUES, {
      boardId: BOARD_ID,
      itemId: String(itemId),
      columnValues: value,
    });
    return data;
  } catch (err) {
    console.error(
      `[monday/mutations] updateColumnValue failed for item ${itemId}:`,
      err.message
    );
    return null;
  }
}

/**
 * Set the "Next Follow-Up" date column.
 *
 * @param {string|number} itemId  - The Monday item ID
 * @param {string}        dateStr - Date in YYYY-MM-DD format
 */
async function updateNextFollowUp(itemId, dateStr) {
  try {
    const columnValues = JSON.stringify({
      [config.monday.columns.nextFollowUp]: { date: dateStr },
    });

    const data = await mondayApi(CHANGE_MULTIPLE_VALUES, {
      boardId: BOARD_ID,
      itemId: String(itemId),
      columnValues,
    });
    return data;
  } catch (err) {
    console.error(
      `[monday/mutations] updateNextFollowUp failed for item ${itemId}:`,
      err.message
    );
    return null;
  }
}

/**
 * Set the "Last Contact Date" column.
 *
 * @param {string|number} itemId  - The Monday item ID
 * @param {string}        dateStr - Date in YYYY-MM-DD format
 */
async function updateLastContactDate(itemId, dateStr) {
  try {
    const columnValues = JSON.stringify({
      [config.monday.columns.lastContactDate]: { date: dateStr },
    });

    const data = await mondayApi(CHANGE_MULTIPLE_VALUES, {
      boardId: BOARD_ID,
      itemId: String(itemId),
      columnValues,
    });
    return data;
  } catch (err) {
    console.error(
      `[monday/mutations] updateLastContactDate failed for item ${itemId}:`,
      err.message
    );
    return null;
  }
}

/**
 * Update an item's name.
 *
 * @param {string|number} itemId  - The Monday item ID
 * @param {string}        newName - The new name for the item
 */
async function updateItemName(itemId, newName) {
  try {
    const data = await mondayApi(CHANGE_SIMPLE_VALUE, {
      boardId: BOARD_ID,
      itemId: String(itemId),
      columnId: 'name',
      value: newName,
    });
    return data;
  } catch (err) {
    console.error(
      `[monday/mutations] updateItemName failed for item ${itemId}:`,
      err.message
    );
    return null;
  }
}

/**
 * Prepend the "going cold" indicator to an investor's name if not already present.
 *
 * @param {string|number} itemId      - The Monday item ID
 * @param {string}        currentName - The investor's current name
 */
async function addGoingColdFlag(itemId, currentName) {
  const FLAG = '\uD83D\uDD34'; // Red circle emoji

  if (currentName.startsWith(FLAG)) {
    // Already flagged, nothing to do
    return null;
  }

  const newName = `${FLAG} ${currentName}`;
  return updateItemName(itemId, newName);
}

/**
 * Remove the "going cold" indicator from an investor's name if present.
 *
 * @param {string|number} itemId      - The Monday item ID
 * @param {string}        currentName - The investor's current name
 */
async function removeGoingColdFlag(itemId, currentName) {
  const FLAG = '\uD83D\uDD34'; // Red circle emoji

  if (!currentName.startsWith(FLAG)) {
    // No flag to remove
    return null;
  }

  // Remove the flag and any trailing space (u flag needed for emoji surrogate pair)
  const newName = currentName.replace(/^\uD83D\uDD34\s*/u, '');
  return updateItemName(itemId, newName);
}

module.exports = {
  updateColumnValue,
  updateNextFollowUp,
  updateLastContactDate,
  updateItemName,
  addGoingColdFlag,
  removeGoingColdFlag,
};
