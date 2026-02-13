// ---------------------------------------------------------------------------
// Slack command handlers — NLU-powered with regex fallback
// ---------------------------------------------------------------------------
// Messages flow through this pipeline:
//   1. Fast regex matching for well-known commands (zero latency)
//   2. If no regex match → Anthropic NLU intent parsing (conversational)
//   3. Route parsed intent to the appropriate handler
// ---------------------------------------------------------------------------

const config = require('../config');
const { getActiveInvestors } = require('../monday/queries');
const {
  updateNextFollowUp,
  updateLastContactDate,
  removeGoingColdFlag,
  testMondayWrite,
  updateAssignedTo,
} = require('../monday/mutations');
const { findBestMatch } = require('../utils/nameMatch');
const { escapeSlackMrkdwn } = require('../utils/helpers');
const { parseNaturalDate } = require('../utils/dateParser');
const { addReminder } = require('../reminders/store');
const { parseIntent } = require('../ai/intentParser');
const { resolveSlackUserToMonday, resolveNameToMonday } = require('../utils/userMapping');
const { notifyAssignment } = require('./notifications');
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

function shouldProcess(message) {
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
 */
async function resolveInvestor(searchName) {
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

  if (result.score > 0.35) {
    return {
      investor: null,
      error: `I couldn't find a close match for "${escapeSlackMrkdwn(searchName)}". Did you mean one of these?\n${investors
        .slice(0, 5)
        .map((i) => `• ${i.name}`)
        .join('\n')}`,
    };
  }

  return { investor: result.match, error: null };
}

// ---------------------------------------------------------------------------
// Fast regex patterns for direct matches (no AI call needed)
// ---------------------------------------------------------------------------

const REGEX_PATTERNS = {
  testMonday: /^test\s+monday$/i,
  overdue: /(?:who'?s?\s+overdue|overdue\s+investors)/i,
  statusCheck: /(?:status\s+on|check\s+on)\s+(.+)/i,
  touchpoint: /(?:contacted|spoke\s+with|reached\s+out\s+to)\s+(.+?)(?:\s+today)?$/i,
};

// ---------------------------------------------------------------------------
// Intent handlers — each handles one action type
// ---------------------------------------------------------------------------

async function handleScheduleFollowUp(intent, message, client, say) {
  const searchName = intent.investorName;
  if (!searchName) {
    await say("I'd love to help schedule a follow-up, but I need to know which investor. Could you include their name?");
    return;
  }

  const { investor, error } = await resolveInvestor(searchName);
  if (error) { await say(error); return; }

  // Parse date
  const dateExpression = intent.date || 'tomorrow';
  const parsedDate = parseNaturalDate(dateExpression);
  if (!parsedDate) {
    await say(`I couldn't figure out when you mean by "${escapeSlackMrkdwn(dateExpression)}". Try something like "tomorrow", "next Tuesday", or "Friday at 2pm".`);
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
      investorStatus: investor.status,
      dealInterest: investor.dealInterest,
      investorLink: investor.link,
    });
  } catch (reminderErr) {
    console.error('[slack/commands] Failed to store reminder:', reminderErr.message);
  }

  // Time display
  const hasTime = dateExpression.match(/\d{1,2}\s*(?:am|pm|:\d{2})/i);
  let timeStr = '';
  if (hasTime) {
    timeStr = ` at ${parsedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: config.timezone, timeZoneName: 'short' })}`;
  }

  await say(
    `Done! Follow-up with *${escapeSlackMrkdwn(investor.name)}* is set for *${formatDateReadable(parsedDate)}*${timeStr}.` +
    ` Monday.com has been updated.${hasTime ? ' :alarm_clock: I\'ll remind you when it\'s time.' : ''}` +
    ` :point_right: <${investor.link}|Open in Monday>`
  );
}

async function handleAssignFollowUp(intent, message, client, say) {
  const searchName = intent.investorName;
  if (!searchName) {
    await say("I need to know which investor to assign. Could you include their name?");
    return;
  }

  const { investor, error } = await resolveInvestor(searchName);
  if (error) { await say(error); return; }

  // Parse date
  const dateExpression = intent.date || 'tomorrow';
  const parsedDate = parseNaturalDate(dateExpression);
  if (!parsedDate) {
    await say(`I couldn't figure out when you mean by "${escapeSlackMrkdwn(dateExpression)}". Try "tomorrow", "next Tuesday", or "Friday".`);
    return;
  }

  const dateStr = formatDateYMD(parsedDate);

  // Resolve the assignee to Slack + Monday.com
  let assigneeMapping;
  const assigneeRaw = intent.assignee;

  if (!assigneeRaw) {
    await say("I need to know who to assign this to. Mention someone by name or tag them with @.");
    return;
  }

  if (intent.assigneeIsSlackTag) {
    // Extract user ID from Slack tag format <@U0A9BLW5480>
    const tagMatch = assigneeRaw.match(/<@(U[A-Z0-9]+)>/);
    const slackUserId = tagMatch ? tagMatch[1] : assigneeRaw.replace(/[<@>]/g, '');
    assigneeMapping = await resolveSlackUserToMonday(client, slackUserId);
  } else {
    assigneeMapping = await resolveNameToMonday(client, assigneeRaw);
  }

  // Update Monday.com: set follow-up date
  const followUpResult = await updateNextFollowUp(investor.id, dateStr);
  if (!followUpResult) {
    await say('Sorry, I could not update the follow-up date on Monday.com.');
    return;
  }

  // Update Monday.com: assign person (if we found a Monday match)
  let assignmentNote = '';
  if (assigneeMapping.mondayPersonId) {
    const assignResult = await updateAssignedTo(investor.id, assigneeMapping.mondayPersonId);
    if (assignResult) {
      assignmentNote = ` and assigned to *${escapeSlackMrkdwn(assigneeMapping.slackName)}* on Monday.com`;
    } else {
      assignmentNote = ` (couldn't update the Assigned To column on Monday.com — please assign manually)`;
    }
  } else {
    assignmentNote = ` (I couldn't find *${escapeSlackMrkdwn(assigneeMapping.slackName)}* in Monday.com to assign them — please do it manually)`;
  }

  // Store reminder for the assignee
  const reminderUserId = assigneeMapping.slackUserId || message.user;
  try {
    addReminder({
      itemId: investor.id,
      investorName: investor.name,
      scheduledAt: parsedDate,
      slackUserId: reminderUserId,
      userEmail: assigneeMapping.slackEmail || null,
      investorStatus: investor.status,
      dealInterest: investor.dealInterest,
      investorLink: investor.link,
    });
  } catch (reminderErr) {
    console.error('[slack/commands] Failed to store reminder:', reminderErr.message);
  }

  // DM the assignee
  let notificationNote = '';
  if (assigneeMapping.slackUserId) {
    const targetChannelId = await getChannelId(client);
    const notifyResult = await notifyAssignment(client, {
      slackUserId: assigneeMapping.slackUserId,
      investorName: investor.name,
      dateStr: formatDateReadable(parsedDate),
      mondayLink: investor.link,
      channelId: targetChannelId,
      assignedBy: message.user,
    });

    if (notifyResult.dmSent) {
      notificationNote = ` They've been notified via DM.`;
    } else if (notifyResult.channelFallback) {
      notificationNote = ` They've been tagged in this channel.`;
    }
  }

  await say(
    `Done! Follow-up with *${escapeSlackMrkdwn(investor.name)}* is set for *${formatDateReadable(parsedDate)}*${assignmentNote}.${notificationNote}` +
    ` :point_right: <${investor.link}|Open in Monday>`
  );
}

async function handleLogTouchpoint(intent, message, client, say) {
  const searchName = intent.investorName;
  if (!searchName) {
    await say("Who did you contact? Include the investor's name and I'll log the touchpoint.");
    return;
  }

  const { investor, error } = await resolveInvestor(searchName);
  if (error) { await say(error); return; }

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

  let confirmMsg = `Got it! Logged a touchpoint for *${escapeSlackMrkdwn(investor.name)}* — Last Contact Date set to today (${todayStr}).`;
  if (nextDateStr) {
    confirmMsg += `\nNext follow-up auto-set to *${nextDateStr}* based on ${investor.status} cadence.`;
  }
  confirmMsg += `\n:point_right: <${investor.link}|Open in Monday>`;

  await say(confirmMsg);
}

async function handleCheckStatus(investorName, say) {
  if (!investorName) {
    await say("Which investor would you like me to check on? Include their name.");
    return;
  }

  const { investor, error } = await resolveInvestor(investorName);
  if (error) { await say(error); return; }

  await say(messages.formatInvestorStatus(investor));
}

async function handleListOverdue(say) {
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
}

async function handleListByStatus(statusFilter, say) {
  try {
    const investors = await getActiveInvestors();
    if (!investors || investors.length === 0) {
      await say('No active investors found in Monday.com.');
      return;
    }

    // Map the filter to the actual status label (partial match)
    const filterLower = (statusFilter || '').toLowerCase();
    const matching = investors.filter((inv) => {
      const status = (inv.status || '').toLowerCase();
      return status.includes(filterLower);
    });

    if (matching.length === 0) {
      await say(`No investors found with status matching "${escapeSlackMrkdwn(statusFilter || 'unknown')}".`);
      return;
    }

    const lines = [];
    lines.push(`:mag: *Investors matching "${escapeSlackMrkdwn(statusFilter)}" (${matching.length}):*`);
    lines.push('');

    for (const inv of matching) {
      const lastContact = inv.lastContactDate
        ? `last contacted ${Math.floor((Date.now() - inv.lastContactDate.getTime()) / 86400000)} days ago`
        : 'never contacted';
      lines.push(
        `• ${escapeSlackMrkdwn(inv.name)} — ${escapeSlackMrkdwn(inv.status)} — ${lastContact} — ${escapeSlackMrkdwn(inv.dealInterest || 'N/A')} — <${inv.link}|Open in Monday>`
      );
    }

    await say(lines.join('\n'));
  } catch (err) {
    console.error('[slack/commands] list by status error:', err.message);
    await say('Something went wrong. Please try again.');
  }
}

async function handleListNotContacted(daysSinceFilter, say) {
  try {
    const investors = await getActiveInvestors();
    if (!investors || investors.length === 0) {
      await say('No active investors found in Monday.com.');
      return;
    }

    const days = daysSinceFilter || 14;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoff.setHours(0, 0, 0, 0);

    const notContacted = investors.filter((inv) => {
      if (!inv.lastContactDate) return true; // never contacted
      const lc = new Date(inv.lastContactDate);
      lc.setHours(0, 0, 0, 0);
      return lc < cutoff;
    });

    if (notContacted.length === 0) {
      await say(`:white_check_mark: Great news — everyone has been contacted within the last ${days} days!`);
      return;
    }

    const lines = [];
    lines.push(`:warning: *Investors not contacted in ${days}+ days (${notContacted.length}):*`);
    lines.push('');

    for (const inv of notContacted) {
      const daysSince = inv.lastContactDate
        ? Math.floor((Date.now() - inv.lastContactDate.getTime()) / 86400000)
        : null;
      const daysStr = daysSince !== null ? `${daysSince} days ago` : 'never contacted';
      lines.push(
        `• ${escapeSlackMrkdwn(inv.name)} — ${escapeSlackMrkdwn(inv.status)} — last contacted ${daysStr} — <${inv.link}|Open in Monday>`
      );
    }

    await say(lines.join('\n'));
  } catch (err) {
    console.error('[slack/commands] list not contacted error:', err.message);
    await say('Something went wrong. Please try again.');
  }
}

async function handleTestMonday(say) {
  try {
    await say(':wrench: Running Monday.com write test...');

    const investors = await getActiveInvestors();
    if (!investors || investors.length === 0) {
      await say(':x: No active investors found — cannot run test.');
      return;
    }

    const testInvestor = investors[0];
    await say(`:mag: Testing write on item: *${escapeSlackMrkdwn(testInvestor.name)}* (ID: ${testInvestor.id})`);

    const result = await testMondayWrite(testInvestor.id);

    if (result.success) {
      await say(`:white_check_mark: Monday.com write test PASSED! Response: \`${JSON.stringify(result.data)}\``);
    } else {
      await say(`:x: Monday.com write test FAILED!\nError: \`${result.error}\`\nCheck Railway logs for full details.`);
    }
  } catch (err) {
    console.error('[slack/commands] test monday error:', err.message);
    await say(`:x: Test crashed: \`${err.message}\``);
  }
}

// ---------------------------------------------------------------------------
// Register all command listeners
// ---------------------------------------------------------------------------

function registerCommands(app) {
  // -------------------------------------------------------------------
  // 0. Message logger — logs every incoming message event for diagnostics
  // -------------------------------------------------------------------
  app.message(async ({ message, client }) => {
    const text = message.text || '(no text)';
    const user = message.user || message.bot_id || 'unknown';
    const channel = message.channel || 'unknown';
    const subtype = message.subtype || 'none';
    console.log(`[slack/messages] Received message: "${text}" from=${user} channel=${channel} subtype=${subtype}`);
  });

  // -------------------------------------------------------------------
  // Main message handler — regex fast-path + NLU fallback
  // -------------------------------------------------------------------
  app.message(async ({ message, client, say }) => {
    if (!shouldProcess(message)) return;
    if (!(await isCorrectChannel(message, client))) return;

    const text = (message.text || '').trim();
    if (!text) return;

    // Ignore messages from the bot itself
    if (message.user === config.slack.botUserId) return;

    try {
      // ── FAST PATH: regex matching for common commands ──

      // Test Monday (exact match)
      if (REGEX_PATTERNS.testMonday.test(text)) {
        await handleTestMonday(say);
        return;
      }

      // Who's overdue
      if (REGEX_PATTERNS.overdue.test(text)) {
        await handleListOverdue(say);
        return;
      }

      // Status check: "status on X" / "check on X"
      const statusMatch = text.match(REGEX_PATTERNS.statusCheck);
      if (statusMatch) {
        await handleCheckStatus(statusMatch[1].trim(), say);
        return;
      }

      // Touchpoint: "contacted X today" / "spoke with X"
      const touchpointMatch = text.match(REGEX_PATTERNS.touchpoint);
      if (touchpointMatch) {
        const name = touchpointMatch[1].trim();
        await handleLogTouchpoint({ investorName: name }, message, client, say);
        return;
      }

      // ── NLU PATH: send to Claude for intent parsing ──
      console.log(`[slack/commands] No regex match for "${text}" — sending to NLU`);

      const intent = await parseIntent(text);

      // If confidence is too low, treat as non-command
      if (intent.confidence < 0.5 || intent.action === 'unknown') {
        await say(
          "I'm not sure what you need — are you trying to schedule a follow-up, log a contact, or check on an investor? Just let me know and I'll help out."
        );
        return;
      }

      // Route based on parsed action
      switch (intent.action) {
        case 'schedule_followup':
          await handleScheduleFollowUp(intent, message, client, say);
          break;

        case 'assign_followup':
          await handleAssignFollowUp(intent, message, client, say);
          break;

        case 'log_touchpoint':
          await handleLogTouchpoint(intent, message, client, say);
          break;

        case 'check_status':
          await handleCheckStatus(intent.investorName, say);
          break;

        case 'list_overdue':
          await handleListOverdue(say);
          break;

        case 'list_by_status':
          await handleListByStatus(intent.statusFilter, say);
          break;

        case 'list_not_contacted':
          await handleListNotContacted(intent.daysSinceFilter, say);
          break;

        case 'test_monday':
          await handleTestMonday(say);
          break;

        default:
          await say(
            "I'm not sure what you need — are you trying to schedule a follow-up, log a contact, or check on an investor? Just let me know and I'll help out."
          );
      }
    } catch (err) {
      console.error('[slack/commands] Handler error:', err.message, err.stack);
      await say('Something went wrong processing your message. Please try again.');
    }
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = { registerCommands };
