const config = require('../config');
const { mondayApi } = require('./client');

// Board IDs
const INVESTOR_LIST_BOARD_ID = String(config.monday.boards.investorList);
const RM_BOARD_ID = String(config.monday.boards.relationshipManagement);
const COMMS_LOG_BOARD_ID = String(config.monday.boards.communicationsLog);

// Column references
const investorCols = config.monday.columns;   // Investor List (READ board)
const rmCols = config.monday.rmColumns;       // Relationship Management (WRITE board)
const commsCols = config.monday.commsColumns;  // Communications Log

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
    change_multiple_column_values(
      board_id: $boardId,
      item_id: $itemId,
      column_values: $columnValues
    ) {
      id
    }
  }
`;

const CREATE_ITEM = `
  mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
    create_item(
      board_id: $boardId,
      group_id: $groupId,
      item_name: $itemName,
      column_values: $columnValues,
      create_labels_if_missing: true
    ) {
      id
      name
    }
  }
`;

const MOVE_ITEM_TO_GROUP = `
  mutation ($itemId: ID!, $groupId: String!) {
    move_item_to_group(item_id: $itemId, group_id: $groupId) {
      id
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutation helpers — Investor List board (updates to existing investors)
// ---------------------------------------------------------------------------

/**
 * Update one or more column values on an item.
 *
 * @param {string|number} itemId      - The Monday item ID
 * @param {string}        columnId    - Ignored when using change_multiple; kept for API compat
 * @param {string}        value       - JSON string of column values
 * @param {string}        [boardId]   - Board ID (defaults to Investor List)
 */
async function updateColumnValue(itemId, columnId, value, boardId) {
  const targetBoard = boardId || INVESTOR_LIST_BOARD_ID;
  try {
    console.log(`[monday/mutations] updateColumnValue: board=${targetBoard} item=${itemId} col=${columnId} value=${value}`);
    const data = await mondayApi(CHANGE_MULTIPLE_VALUES, {
      boardId: targetBoard,
      itemId: String(itemId),
      columnValues: value,
    });
    console.log(`[monday/mutations] updateColumnValue succeeded for item ${itemId}`);
    return data;
  } catch (err) {
    console.error(`[monday/mutations] updateColumnValue FAILED for item ${itemId}:`, err.message);
    console.error(`[monday/mutations] Error details:`, JSON.stringify({
      graphqlErrors: err.graphqlErrors,
      errorCode: err.errorCode,
      statusCode: err.statusCode,
      responseBody: err.responseBody,
      stack: err.stack,
    }, null, 2));
    return null;
  }
}

/**
 * Set the "Next Follow-Up" date column on the Investor List board.
 */
async function updateNextFollowUp(itemId, dateStr) {
  try {
    const columnValues = JSON.stringify({
      [investorCols.nextFollowUp]: { date: dateStr },
    });
    console.log(`[monday/mutations] updateNextFollowUp: item=${itemId} date=${dateStr}`);

    const data = await mondayApi(CHANGE_MULTIPLE_VALUES, {
      boardId: INVESTOR_LIST_BOARD_ID,
      itemId: String(itemId),
      columnValues,
    });
    console.log(`[monday/mutations] updateNextFollowUp succeeded for item ${itemId}`);
    return data;
  } catch (err) {
    console.error(`[monday/mutations] updateNextFollowUp FAILED for item ${itemId}:`, err.message);
    return null;
  }
}

/**
 * Set the "Last Contact Date" column on the Investor List board.
 */
async function updateLastContactDate(itemId, dateStr) {
  try {
    const columnValues = JSON.stringify({
      [investorCols.lastContactDate]: { date: dateStr },
    });
    console.log(`[monday/mutations] updateLastContactDate: item=${itemId} date=${dateStr}`);

    const data = await mondayApi(CHANGE_MULTIPLE_VALUES, {
      boardId: INVESTOR_LIST_BOARD_ID,
      itemId: String(itemId),
      columnValues,
    });
    console.log(`[monday/mutations] updateLastContactDate succeeded for item ${itemId}`);
    return data;
  } catch (err) {
    console.error(`[monday/mutations] updateLastContactDate FAILED for item ${itemId}:`, err.message);
    return null;
  }
}

/**
 * Update an item's name on the Investor List board.
 */
async function updateItemName(itemId, newName) {
  try {
    console.log(`[monday/mutations] updateItemName: item=${itemId} newName="${newName}"`);
    const data = await mondayApi(CHANGE_SIMPLE_VALUE, {
      boardId: INVESTOR_LIST_BOARD_ID,
      itemId: String(itemId),
      columnId: 'name',
      value: newName,
    });
    console.log(`[monday/mutations] updateItemName succeeded for item ${itemId}`);
    return data;
  } catch (err) {
    console.error(`[monday/mutations] updateItemName FAILED for item ${itemId}:`, err.message);
    return null;
  }
}

/**
 * Prepend the "going cold" indicator to an investor's name if not already present.
 */
async function addGoingColdFlag(itemId, currentName) {
  const FLAG = '\uD83D\uDD34'; // Red circle emoji
  if (currentName.startsWith(FLAG)) return null;
  const newName = `${FLAG} ${currentName}`;
  return updateItemName(itemId, newName);
}

/**
 * Remove the "going cold" indicator from an investor's name if present.
 */
async function removeGoingColdFlag(itemId, currentName) {
  const FLAG = '\uD83D\uDD34'; // Red circle emoji
  if (!currentName.startsWith(FLAG)) return null;
  const newName = currentName.replace(/^\uD83D\uDD34\s*/u, '');
  return updateItemName(itemId, newName);
}

/**
 * Update the "Assigned To" people column on an investor item (Investor List board).
 */
async function updateAssignedTo(itemId, mondayPersonId) {
  try {
    const columnValues = JSON.stringify({
      [investorCols.assignedTo]: {
        personsAndTeams: [{ id: Number(mondayPersonId), kind: 'person' }],
      },
    });
    console.log(`[monday/mutations] updateAssignedTo: item=${itemId} person=${mondayPersonId}`);

    const data = await mondayApi(CHANGE_MULTIPLE_VALUES, {
      boardId: INVESTOR_LIST_BOARD_ID,
      itemId: String(itemId),
      columnValues,
    });
    console.log(`[monday/mutations] updateAssignedTo succeeded for item ${itemId}`);
    return data;
  } catch (err) {
    console.error(`[monday/mutations] updateAssignedTo FAILED for item ${itemId}:`, err.message);
    return null;
  }
}

/**
 * Create a new investor item on the Investor List board.
 */
async function createInvestor(investor) {
  try {
    const columnValues = {};

    if (investor.phone) {
      // Strip non-digits for clean phone value
      const digitsOnly = investor.phone.replace(/\D/g, '');
      columnValues[investorCols.phone] = {
        phone: digitsOnly,
        countryShortName: 'US',
      };
    }

    if (investor.email) {
      columnValues[investorCols.email] = {
        email: investor.email,
        text: investor.email,
      };
    }

    if (investor.company) {
      columnValues[investorCols.company] = investor.company;
    }

    if (investor.notes) {
      columnValues[investorCols.notes] = {
        text: investor.notes,
      };
    }

    if (investor.nextFollowUp) {
      columnValues[investorCols.nextFollowUp] = {
        date: investor.nextFollowUp,
      };
    }

    console.log(`[monday/mutations] createInvestor: name="${investor.name}" cols=${JSON.stringify(columnValues)}`);

    const data = await mondayApi(CREATE_ITEM, {
      boardId: INVESTOR_LIST_BOARD_ID,
      groupId: config.monday.groups.coldNewLeads,
      itemName: investor.name,
      columnValues: JSON.stringify(columnValues),
    });

    if (data && data.create_item) {
      const newItem = data.create_item;
      console.log(`[monday/mutations] createInvestor succeeded: id=${newItem.id} name="${newItem.name}"`);
      return {
        id: newItem.id,
        name: newItem.name,
        link: config.monday.boardUrl + newItem.id,
      };
    }
    return null;
  } catch (err) {
    console.error(`[monday/mutations] createInvestor FAILED:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Relationship Management board — WRITE follow-up activity
// ---------------------------------------------------------------------------

/**
 * Create a follow-up activity item on the Relationship Management board.
 *
 * @param {Object} opts
 * @param {string} opts.investorName      - Investor name (item name)
 * @param {string} [opts.investorStatus]  - Status label (e.g. "🔥 Hot Lead")
 * @param {string} [opts.cadence]         - Follow-up cadence label
 * @param {string} [opts.lastContactDate] - YYYY-MM-DD
 * @param {string} [opts.nextFollowUp]    - YYYY-MM-DD
 * @param {string} [opts.commMethod]      - Communication method label
 * @param {string} [opts.email]           - Investor email
 * @param {string} [opts.phone]           - Investor phone
 * @param {string} [opts.notes]           - Notes text
 * @param {number} [opts.linkedInvestorId]- Item ID from Investor List to link
 * @param {number} [opts.personId]        - Monday.com user ID to assign
 * @returns {Promise<{id: string, name: string, link: string}|null>}
 */
async function createFollowUpActivity(opts) {
  try {
    const columnValues = {};
    const today = new Date().toISOString().split('T')[0];

    if (opts.investorStatus) {
      columnValues[rmCols.investorStatus] = { label: opts.investorStatus };
    }
    if (opts.cadence) {
      columnValues[rmCols.followUpCadence] = { label: opts.cadence };
    }
    if (opts.lastContactDate) {
      columnValues[rmCols.lastContactDate] = { date: opts.lastContactDate };
    }
    if (opts.nextFollowUp) {
      columnValues[rmCols.nextFollowUp] = { date: opts.nextFollowUp };
    }
    if (opts.commMethod) {
      columnValues[rmCols.communicationMethod] = { label: opts.commMethod };
    }
    if (opts.email) {
      columnValues[rmCols.email] = { email: opts.email, text: opts.email };
    }
    if (opts.phone) {
      columnValues[rmCols.phone] = { phone: opts.phone, countryShortName: 'US' };
    }
    if (opts.notes) {
      columnValues[rmCols.notes] = { text: opts.notes };
    }
    if (opts.linkedInvestorId) {
      columnValues[rmCols.linkedInvestor] = { item_ids: [Number(opts.linkedInvestorId)] };
    }
    if (opts.personId) {
      columnValues[rmCols.person] = {
        personsAndTeams: [{ id: Number(opts.personId), kind: 'person' }],
      };
    }
    // Set the date column to today
    columnValues[rmCols.date] = { date: today };

    console.log(`[monday/mutations] createFollowUpActivity: name="${opts.investorName}" cols=${JSON.stringify(columnValues)}`);

    const data = await mondayApi(CREATE_ITEM, {
      boardId: RM_BOARD_ID,
      groupId: config.monday.rmGroups.activeFollowUps,
      itemName: opts.investorName,
      columnValues: JSON.stringify(columnValues),
    });

    if (data && data.create_item) {
      const newItem = data.create_item;
      console.log(`[monday/mutations] createFollowUpActivity succeeded: id=${newItem.id}`);
      return {
        id: newItem.id,
        name: newItem.name,
        link: config.monday.rmBoardUrl + newItem.id,
      };
    }
    return null;
  } catch (err) {
    console.error(`[monday/mutations] createFollowUpActivity FAILED:`, err.message);
    return null;
  }
}

/**
 * Move a follow-up item to the Completed group on the Relationship Management board.
 */
async function completeFollowUp(itemId) {
  try {
    console.log(`[monday/mutations] completeFollowUp: item=${itemId}`);
    const data = await mondayApi(MOVE_ITEM_TO_GROUP, {
      itemId: String(itemId),
      groupId: config.monday.rmGroups.completedFollowUps,
    });
    console.log(`[monday/mutations] completeFollowUp succeeded for item ${itemId}`);
    return data;
  } catch (err) {
    console.error(`[monday/mutations] completeFollowUp FAILED for item ${itemId}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Communications Log board — LOG communications
// ---------------------------------------------------------------------------

/**
 * Log a communication to the Investor Communications Log board.
 *
 * @param {Object} opts
 * @param {string} opts.name              - Item name (e.g. "Follow-up: John Doe")
 * @param {string} [opts.commType]        - Communication Type label
 * @param {string} [opts.dealSPV]         - Deal / SPV text
 * @param {string} [opts.dateSent]        - YYYY-MM-DD
 * @param {string} [opts.sendStatus]      - Send Status label (defaults to "Sent")
 * @param {number} [opts.sentByPersonId]  - Monday.com user ID
 * @param {string} [opts.notes]           - Notes text
 * @param {string} [opts.groupId]         - Group ID (defaults to adHocCommunications)
 * @returns {Promise<{id: string, name: string}|null>}
 */
async function logCommunication(opts) {
  try {
    const columnValues = {};
    const today = new Date().toISOString().split('T')[0];

    if (opts.commType) {
      columnValues[commsCols.communicationType] = { label: opts.commType };
    }
    if (opts.dealSPV) {
      columnValues[commsCols.dealSPV] = opts.dealSPV;
    }
    columnValues[commsCols.dateSent] = { date: opts.dateSent || today };
    columnValues[commsCols.sendStatus] = { label: opts.sendStatus || 'Sent' };

    if (opts.sentByPersonId) {
      columnValues[commsCols.sentBy] = {
        personsAndTeams: [{ id: Number(opts.sentByPersonId), kind: 'person' }],
      };
    }
    if (opts.notes) {
      columnValues[commsCols.notes] = { text: opts.notes };
    }

    const groupId = opts.groupId || config.monday.commsGroups.adHocCommunications;

    console.log(`[monday/mutations] logCommunication: name="${opts.name}" group=${groupId}`);

    const data = await mondayApi(CREATE_ITEM, {
      boardId: COMMS_LOG_BOARD_ID,
      groupId,
      itemName: opts.name,
      columnValues: JSON.stringify(columnValues),
    });

    if (data && data.create_item) {
      const newItem = data.create_item;
      console.log(`[monday/mutations] logCommunication succeeded: id=${newItem.id}`);
      return { id: newItem.id, name: newItem.name };
    }
    return null;
  } catch (err) {
    console.error(`[monday/mutations] logCommunication FAILED:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Diagnostic test
// ---------------------------------------------------------------------------

/**
 * Diagnostic test: attempts a minimal write to the Relationship Management board.
 */
async function testMondayWrite(testItemId) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  console.log('[monday/mutations] TEST WRITE starting...');

  // Test 1: Read from Investor List board
  console.log(`[monday/mutations] TEST READ: board=${INVESTOR_LIST_BOARD_ID} item=${testItemId}`);
  try {
    const readValues = JSON.stringify({
      [investorCols.lastContactDate]: { date: dateStr },
    });
    const readData = await mondayApi(CHANGE_MULTIPLE_VALUES, {
      boardId: INVESTOR_LIST_BOARD_ID,
      itemId: String(testItemId),
      columnValues: readValues,
    });
    console.log('[monday/mutations] TEST READ WRITE succeeded:', JSON.stringify(readData));
  } catch (err) {
    console.error('[monday/mutations] TEST Investor List write FAILED:', err.message);
    return { success: false, error: `Investor List write failed: ${err.message}` };
  }

  // Test 2: Create item on Relationship Management board
  console.log(`[monday/mutations] TEST CREATE on RM board=${RM_BOARD_ID}`);
  try {
    const rmColumnValues = JSON.stringify({
      [rmCols.investorStatus]: { label: '🔵 Cold / New' },
      [rmCols.lastContactDate]: { date: dateStr },
      [rmCols.nextFollowUp]: { date: dateStr },
      [rmCols.notes]: { text: 'API test — this item can be deleted.' },
    });

    const createData = await mondayApi(CREATE_ITEM, {
      boardId: RM_BOARD_ID,
      groupId: config.monday.rmGroups.activeFollowUps,
      itemName: '[TEST] API Write Test',
      columnValues: rmColumnValues,
    });

    if (createData && createData.create_item) {
      const newId = createData.create_item.id;
      console.log(`[monday/mutations] TEST CREATE succeeded: id=${newId}`);
      return { success: true, data: createData, testItemId: newId };
    }
    return { success: false, error: 'Create returned no data' };
  } catch (err) {
    console.error('[monday/mutations] TEST RM write FAILED:', err.message);
    return { success: false, error: `RM board write failed: ${err.message}` };
  }
}

/**
 * Delete a test item (used after testMondayWrite to clean up).
 */
async function deleteItem(itemId) {
  try {
    const data = await mondayApi(
      'mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }',
      { itemId: String(itemId) }
    );
    console.log(`[monday/mutations] deleteItem succeeded: ${itemId}`);
    return data;
  } catch (err) {
    console.error(`[monday/mutations] deleteItem FAILED: ${itemId}`, err.message);
    return null;
  }
}

module.exports = {
  updateColumnValue,
  updateNextFollowUp,
  updateLastContactDate,
  updateItemName,
  addGoingColdFlag,
  removeGoingColdFlag,
  testMondayWrite,
  updateAssignedTo,
  createInvestor,
  createFollowUpActivity,
  completeFollowUp,
  logCommunication,
  deleteItem,
};
