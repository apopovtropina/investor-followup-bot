// ---------------------------------------------------------------------------
// Slack command handlers — NLU-powered with regex fallback
// ---------------------------------------------------------------------------
// Messages flow through this pipeline:
//   1. Message deduplication (skip already-processed messages)
//   2. Strip markdown and Slack formatting for clean parsing
//   3. Fast regex matching for well-known commands (zero latency)
//   4. If no regex match → Anthropic NLU intent parsing (conversational)
//   5. Route parsed intent to the appropriate handler
//   6. If missing_info, ask a targeted follow-up question
// ---------------------------------------------------------------------------

const config = require('../config');
const { getActiveInvestors, getAllInvestors } = require('../monday/queries');
const {
  updateNextFollowUp,
  updateLastContactDate,
  removeGoingColdFlag,
  testMondayWrite,
  updateAssignedTo,
  createInvestor,
  createFollowUpActivity,
  logCommunication,
  deleteItem,
} = require('../monday/mutations');
const { findBestMatch } = require('../utils/nameMatch');
const { escapeSlackMrkdwn } = require('../utils/helpers');
const { parseNaturalDate } = require('../utils/dateParser');
const { addReminder } = require('../reminders/store');
const { parseIntent } = require('../ai/intentParser');
const { parseContacts } = require('../ai/contactParser');
const { resolveSlackUserToMonday, resolveNameToMonday, getTeamSlackId } = require('../utils/userMapping');
const { notifyAssignment } = require('./notifications');
const messages = require('./messages');

// ---------------------------------------------------------------------------
// Message deduplication cache — prevents double-processing
// ---------------------------------------------------------------------------

const processedMessages = new Map();

// Clean up old entries every 5 minutes
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 300000;
  for (const [ts, time] of processedMessages) {
    if (time < fiveMinutesAgo) processedMessages.delete(ts);
  }
}, 300000);

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
 * Strip leading prepositions from investor names.
 * Both the regex fast-path and NLU may leave prepositions like
 * "with", "for", "to", "on" at the start of the extracted name.
 */
function stripNamePrefix(name) {
  return name.replace(/^(?:with|for|to|on|about|regarding)\s+/i, '').trim();
}

/**
 * Strip Slack markdown formatting and special characters from message text
 * before processing. Handles backticks, bold, italic, and Slack's special
 * formatting for phone numbers, emails, and URLs.
 */
function cleanSlackText(text) {
  let cleaned = text;

  // Strip code blocks and inline code
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // Strip bold/italic markers
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
  cleaned = cleaned.replace(/~([^~]+)~/g, '$1'); // strikethrough

  // Decode Slack phone formatting: <tel:555-123-4567|555-123-4567> → 555-123-4567
  cleaned = cleaned.replace(/<tel:([^|>]+)\|?[^>]*>/g, '$1');

  // Decode Slack email formatting: <mailto:user@test.com|user@test.com> → user@test.com
  cleaned = cleaned.replace(/<mailto:([^|>]+)\|?[^>]*>/g, '$1');

  // Decode Slack URL formatting: <https://url.com|Display Text> → https://url.com
  // But preserve user mentions <@UXXXX> and channel mentions <#CXXXX>
  cleaned = cleaned.replace(/<(https?:\/\/[^|>]+)\|?[^>]*>/g, '$1');

  return cleaned.trim();
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
  // Always strip leading prepositions (with, for, to, on, about, regarding)
  // as defense-in-depth — both regex and NLU paths may leave them attached
  const cleanName = stripNamePrefix(searchName);

  let investors;
  try {
    investors = await getActiveInvestors();
  } catch (err) {
    return { investor: null, error: 'Sorry, I could not reach Monday.com right now. Please try again in a moment.' };
  }

  if (!investors || investors.length === 0) {
    return { investor: null, error: 'No active investors found in Monday.com.' };
  }

  const result = findBestMatch(cleanName, investors);

  if (!result) {
    return {
      investor: null,
      error: `I couldn't find an investor matching "${escapeSlackMrkdwn(cleanName)}". Please check the spelling and try again.`,
    };
  }

  if (result.score > 0.35) {
    return {
      investor: null,
      error: `I couldn't find a close match for "${escapeSlackMrkdwn(cleanName)}". Did you mean one of these?\n${investors
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
    await say(`Sorry, I could not update Monday.com for ${escapeSlackMrkdwn(investor.name)}. Please try again or update it manually. :point_right: <${investor.link}|Open in Monday>`);
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
    ` Monday.com is updated.${hasTime ? ' :alarm_clock: I\'ll remind you when it\'s time.' : ''}` +
    ` :point_right: <${investor.link}|Open in Monday>` +
    ` Want me to assign this to someone specific?`
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
    // Try hardcoded team lookup first, then fall back to API
    assigneeMapping = await resolveNameToMonday(client, assigneeRaw);
  }

  // Update Monday.com: set follow-up date
  const followUpResult = await updateNextFollowUp(investor.id, dateStr);
  if (!followUpResult) {
    await say(`Sorry, I could not update the follow-up date on Monday.com for ${escapeSlackMrkdwn(investor.name)}. :point_right: <${investor.link}|Open in Monday>`);
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
    await say(`Sorry, I could not update Monday.com for ${escapeSlackMrkdwn(investor.name)}. Please try again or update it manually. :point_right: <${investor.link}|Open in Monday>`);
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

  // Write follow-up activity to Relationship Management board
  try {
    await createFollowUpActivity({
      investorName: investor.name,
      investorStatus: investor.status,
      lastContactDate: todayStr,
      nextFollowUp: nextDateStr || undefined,
      email: investor.email || undefined,
      phone: investor.phone || undefined,
      notes: `Touchpoint logged via Slack on ${todayStr}`,
      linkedInvestorId: investor.id,
    });
  } catch (rmErr) {
    console.error('[slack/commands] Failed to write to Relationship Management board:', rmErr.message);
  }

  // Log to Communications Log board
  try {
    await logCommunication({
      name: `Follow-up: ${investor.name}`,
      commType: 'Ad Hoc / Other',
      dateSent: todayStr,
      sendStatus: 'Sent',
      notes: `Touchpoint logged via Slack. Status: ${investor.status}. Deal: ${investor.dealInterest || 'N/A'}`,
    });
  } catch (commsErr) {
    console.error('[slack/commands] Failed to log to Communications board:', commsErr.message);
  }

  let confirmMsg = `Logged it — *${escapeSlackMrkdwn(investor.name)}* marked as contacted today.`;
  if (nextDateStr && tier) {
    confirmMsg += ` Next follow-up is auto-set for *${nextDateStr}* based on ${escapeSlackMrkdwn(investor.status)} cadence (${tier.autoNextDays} days).`;
  }
  confirmMsg += ` Status: ${escapeSlackMrkdwn(investor.status)} | Deal: ${escapeSlackMrkdwn(investor.dealInterest || 'N/A')}.`;
  confirmMsg += ` :point_right: <${investor.link}|Open in Monday>`;

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
    await say(`:mag: Testing write on Investor List item: *${escapeSlackMrkdwn(testInvestor.name)}* (ID: ${testInvestor.id})\nTesting create on Relationship Management board (${config.monday.boards.relationshipManagement})`);

    const result = await testMondayWrite(testInvestor.id);

    if (result.success) {
      let msg = `:white_check_mark: Monday.com write test PASSED!\n• Investor List write: OK\n• Relationship Management create: OK (item ID: ${result.testItemId})`;

      // Clean up test item
      if (result.testItemId) {
        const deleted = await deleteItem(result.testItemId);
        if (deleted) {
          msg += '\n• Test item deleted: OK';
        } else {
          msg += '\n• Test item cleanup failed — please delete manually';
        }
      }

      await say(msg);
    } else {
      await say(`:x: Monday.com write test FAILED!\nError: \`${result.error}\`\nCheck Railway logs for full details.`);
    }
  } catch (err) {
    console.error('[slack/commands] test monday error:', err.message);
    await say(`:x: Test crashed: \`${err.message}\``);
  }
}

// ---------------------------------------------------------------------------
// NEW: Add Investor handler — parses pasted contacts and creates items
// ---------------------------------------------------------------------------

async function handleAddInvestor(rawText, say) {
  try {
    // Parse contacts from the raw message using AI
    const contacts = await parseContacts(rawText);

    if (!contacts || contacts.length === 0) {
      await say("I couldn't parse any contact information from your message. Try including a name and at least a phone number or email.");
      return;
    }

    // Get existing investors for duplicate checking
    const existingInvestors = await getAllInvestors();
    const results = [];

    for (const contact of contacts) {
      // Check for duplicates using fuzzy name matching
      const duplicate = existingInvestors.length > 0
        ? findBestMatch(contact.name, existingInvestors)
        : null;

      if (duplicate && duplicate.score <= 0.3) {
        // Close match — likely already exists
        results.push({
          name: contact.name,
          status: 'duplicate',
          existingName: duplicate.match.name,
          link: duplicate.match.link,
        });
        continue;
      }

      // Calculate default follow-up date (14 days from now)
      const followUpDate = new Date();
      followUpDate.setDate(followUpDate.getDate() + 14);
      const followUpStr = formatDateYMD(followUpDate);

      // Create the investor on Monday.com
      const created = await createInvestor({
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        linkedin: contact.linkedin,
        notes: contact.notes,
        nextFollowUp: followUpStr,
      });

      if (created) {
        results.push({
          name: created.name,
          status: 'created',
          phone: contact.phone,
          email: contact.email,
          link: created.link,
          followUp: followUpStr,
        });
      } else {
        results.push({
          name: contact.name,
          status: 'failed',
        });
      }
    }

    // Format response
    const lines = [];
    for (const r of results) {
      if (r.status === 'created') {
        const details = [];
        if (r.phone) details.push(`Phone: ${r.phone}`);
        if (r.email) details.push(`Email: ${r.email}`);
        lines.push(
          `:white_check_mark: Added *${escapeSlackMrkdwn(r.name)}* to the investor board as a new lead. ${details.join(', ')}. Next follow-up set for ${r.followUp}. <${r.link}|Open in Monday>`
        );
      } else if (r.status === 'duplicate') {
        lines.push(
          `:information_source: *${escapeSlackMrkdwn(r.existingName)}* is already on the board. Did you want me to update their info or log a touchpoint? <${r.link}|Open in Monday>`
        );
      } else {
        lines.push(
          `:x: Failed to add *${escapeSlackMrkdwn(r.name)}* — Monday.com update error. Please add them manually.`
        );
      }
    }

    await say(lines.join('\n\n'));
  } catch (err) {
    console.error('[slack/commands] add investor error:', err.message);
    await say('Something went wrong while adding the investor. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// NEW: Contact Info handler — look up phone/email for an investor
// ---------------------------------------------------------------------------

async function handleContactInfo(investorName, contactField, say) {
  if (!investorName) {
    await say("Which investor's contact info do you need? Include their name.");
    return;
  }

  const { investor, error } = await resolveInvestor(investorName);
  if (error) { await say(error); return; }

  if (contactField === 'phone') {
    const phone = investor.phone || 'Not on file';
    await say(`*${escapeSlackMrkdwn(investor.name)}*'s phone: ${phone}`);
  } else if (contactField === 'email') {
    const email = investor.email || 'Not on file';
    await say(`*${escapeSlackMrkdwn(investor.name)}*'s email: ${email}`);
  } else {
    // Show all contact info
    const lines = [];
    lines.push(`*${escapeSlackMrkdwn(investor.name)}* — Contact Info:`);
    lines.push(`Phone: ${investor.phone || 'Not on file'}`);
    lines.push(`Email: ${investor.email || 'Not on file'}`);
    lines.push(`Company: ${escapeSlackMrkdwn(investor.company || 'N/A')}`);
    lines.push(`Status: ${escapeSlackMrkdwn(investor.status)} | Deal: ${escapeSlackMrkdwn(investor.dealInterest || 'N/A')}`);
    lines.push(`:point_right: <${investor.link}|Open in Monday>`);
    await say(lines.join('\n'));
  }
}

// ---------------------------------------------------------------------------
// NEW: Count Investors handler — pipeline summary by status
// ---------------------------------------------------------------------------

async function handleCountInvestors(say) {
  try {
    const investors = await getActiveInvestors();
    if (!investors || investors.length === 0) {
      await say('No active investors found in Monday.com.');
      return;
    }

    // Count by status
    const statusCounts = {};
    for (const inv of investors) {
      const status = inv.status || 'Unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    const lines = [];
    lines.push(`:bar_chart: *Investor Pipeline — ${investors.length} total active investors:*`);
    lines.push('');

    for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`• ${escapeSlackMrkdwn(status)}: ${count}`);
    }

    // Overdue count
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const overdueCount = investors.filter((inv) => {
      if (!inv.nextFollowUp) return false;
      const fu = new Date(inv.nextFollowUp);
      fu.setHours(0, 0, 0, 0);
      return fu < now;
    }).length;

    if (overdueCount > 0) {
      lines.push('');
      lines.push(`:red_circle: ${overdueCount} investor(s) with overdue follow-ups`);
    }

    await say(lines.join('\n'));
  } catch (err) {
    console.error('[slack/commands] count investors error:', err.message);
    await say('Something went wrong. Please try again.');
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

    // Message deduplication — skip already-processed messages
    if (processedMessages.has(message.ts)) return;
    processedMessages.set(message.ts, Date.now());

    const rawText = (message.text || '').trim();
    if (!rawText) return;

    // Ignore messages from the bot itself
    if (message.user === config.slack.botUserId) return;

    // Clean Slack formatting for parsing (strip markdown, decode tel/mailto/url)
    const text = cleanSlackText(rawText);
    if (!text) return;

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
        await handleCheckStatus(stripNamePrefix(statusMatch[1].trim()), say);
        return;
      }

      // Touchpoint: "contacted X today" / "spoke with X"
      const touchpointMatch = text.match(REGEX_PATTERNS.touchpoint);
      if (touchpointMatch) {
        const name = stripNamePrefix(touchpointMatch[1].trim());
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

      // Check for missing info — ask targeted follow-up question
      if (intent.missing_info && intent.missing_info.length > 0) {
        const missing = intent.missing_info[0]; // Focus on the most important missing field
        const actionLabel = {
          schedule_followup: 'schedule a follow-up',
          assign_followup: 'assign a follow-up',
          log_touchpoint: 'log a contact',
          check_status: 'check the status',
          contact_info: 'look up contact info',
        }[intent.action] || 'do that';

        if (missing === 'investorName') {
          await say(`Got it, you want to ${actionLabel}. Which investor are you referring to?`);
          return;
        }
        if (missing === 'assignee') {
          await say(`Got it, you want to ${actionLabel} for *${escapeSlackMrkdwn(intent.investorName || 'the investor')}*. Who should I assign this to?`);
          return;
        }
        if (missing === 'date') {
          await say(`Got it, you want to ${actionLabel} for *${escapeSlackMrkdwn(intent.investorName || 'the investor')}*. When should the follow-up be?`);
          return;
        }
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

        case 'add_investor':
          // Pass raw text (not cleaned) to preserve full contact info
          await handleAddInvestor(rawText, say);
          break;

        case 'contact_info':
          await handleContactInfo(intent.investorName, intent.contactField, say);
          break;

        case 'count_investors':
          await handleCountInvestors(say);
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
