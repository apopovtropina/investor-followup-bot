// ---------------------------------------------------------------------------
// Slack command handlers — registered via app.message() listeners
// ---------------------------------------------------------------------------

const config = require('../config');
const { getActiveInvestors } = require('../monday/queries');
const {
  updateNextFollowUp,
  updateLastContactDate,
  removeGoingColdFlag,
} = require('../monday/mutations');
const { findBestMatch } = require('../utils/nameMatch');
const { escapeSlackMrkdwn } = require('../utils/helpers');
const { parseNaturalDate } = require('../utils/dateParser');
const { addReminder } = require('../reminders/store');
const messages = require('./messages');

// ---------------------------------------------------------------------------
// Channel ID — use hardcoded ID from config, fall back to API lookup
// ---------------------------------------------------------------------------

let channelId = config.slack.channelId || null;

async function getChannelId(client) {
  if (channelId) return channelId;

  try {
    let cursor;
    do {
      const result = await client.conversations.list({
        types: 'public_channel,private_channel',
        limit: 200,
        cursor,
      });

      const match = result.channels.find(
        (ch) => ch.name === config.slack.channel
      );
      if (match) {
        channelId = match.id;
        console.log(`[slack/commands] Resolved channel #${config.slack.channel} -> ${channelId}`);
        return channelId;
      }

      cursor = result.response_metadata && result.response_metadata.next_cursor;
    } while (cursor);
  } catch (err) {
    console.error('[slack/commands] Failed to look up channel ID:', err.message);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateReadable(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

/**
 * Determine if a message should be processed by this bot.
 * Only respond in the configured channel and ignore bot messages.
 */
function shouldProcess(message) {
  // Ignore bot messages
  if (message.bot_id || message.subtype) return false;
  return true;
}

async function isCorrectChannel(message, client) {
  const targetId = await getChannelId(client);
  if (!targetId) return false;
  return message.channel === targetId;
}

/**
 * Resolve an investor name from message text using fuzzy matching.
 * Returns { investor, error } where error is a string to reply with if matching failed.
 */
async function resolveInvestor(searchName, say) {
  let investors;
  try {
    investors = await getActiveInvestors();
  } catch (err) {
    return { investor: null, error: 'Sorry, I could not reach Monday.com right now. Please try again in a moment.' };
  }

  if (!investors || investors.length === 0) {
    return { investor: null, error: 'No active investors found in Monday.com.' };
  }

  const result = findBestMatch(searchName, investors);

  if (!result) {
    return {
      investor: null,
      error: `I couldn't find an investor matching "${escapeSlackMrkdwn(searchName)}". Please check the spelling and try again.`,
    };
  }

  // Fuse.js: 0 = perfect match, 1 = no match. Reject poor matches.
  if (result.score > 0.35) {
    return {
      investor: null,
      error: `I couldn't find a close match for "${escapeSlackMrkdwn(searchName)}". Did you mean one of these?\n${investors
        .slice(0, 5)
        .map((i) => `\u2022 ${i.name}`)
        .join('\n')}`,
    };
  }

  return { investor: result.match, error: null };
}

/**
 * Look up a Slack team member by display name from the users list.
 */
async function findSlackUserByName(client, name) {
  try {
    const lowerName = name.toLowerCase().trim();
    let cursor;

    do {
      const result = await client.users.list({ limit: 200, cursor });

      for (const user of result.members) {
        if (user.deleted || user.is_bot) continue;

        const displayName = (user.profile.display_name || '').toLowerCase();
        const realName = (user.real_name || '').toLowerCase();
        const firstName = realName.split(' ')[0];

        if (
          displayName === lowerName ||
          realName === lowerName ||
          firstName === lowerName
        ) {
          return user;
        }
      }

      cursor = result.response_metadata && result.response_metadata.next_cursor;
    } while (cursor);
  } catch (err) {
    console.error('[slack/commands] findSlackUserByName failed:', err.message);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Register all command listeners
// ---------------------------------------------------------------------------

function registerCommands(app) {
  // -------------------------------------------------------------------
  // 0. CATCH-ALL MESSAGE LOGGER — logs every incoming message event
  //    This MUST be registered first so we can diagnose event delivery.
  // -------------------------------------------------------------------
  app.message(async ({ message, client }) => {
    const text = message.text || '(no text)';
    const user = message.user || message.bot_id || 'unknown';
    const channel = message.channel || 'unknown';
    const subtype = message.subtype || 'none';
    console.log(`[slack/messages] Received message: "${text}" from=${user} channel=${channel} subtype=${subtype}`);
  });

  // -------------------------------------------------------------------
  // 1. Schedule follow-up
  //    "follow up [Name] tomorrow at 2pm"
  //    "add [Name] for follow-up on Friday"
  // -------------------------------------------------------------------
  const followUpPattern =
    /follow\s*up\s+(.+?)\s+(tomorrow|today|next\s+\w+|on\s+.+?|in\s+.+?|(?:at\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday).*)$/i;
  const addFollowUpPattern =
    /add\s+(.+?)\s+for\s+follow[- ]?up\s+(?:on\s+)?(.+)$/i;

  app.message(followUpPattern, async ({ message, context, client, say }) => {
    if (!shouldProcess(message)) return;
    if (!(await isCorrectChannel(message, client))) return;

    const matches = message.text.match(followUpPattern);
    if (!matches) return;

    const searchName = matches[1].trim();
    const dateExpression = matches[2].trim();

    await handleScheduleFollowUp(searchName, dateExpression, message, client, say);
  });

  app.message(addFollowUpPattern, async ({ message, context, client, say }) => {
    if (!shouldProcess(message)) return;
    if (!(await isCorrectChannel(message, client))) return;

    const matches = message.text.match(addFollowUpPattern);
    if (!matches) return;

    const searchName = matches[1].trim();
    const dateExpression = matches[2].trim();

    await handleScheduleFollowUp(searchName, dateExpression, message, client, say);
  });

  async function handleScheduleFollowUp(searchName, dateExpression, message, client, say) {
    try {
      // Resolve investor
      const { investor, error } = await resolveInvestor(searchName);
      if (error) {
        await say(error);
        return;
      }

      // Parse date
      const parsedDate = parseNaturalDate(dateExpression);
      if (!parsedDate) {
        await say(`I couldn't understand the date "${escapeSlackMrkdwn(dateExpression)}". Try something like "tomorrow", "next Tuesday", or "on March 15".`);
        return;
      }

      const dateStr = formatDateYMD(parsedDate);

      // Update Monday.com
      const result = await updateNextFollowUp(investor.id, dateStr);
      if (!result) {
        await say('Sorry, I could not update Monday.com. Please try again or update it manually.');
        return;
      }

      // Store reminder
      try {
        const userInfo = await client.users.info({ user: message.user });
        const email = userInfo.user.profile.email || null;

        addReminder({
          itemId: investor.id,
          investorName: investor.name,
          scheduledAt: parsedDate,
          slackUserId: message.user,
          userEmail: email,
        });
      } catch (reminderErr) {
        console.error('[slack/commands] Failed to store reminder:', reminderErr.message);
        // Non-fatal: still confirm the follow-up was set
      }

      await say(
        `:white_check_mark: Got it! Follow-up with *${escapeSlackMrkdwn(investor.name)}* scheduled for *${formatDateReadable(parsedDate)}* (${dateStr}).\nMonday.com has been updated. <${investor.link}|Open in Monday>`
      );
    } catch (err) {
      console.error('[slack/commands] handleScheduleFollowUp error:', err.message);
      await say('Something went wrong while scheduling the follow-up. Please try again.');
    }
  }

  // -------------------------------------------------------------------
  // 2. Team member follow-up
  //    "Sarah follow up John Smith tomorrow"
  // -------------------------------------------------------------------
  const teamFollowUpPattern =
    /^(\w+)\s+follow\s*up\s+(.+?)\s+(tomorrow|today|next\s+\w+|on\s+.+?|in\s+.+?)$/i;

  app.message(teamFollowUpPattern, async ({ message, context, client, say }) => {
    if (!shouldProcess(message)) return;
    if (!(await isCorrectChannel(message, client))) return;

    const matches = message.text.match(teamFollowUpPattern);
    if (!matches) return;

    const teamMemberName = matches[1].trim();
    const searchName = matches[2].trim();
    const dateExpression = matches[3].trim();

    try {
      // Find the team member in Slack
      const teamMember = await findSlackUserByName(client, teamMemberName);
      if (!teamMember) {
        await say(`I couldn't find a team member named "${escapeSlackMrkdwn(teamMemberName)}" in Slack. Please check the name and try again.`);
        return;
      }

      // Resolve investor
      const { investor, error } = await resolveInvestor(searchName);
      if (error) {
        await say(error);
        return;
      }

      // Parse date
      const parsedDate = parseNaturalDate(dateExpression);
      if (!parsedDate) {
        await say(`I couldn't understand the date "${escapeSlackMrkdwn(dateExpression)}". Try something like "tomorrow", "next Tuesday", or "on March 15".`);
        return;
      }

      const dateStr = formatDateYMD(parsedDate);

      // Update Monday.com
      const result = await updateNextFollowUp(investor.id, dateStr);
      if (!result) {
        await say('Sorry, I could not update Monday.com. Please try again or update it manually.');
        return;
      }

      // Store reminder for the team member
      const email = teamMember.profile.email || null;
      addReminder({
        itemId: investor.id,
        investorName: investor.name,
        scheduledAt: parsedDate,
        slackUserId: teamMember.id,
        userEmail: email,
      });

      await say(
        `:white_check_mark: Follow-up with *${escapeSlackMrkdwn(investor.name)}* assigned to <@${teamMember.id}> for *${formatDateReadable(parsedDate)}* (${dateStr}).\nMonday.com has been updated. <${investor.link}|Open in Monday>`
      );
    } catch (err) {
      console.error('[slack/commands] team follow-up error:', err.message);
      await say('Something went wrong while scheduling the team follow-up. Please try again.');
    }
  });

  // -------------------------------------------------------------------
  // 3. Log touchpoint
  //    "contacted John Smith today"
  //    "spoke with Jane Doe"
  //    "reached out to Mike Johnson"
  // -------------------------------------------------------------------
  const touchpointPattern =
    /(?:contacted|spoke\s+with|reached\s+out\s+to)\s+(.+?)(?:\s+today)?$/i;

  app.message(touchpointPattern, async ({ message, context, client, say }) => {
    if (!shouldProcess(message)) return;
    if (!(await isCorrectChannel(message, client))) return;

    const matches = message.text.match(touchpointPattern);
    if (!matches) return;

    const searchName = matches[1].trim();

    try {
      // Resolve investor
      const { investor, error } = await resolveInvestor(searchName);
      if (error) {
        await say(error);
        return;
      }

      const today = new Date();
      const todayStr = formatDateYMD(today);

      // Update Last Contact Date
      const contactResult = await updateLastContactDate(investor.id, todayStr);
      if (!contactResult) {
        await say('Sorry, I could not update Monday.com. Please try again or update it manually.');
        return;
      }

      // Auto-calculate Next Follow-Up based on status cadence
      let nextDateStr = null;
      const tier = config.cadence[investor.status];
      if (tier) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + tier.autoNextDays);
        nextDateStr = formatDateYMD(nextDate);
        await updateNextFollowUp(investor.id, nextDateStr);
      }

      // Remove going cold flag if present
      if (investor.name.startsWith('\uD83D\uDD34')) {
        await removeGoingColdFlag(investor.id, investor.name);
      }

      let confirmMsg =
        `:white_check_mark: Logged touchpoint for *${escapeSlackMrkdwn(investor.name)}* \u2014 Last Contact Date set to today (${todayStr}).`;
      if (nextDateStr) {
        confirmMsg += `\nNext follow-up auto-set to *${nextDateStr}* based on ${investor.status} cadence.`;
      }
      confirmMsg += `\n<${investor.link}|Open in Monday>`;

      await say(confirmMsg);
    } catch (err) {
      console.error('[slack/commands] touchpoint logging error:', err.message);
      await say('Something went wrong while logging the touchpoint. Please try again.');
    }
  });

  // -------------------------------------------------------------------
  // 4. Who's overdue
  //    "who's overdue" / "overdue investors"
  // -------------------------------------------------------------------
  const overduePattern = /(?:who'?s?\s+overdue|overdue\s+investors)/i;

  app.message(overduePattern, async ({ message, context, client, say }) => {
    if (!shouldProcess(message)) return;
    if (!(await isCorrectChannel(message, client))) return;

    try {
      const investors = await getActiveInvestors();
      if (!investors || investors.length === 0) {
        await say('No active investors found in Monday.com.');
        return;
      }

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const overdue = investors.filter((inv) => {
        if (!inv.nextFollowUp) return false;
        const followUp = new Date(inv.nextFollowUp);
        followUp.setHours(0, 0, 0, 0);
        return followUp < now;
      });

      await say(messages.formatOverdueList(overdue));
    } catch (err) {
      console.error('[slack/commands] overdue query error:', err.message);
      await say('Something went wrong while checking overdue investors. Please try again.');
    }
  });

  // -------------------------------------------------------------------
  // 5. Investor status check
  //    "status on John Smith" / "check on Jane Doe"
  // -------------------------------------------------------------------
  const statusPattern = /(?:status\s+on|check\s+on)\s+(.+)/i;

  app.message(statusPattern, async ({ message, context, client, say }) => {
    if (!shouldProcess(message)) return;
    if (!(await isCorrectChannel(message, client))) return;

    const matches = message.text.match(statusPattern);
    if (!matches) return;

    const searchName = matches[1].trim();

    try {
      const { investor, error } = await resolveInvestor(searchName);
      if (error) {
        await say(error);
        return;
      }

      await say(messages.formatInvestorStatus(investor));
    } catch (err) {
      console.error('[slack/commands] status check error:', err.message);
      await say('Something went wrong while looking up the investor. Please try again.');
    }
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = { registerCommands };
