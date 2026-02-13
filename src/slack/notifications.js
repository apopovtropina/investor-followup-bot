// ---------------------------------------------------------------------------
// Slack DM notifications — sends direct messages to assigned team members
// ---------------------------------------------------------------------------

const { escapeSlackMrkdwn } = require('../utils/helpers');

/**
 * Send a DM to a Slack user notifying them of a follow-up assignment.
 * Falls back to tagging them in the channel if DM fails (e.g. missing im:write scope).
 *
 * @param {import('@slack/web-api').WebClient} slackClient
 * @param {Object} opts
 * @param {string} opts.slackUserId   - Slack user ID to DM
 * @param {string} opts.investorName  - Investor name
 * @param {string} opts.dateStr       - Human-readable date string
 * @param {string} opts.mondayLink    - Monday.com item link
 * @param {string} [opts.channelId]   - Fallback channel ID for in-channel mention
 * @param {string} [opts.assignedBy]  - Slack user ID of the person who assigned
 * @returns {Promise<{dmSent: boolean, channelFallback: boolean}>}
 */
async function notifyAssignment(slackClient, {
  slackUserId,
  investorName,
  dateStr,
  mondayLink,
  channelId,
  assignedBy,
}) {
  const safeName = escapeSlackMrkdwn(investorName);
  const assignedByMention = assignedBy ? `<@${assignedBy}>` : 'the team';

  const dmMessage =
    `Hey! :wave: You've been assigned to follow up with *${safeName}*` +
    (dateStr ? ` by *${dateStr}*` : '') +
    `. Assigned by ${assignedByMention}.` +
    `\n:point_right: <${mondayLink}|Open in Monday.com>`;

  // Try DM first
  try {
    const openResult = await slackClient.conversations.open({
      users: slackUserId,
    });

    if (openResult.channel && openResult.channel.id) {
      await slackClient.chat.postMessage({
        channel: openResult.channel.id,
        text: dmMessage,
      });
      console.log(`[notifications] DM sent to <@${slackUserId}> about ${investorName}`);
      return { dmSent: true, channelFallback: false };
    }
  } catch (dmErr) {
    const errCode = dmErr.data?.error || dmErr.message;
    console.warn(`[notifications] Could not DM <@${slackUserId}>: ${errCode}`);

    // Common reasons: missing im:write scope, user has DMs disabled, etc.
    if (errCode === 'missing_scope' || errCode === 'not_allowed_token_type') {
      console.warn('[notifications] Bot may be missing im:write scope. Falling back to channel mention.');
    }
  }

  // Fallback: tag them in the channel
  if (channelId) {
    try {
      const channelMessage =
        `<@${slackUserId}> :mega: You've been assigned to follow up with *${safeName}*` +
        (dateStr ? ` by *${dateStr}*` : '') +
        `. :point_right: <${mondayLink}|Open in Monday.com>`;

      await slackClient.chat.postMessage({
        channel: channelId,
        text: channelMessage,
      });
      console.log(`[notifications] Channel mention sent for <@${slackUserId}> about ${investorName}`);
      return { dmSent: false, channelFallback: true };
    } catch (channelErr) {
      console.error(`[notifications] Channel fallback also failed:`, channelErr.message);
    }
  }

  return { dmSent: false, channelFallback: false };
}

module.exports = { notifyAssignment };
