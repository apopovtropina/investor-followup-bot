// ---------------------------------------------------------------------------
// Webhook handler — processes Monday.com status-change webhooks and sends
// follow-up Slack notifications for BOTH boards:
//   1. Relationship Management board → Investor Status column (urgent only)
//   2. Investor List board → Communication Status column (any change + urgent)
// ---------------------------------------------------------------------------

const config = require('../config');
const { mondayApi } = require('../monday/client');

const rmCols = config.monday.rmColumns;
const ilCols = config.monday.columns; // Investor List columns
const rmBoard = config.mondayBoards.relationshipManagement;
const ilBoard = config.mondayBoards.investorList;

const URGENT_LABEL_ID = 2; // "Urgent Follow-Up Needed" on both boards
const FOLLOWUP_CHANNEL = 'C0ADB93MTLP'; // #monday-investor-followups

// ---------------------------------------------------------------------------
// Fetch a single item by ID (works for any board)
// ---------------------------------------------------------------------------

async function fetchItem(itemId) {
  const query = `
    query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        name
        column_values {
          id
          text
          value
        }
      }
    }
  `;
  const data = await mondayApi(query, { ids: [String(itemId)] });
  const items = data.items || [];
  return items[0] || null;
}

// ---------------------------------------------------------------------------
// Fetch linked investor data from Investor List board (for RM board items)
// ---------------------------------------------------------------------------

async function fetchLinkedInvestor(rmItem) {
  const relationCol = rmItem.column_values.find(
    (c) => c.id === rmCols.linkedInvestor
  );
  if (!relationCol || !relationCol.value) return null;

  let parsed;
  try {
    parsed = JSON.parse(relationCol.value);
  } catch {
    return null;
  }

  const linkedIds = parsed.linkedPulseIds || [];
  if (linkedIds.length === 0) return null;

  const linkedItemId = linkedIds[0].linkedPulseId;
  if (!linkedItemId) return null;

  return fetchItem(linkedItemId);
}

// ---------------------------------------------------------------------------
// Resolve Monday.com person/people column to display names
// ---------------------------------------------------------------------------

async function resolvePersonNames(columnValues, colId) {
  const col = columnValues.find((c) => c.id === colId);
  if (!col || !col.value) return '';

  let parsed;
  try {
    parsed = JSON.parse(col.value);
  } catch {
    return col.text || '';
  }

  // people column value format: { "personsAndTeams": [{ "id": 12345, "kind": "person" }] }
  const persons = parsed.personsAndTeams || [];
  if (persons.length === 0) return col.text || '';

  const userIds = persons
    .filter((p) => p.kind === 'person')
    .map((p) => p.id);

  if (userIds.length === 0) return col.text || '';

  try {
    const query = `
      query ($ids: [ID!]) {
        users(ids: $ids) {
          id
          name
        }
      }
    `;
    const data = await mondayApi(query, { ids: userIds.map(String) });
    const users = data.users || [];
    return users.map((u) => u.name).join(', ') || col.text || '';
  } catch {
    return col.text || '';
  }
}

// ---------------------------------------------------------------------------
// Parse column helpers
// ---------------------------------------------------------------------------

function getTextValue(columnValues, colId) {
  const col = columnValues.find((c) => c.id === colId);
  return col ? (col.text || '').trim() : '';
}

function getEmailValue(columnValues, colId) {
  const col = columnValues.find((c) => c.id === colId);
  if (!col) return '';
  if (col.value) {
    try {
      const parsed = JSON.parse(col.value);
      return parsed.email || col.text || '';
    } catch { /* fall through */ }
  }
  return col.text || '';
}

function getPhoneValue(columnValues, colId) {
  const col = columnValues.find((c) => c.id === colId);
  if (!col) return '';
  if (col.value) {
    try {
      const parsed = JSON.parse(col.value);
      return parsed.phone || col.text || '';
    } catch { /* fall through */ }
  }
  return col.text || '';
}

function getLongText(columnValues, colId) {
  const col = columnValues.find((c) => c.id === colId);
  if (!col) return '';
  if (col.value) {
    try {
      const parsed = JSON.parse(col.value);
      return (parsed.text || '').trim();
    } catch { /* fall through */ }
  }
  return (col.text || '').trim();
}

// ---------------------------------------------------------------------------
// Get the label text from a webhook event's newValue
// ---------------------------------------------------------------------------

function getLabelFromValue(newValue) {
  if (!newValue || !newValue.label) return { id: null, text: null };
  return {
    id: newValue.label.index !== undefined ? newValue.label.index : null,
    text: newValue.label.text || null,
  };
}

// ===========================================================================
// MESSAGE BUILDERS
// ===========================================================================

// ---------------------------------------------------------------------------
// RM Board: 🚨 Urgent Follow-Up (existing behavior)
// ---------------------------------------------------------------------------

function buildRMUrgentMessage(rmItem, linkedInvestor) {
  const itemName = rmItem.name;
  const cv = rmItem.column_values;

  const lastContact = getTextValue(cv, rmCols.lastContactDate) || '\u2014';
  const nextFollowUp = getTextValue(cv, rmCols.nextFollowUp) || '\u2014';
  const notes = getLongText(cv, rmCols.notes) || '\u2014';

  let email = '\u2014';
  let phone = '\u2014';
  if (linkedInvestor) {
    email = getEmailValue(linkedInvestor.column_values, ilCols.email) || '\u2014';
    phone = getPhoneValue(linkedInvestor.column_values, ilCols.phone) || '\u2014';
  }

  const boardLink = rmBoard.boardUrl + rmItem.id;

  return (
    `\ud83d\udea8 *URGENT FOLLOW-UP NEEDED*\n` +
    `*Investor:* ${itemName}\n` +
    `*Last Contact:* ${lastContact}\n` +
    `*Next Follow-Up:* ${nextFollowUp}\n` +
    `*Notes:* ${notes}\n` +
    `*Email:* ${email}\n` +
    `*Phone:* ${phone}\n` +
    `\n\ud83d\udd17 <${boardLink}|Open in Monday.com>`
  );
}

// ---------------------------------------------------------------------------
// IL Board: 📣 Communication Status Updated (general — any status change)
// ---------------------------------------------------------------------------

function buildILStatusUpdateMessage(ilItem, newStatusText, assignedToNames) {
  const itemName = ilItem.name;
  const cv = ilItem.column_values;

  const email = getEmailValue(cv, ilCols.email) || '\u2014';
  const phone = getPhoneValue(cv, ilCols.phone) || '\u2014';
  const notes = getLongText(cv, ilCols.notes) || '\u2014';
  const assigned = assignedToNames || '\u2014';

  const boardLink = ilBoard.boardUrl + ilItem.id;

  return (
    `\ud83d\udce3 *Communication Status Updated*\n` +
    `*Investor:* ${itemName}\n` +
    `*New Status:* ${newStatusText}\n` +
    `*Email:* ${email}\n` +
    `*Phone:* ${phone}\n` +
    `*Assigned To:* ${assigned}\n` +
    `*Notes:* ${notes}\n` +
    `\n\ud83d\udd17 <${boardLink}|Open in Monday.com>`
  );
}

// ---------------------------------------------------------------------------
// IL Board: 🚨 Urgent Follow-Up Needed (when status = urgent)
// ---------------------------------------------------------------------------

function buildILUrgentMessage(ilItem, assignedToNames) {
  const itemName = ilItem.name;
  const cv = ilItem.column_values;

  const email = getEmailValue(cv, ilCols.email) || '\u2014';
  const phone = getPhoneValue(cv, ilCols.phone) || '\u2014';
  const lastContact = getTextValue(cv, ilCols.lastContactDate) || '\u2014';
  const nextFollowUp = getTextValue(cv, ilCols.nextFollowUp) || '\u2014';
  const notes = getLongText(cv, ilCols.notes) || '\u2014';
  const assigned = assignedToNames || '\u2014';

  const boardLink = ilBoard.boardUrl + ilItem.id;

  return (
    `\ud83d\udea8 *URGENT FOLLOW-UP NEEDED*\n` +
    `*Investor:* ${itemName}\n` +
    `*Email:* ${email}\n` +
    `*Phone:* ${phone}\n` +
    `*Assigned To:* ${assigned}\n` +
    `*Last Contact:* ${lastContact}\n` +
    `*Next Follow-Up:* ${nextFollowUp}\n` +
    `*Notes:* ${notes}\n` +
    `\n\ud83d\udd17 <${boardLink}|Open in Monday.com>`
  );
}

// ===========================================================================
// BOARD-SPECIFIC HANDLERS
// ===========================================================================

// ---------------------------------------------------------------------------
// Handle Relationship Management board → Investor Status (urgent only)
// ---------------------------------------------------------------------------

async function handleRMBoard(event, slackClient) {
  const { itemId, columnId, value: newValue } = event;

  if (columnId !== rmCols.investorStatus) {
    return { notified: false, reason: `RM board: wrong column ${columnId}` };
  }

  const { id: newLabelId } = getLabelFromValue(newValue);

  if (newLabelId !== URGENT_LABEL_ID) {
    console.log(
      `[webhook/handler] RM board: status changed but not urgent (label ID: ${newLabelId}). Skipping.`
    );
    return { notified: false, reason: `RM board: not urgent (label: ${newLabelId})` };
  }

  console.log(`[webhook/handler] \ud83d\udea8 RM board: URGENT status for item ${itemId}. Fetching details...`);

  const rmItem = await fetchItem(itemId);
  if (!rmItem) {
    console.error(`[webhook/handler] Could not fetch RM item ${itemId}`);
    return { notified: false, reason: 'RM item fetch failed' };
  }

  let linkedInvestor = null;
  try {
    linkedInvestor = await fetchLinkedInvestor(rmItem);
    if (linkedInvestor) {
      console.log(`[webhook/handler] Linked investor: ${linkedInvestor.name} (${linkedInvestor.id})`);
    } else {
      console.warn('[webhook/handler] No linked investor found on RM item.');
    }
  } catch (err) {
    console.error('[webhook/handler] Error fetching linked investor:', err.message);
  }

  const message = buildRMUrgentMessage(rmItem, linkedInvestor);

  try {
    await slackClient.chat.postMessage({
      channel: FOLLOWUP_CHANNEL,
      text: message,
      unfurl_links: false,
      unfurl_media: false,
    });
    console.log(`[webhook/handler] \u2705 RM urgent notification sent for: ${rmItem.name}`);
    return { notified: true };
  } catch (slackErr) {
    console.error(`[webhook/handler] Failed to send RM Slack notification: ${slackErr.message}`);
    return { notified: false, reason: `slack error: ${slackErr.message}` };
  }
}

// ---------------------------------------------------------------------------
// Handle Investor List board → Communication Status (any change + urgent)
// ---------------------------------------------------------------------------

async function handleILBoard(event, slackClient) {
  const { itemId, columnId, value: newValue } = event;

  if (columnId !== ilCols.communicationStatus) {
    return { notified: false, reason: `IL board: wrong column ${columnId}` };
  }

  const { id: newLabelId, text: newLabelText } = getLabelFromValue(newValue);

  console.log(
    `[webhook/handler] \ud83d\udce3 IL board: Communication Status changed to "${newLabelText}" (label ID: ${newLabelId}) for item ${itemId}`
  );

  // Fetch the investor item
  const ilItem = await fetchItem(itemId);
  if (!ilItem) {
    console.error(`[webhook/handler] Could not fetch IL item ${itemId}`);
    return { notified: false, reason: 'IL item fetch failed' };
  }

  // Resolve "Assigned To" people column to names
  let assignedToNames = '';
  try {
    assignedToNames = await resolvePersonNames(ilItem.column_values, ilCols.assignedTo);
  } catch (err) {
    console.warn(`[webhook/handler] Could not resolve Assigned To: ${err.message}`);
  }

  // Pick message format: 🚨 for urgent, 📣 for everything else
  const isUrgent = newLabelId === URGENT_LABEL_ID;
  let message;

  if (isUrgent) {
    console.log(`[webhook/handler] \ud83d\udea8 IL board: URGENT status for ${ilItem.name}`);
    message = buildILUrgentMessage(ilItem, assignedToNames);
  } else {
    const statusText = newLabelText || getTextValue(ilItem.column_values, ilCols.communicationStatus) || 'Unknown';
    message = buildILStatusUpdateMessage(ilItem, statusText, assignedToNames);
  }

  try {
    await slackClient.chat.postMessage({
      channel: FOLLOWUP_CHANNEL,
      text: message,
      unfurl_links: false,
      unfurl_media: false,
    });
    const emoji = isUrgent ? '\ud83d\udea8' : '\ud83d\udce3';
    console.log(`[webhook/handler] \u2705 IL ${isUrgent ? 'urgent' : 'status update'} notification sent for: ${ilItem.name}`);
    return { notified: true };
  } catch (slackErr) {
    console.error(`[webhook/handler] Failed to send IL Slack notification: ${slackErr.message}`);
    return { notified: false, reason: `slack error: ${slackErr.message}` };
  }
}

// ===========================================================================
// MAIN ROUTER
// ===========================================================================

/**
 * Process a Monday.com webhook event. Routes to the correct board handler
 * based on the boardId in the event payload.
 *
 * Supported boards:
 *   - Relationship Management (18399401453) → Investor Status column
 *   - Investor List (18399326252) → Communication Status column
 *
 * @param {object} payload - The webhook event payload from Monday.com
 * @param {import('@slack/web-api').WebClient} slackClient - Slack client
 * @returns {Promise<{notified: boolean, reason?: string}>}
 */
async function handleStatusChange(payload, slackClient) {
  const { event } = payload;
  if (!event) {
    return { notified: false, reason: 'no event in payload' };
  }

  const { boardId } = event;
  const boardIdStr = String(boardId);

  // Route to the correct board handler
  if (boardIdStr === String(rmBoard.boardId)) {
    return handleRMBoard(event, slackClient);
  }

  if (boardIdStr === String(ilBoard.boardId)) {
    return handleILBoard(event, slackClient);
  }

  return { notified: false, reason: `unknown board: ${boardId}` };
}

module.exports = { handleStatusChange, FOLLOWUP_CHANNEL };
