// ---------------------------------------------------------------------------
// Webhook handler — processes Monday.com status-change webhooks and sends
// urgent follow-up Slack notifications
// ---------------------------------------------------------------------------

const config = require('../config');
const { mondayApi } = require('../monday/client');

const rmCols = config.monday.rmColumns;
const ilCols = config.monday.columns; // Investor List columns
const rmBoard = config.mondayBoards.relationshipManagement;
const ilBoard = config.mondayBoards.investorList;

const URGENT_LABEL_ID = rmBoard.investorStatusIds.urgentFollowUp; // 2
const URGENT_LABEL_TEXT = rmBoard.investorStatusLabels.urgentFollowUp; // "Urgent Follow-Up Needed"
const FOLLOWUP_CHANNEL = 'C0ADB93MTLP'; // #monday-investor-followups

// ---------------------------------------------------------------------------
// Fetch the full item from Relationship Management board
// ---------------------------------------------------------------------------

async function fetchRMItem(itemId) {
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
// Fetch linked investor data from Investor List board
// ---------------------------------------------------------------------------

async function fetchLinkedInvestor(rmItem) {
  // Get the board_relation column value to find the linked item ID
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

  // board_relation value format: { "linkedPulseIds": [{ "linkedPulseId": 12345 }] }
  const linkedIds = parsed.linkedPulseIds || [];
  if (linkedIds.length === 0) return null;

  const linkedItemId = linkedIds[0].linkedPulseId;
  if (!linkedItemId) return null;

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
  const data = await mondayApi(query, { ids: [String(linkedItemId)] });
  const items = data.items || [];
  return items[0] || null;
}

// ---------------------------------------------------------------------------
// Parse column helpers
// ---------------------------------------------------------------------------

function getTextValue(columnValues, colId) {
  const col = columnValues.find((c) => c.id === colId);
  return col ? (col.text || '').trim() : '';
}

function getEmailFromInvestor(columnValues) {
  const col = columnValues.find((c) => c.id === ilCols.email);
  if (!col) return '';
  if (col.value) {
    try {
      const parsed = JSON.parse(col.value);
      return parsed.email || col.text || '';
    } catch { /* fall through */ }
  }
  return col.text || '';
}

function getPhoneFromInvestor(columnValues) {
  const col = columnValues.find((c) => c.id === ilCols.phone);
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
// Build Slack notification message
// ---------------------------------------------------------------------------

function buildUrgentMessage(rmItem, linkedInvestor) {
  const itemName = rmItem.name;
  const cv = rmItem.column_values;

  const lastContact = getTextValue(cv, rmCols.lastContactDate) || '\u2014';
  const nextFollowUp = getTextValue(cv, rmCols.nextFollowUp) || '\u2014';
  const notes = getLongText(cv, rmCols.notes) || '\u2014';

  // Pull email & phone from linked investor (Investor List board)
  let email = '\u2014';
  let phone = '\u2014';
  if (linkedInvestor) {
    email = getEmailFromInvestor(linkedInvestor.column_values) || '\u2014';
    phone = getPhoneFromInvestor(linkedInvestor.column_values) || '\u2014';
  }

  const boardLink = rmBoard.boardUrl + rmItem.id;

  const message =
    `\ud83d\udea8 *URGENT FOLLOW-UP NEEDED*\n` +
    `*Investor:* ${itemName}\n` +
    `*Last Contact:* ${lastContact}\n` +
    `*Next Follow-Up:* ${nextFollowUp}\n` +
    `*Notes:* ${notes}\n` +
    `*Email:* ${email}\n` +
    `*Phone:* ${phone}\n` +
    `\n\ud83d\udd17 <${boardLink}|Open in Monday.com>`;

  return message;
}

// ---------------------------------------------------------------------------
// Main handler — called when a webhook event arrives
// ---------------------------------------------------------------------------

/**
 * Process a Monday.com webhook event for status changes on the
 * Relationship Management board's Investor Status column.
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

  const {
    boardId,
    itemId,
    columnId,
    value: newValue,
    previousValue,
  } = event;

  // Guard: only process events from the correct board + column
  if (String(boardId) !== String(rmBoard.boardId)) {
    return { notified: false, reason: `wrong board: ${boardId}` };
  }
  if (columnId !== rmCols.investorStatus) {
    return { notified: false, reason: `wrong column: ${columnId}` };
  }

  // Check if the new status is "Urgent Follow-Up Needed" (label index 2)
  let newLabelId = null;
  if (newValue && newValue.label && newValue.label.index !== undefined) {
    newLabelId = newValue.label.index;
  }

  if (newLabelId !== URGENT_LABEL_ID) {
    console.log(
      `[webhook/handler] Status changed but not urgent (label ID: ${newLabelId}). Skipping.`
    );
    return { notified: false, reason: `not urgent status (label: ${newLabelId})` };
  }

  console.log(
    `[webhook/handler] \ud83d\udea8 URGENT status detected for item ${itemId}. Fetching details...`
  );

  // Fetch the full item from Relationship Management board
  const rmItem = await fetchRMItem(itemId);
  if (!rmItem) {
    console.error(`[webhook/handler] Could not fetch item ${itemId} from Monday.com`);
    return { notified: false, reason: 'item fetch failed' };
  }

  // Fetch linked investor data
  let linkedInvestor = null;
  try {
    linkedInvestor = await fetchLinkedInvestor(rmItem);
    if (linkedInvestor) {
      console.log(
        `[webhook/handler] Linked investor: ${linkedInvestor.name} (${linkedInvestor.id})`
      );
    } else {
      console.warn('[webhook/handler] No linked investor found on the item.');
    }
  } catch (err) {
    console.error('[webhook/handler] Error fetching linked investor:', err.message);
  }

  // Build and send Slack message
  const message = buildUrgentMessage(rmItem, linkedInvestor);

  try {
    await slackClient.chat.postMessage({
      channel: FOLLOWUP_CHANNEL,
      text: message,
      unfurl_links: false,
      unfurl_media: false,
    });
    console.log(
      `[webhook/handler] \u2705 Urgent follow-up notification sent to #monday-investor-followups for: ${rmItem.name}`
    );
    return { notified: true };
  } catch (slackErr) {
    console.error(
      `[webhook/handler] Failed to send Slack notification: ${slackErr.message}`
    );
    return { notified: false, reason: `slack error: ${slackErr.message}` };
  }
}

module.exports = { handleStatusChange, FOLLOWUP_CHANNEL };
