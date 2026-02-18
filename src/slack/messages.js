// ---------------------------------------------------------------------------
// Slack message formatting helpers
// ---------------------------------------------------------------------------
// All functions return Slack mrkdwn-formatted strings.

const config = require('../config');
const { escapeSlackMrkdwn } = require('../utils/helpers');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(date) {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function todayFormatted() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Chicago',
  });
}

function formatDateShort(date) {
  if (!date) return 'N/A';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  });
}

function formatCurrency(amount) {
  if (!amount) return '$0';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '$0';
  return '$' + num.toLocaleString('en-US');
}

/**
 * Return a formatted time string in Central Time if the time is not the
 * default 9:00 AM (i.e. a specific time was scheduled). Returns empty string
 * if the time is 09:00 or midnight (no time set).
 */
function formatTimeIfNotDefault(date) {
  if (!date) return '';
  const hours = date.getUTCHours !== undefined
    ? parseInt(date.toLocaleTimeString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/Chicago' }), 10)
    : date.getHours();
  const minutes = parseInt(date.toLocaleTimeString('en-US', { minute: '2-digit', hour12: false, timeZone: 'America/Chicago' }), 10);

  // If time is exactly 09:00 (default) or 00:00 (no time set), don't show time
  if ((hours === 9 && minutes === 0) || (hours === 0 && minutes === 0)) return '';

  return ' at ' + date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
    timeZoneName: 'short',
  });
}

// ---------------------------------------------------------------------------
// formatDailyDigest
// ---------------------------------------------------------------------------

/**
 * Format the assignee tag for an investor in digest messages.
 * Uses slackUserMap (mondayPersonId → slackUserId) if provided.
 *
 * @param {Object} investor - Investor object with assignedTo array
 * @param {Map}    [slackUserMap] - Map of Monday.com person ID → Slack user ID
 * @returns {string} Formatted assignee string or empty
 */
function formatAssigneeTag(investor, slackUserMap) {
  if (!investor.assignedTo || investor.assignedTo.length === 0) return '';

  const tags = investor.assignedTo.map((person) => {
    const personId = String(person.id);
    if (slackUserMap && slackUserMap.has(personId)) {
      return `<@${slackUserMap.get(personId)}>`;
    }
    return person.name || `ID:${personId}`;
  });

  return tags.length > 0 ? ` → ${tags.join(', ')}` : '';
}

/**
 * Build the daily follow-up report message.
 *
 * @param {Array}  overdue     - Investors whose next follow-up is past due
 * @param {Array}  dueToday    - Investors whose next follow-up is today
 * @param {Object} suggestions - Map of investor name -> AI suggestion text
 * @param {Map}    [slackUserMap] - Map of Monday.com person ID → Slack user ID (for tagging)
 * @returns {string} Slack mrkdwn message
 */
function formatDailyDigest(overdue, dueToday, suggestions = {}, slackUserMap = null) {
  if ((!overdue || overdue.length === 0) && (!dueToday || dueToday.length === 0)) {
    return ':white_check_mark: All clear \u2014 no follow-ups due today!';
  }

  const lines = [];
  lines.push(`:clipboard: *Daily Follow-Up Report \u2014 ${todayFormatted()}*`);
  lines.push('');

  // Overdue section
  if (overdue && overdue.length > 0) {
    lines.push(`:red_circle: *OVERDUE (${overdue.length}):*`);
    for (const inv of overdue) {
      const days = daysAgo(inv.lastContactDate);
      const daysStr = days !== null ? `last contacted ${days} days ago` : 'no contact date';
      const assignee = formatAssigneeTag(inv, slackUserMap);
      lines.push(
        `\u2022 :red_circle: ${escapeSlackMrkdwn(inv.name)}${assignee} \u2014 ${escapeSlackMrkdwn(inv.status)} \u2014 ${daysStr} \u2014 ${escapeSlackMrkdwn(inv.dealInterest || 'N/A')} \u2014 <${inv.link}|Open in Monday>`
      );
    }
    lines.push('');
  }

  // Due today section
  if (dueToday && dueToday.length > 0) {
    lines.push(`:calendar: *DUE TODAY (${dueToday.length}):*`);
    for (const inv of dueToday) {
      const assignee = formatAssigneeTag(inv, slackUserMap);
      const timeStr = formatTimeIfNotDefault(inv.nextFollowUp);
      lines.push(
        `\u2022 ${escapeSlackMrkdwn(inv.name)}${assignee} \u2014 ${escapeSlackMrkdwn(inv.status)} \u2014 ${escapeSlackMrkdwn(inv.dealInterest || 'N/A')}${timeStr} \u2014 <${inv.link}|Open in Monday>`
      );
    }
    lines.push('');
  }

  // AI suggestions section
  if (suggestions && Object.keys(suggestions).length > 0) {
    for (const [name, suggestion] of Object.entries(suggestions)) {
      const inv = [...(overdue || []), ...(dueToday || [])].find(
        (i) => i.name === name
      );
      lines.push(`:bulb: *Suggested Touchpoint for ${escapeSlackMrkdwn(name)}:*`);
      if (inv) {
        lines.push(
          `${escapeSlackMrkdwn(inv.investorType || 'Unknown type')} investor interested in ${escapeSlackMrkdwn(inv.dealInterest || 'N/A')}. Last note: "${escapeSlackMrkdwn((inv.notes || 'No notes').substring(0, 120))}"`
        );
      }
      lines.push(`Suggested action: ${escapeSlackMrkdwn(suggestion)}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// formatGoingColdAlert
// ---------------------------------------------------------------------------

/**
 * Build the going-cold alert message for a single investor.
 *
 * @param {Object} investor  - The investor object
 * @param {number} daysSince - Days since last contact
 * @param {Object} cadence   - The cadence tier { minDays, maxDays, coldAfter }
 * @returns {string} Slack mrkdwn message
 */
function formatGoingColdAlert(investor, daysSince, cadence) {
  const lines = [];
  lines.push(':red_circle: *GOING COLD ALERT*');
  lines.push(
    `:red_circle: ${escapeSlackMrkdwn(investor.name)} (${escapeSlackMrkdwn(investor.status)}) hasn't been contacted in ${daysSince} days \u2014 window is ${cadence.minDays}-${cadence.maxDays} days.`
  );
  lines.push(
    `Deal Interest: ${escapeSlackMrkdwn(investor.dealInterest || 'N/A')} | Investment Interest: ${formatCurrency(investor.investmentInterest)}`
  );
  lines.push(`:point_right: <${investor.link}|Open in Monday>`);
  lines.push('');
  lines.push(`Reply with: "follow up ${escapeSlackMrkdwn(investor.name)} tomorrow at 2pm" to reschedule`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// formatWeeklySummary
// ---------------------------------------------------------------------------

/**
 * Build the weekly pipeline summary message.
 *
 * @param {Object} statusCounts  - Map of status label -> count
 * @param {Object} healthCounts  - { onTrack, overdue, goingCold }
 * @param {Object} dealCounts    - Map of deal name -> count
 * @param {number} totalCommitted - Total committed investment amount
 * @returns {string} Slack mrkdwn message
 */
function formatWeeklySummary(statusCounts, healthCounts, dealCounts, totalCommitted) {
  const lines = [];
  lines.push(`:bar_chart: *Weekly Pipeline Summary \u2014 ${todayFormatted()}*`);
  lines.push('');

  // Status breakdown
  lines.push('*Pipeline by Status:*');
  for (const [status, count] of Object.entries(statusCounts)) {
    lines.push(`\u2022 ${escapeSlackMrkdwn(status)}: ${count}`);
  }
  lines.push('');

  // Follow-up health
  lines.push('*Follow-Up Health:*');
  lines.push(`\u2022 :white_check_mark: On track: ${healthCounts.onTrack || 0} investors`);
  lines.push(`\u2022 :red_circle: Going cold: ${healthCounts.goingCold || 0} investors`);
  lines.push(`\u2022 :warning: Stale (30+ days): ${healthCounts.stale || 0} investors`);
  lines.push('');

  // Deal interest breakdown
  if (dealCounts && Object.keys(dealCounts).length > 0) {
    lines.push('*Deal Interest Breakdown:*');
    for (const [deal, count] of Object.entries(dealCounts)) {
      lines.push(`\u2022 ${escapeSlackMrkdwn(deal)}: ${count}`);
    }
    lines.push('');
  }

  // Total committed
  lines.push(`*Total Committed:* ${formatCurrency(totalCommitted)}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// formatStaleAlerts
// ---------------------------------------------------------------------------

/**
 * Build the stale investor alert (30+ days no contact).
 *
 * @param {Array} staleInvestors - Investors with 30+ days since last contact
 * @returns {string} Slack mrkdwn message
 */
function formatStaleAlerts(staleInvestors) {
  if (!staleInvestors || staleInvestors.length === 0) {
    return ':white_check_mark: No stale investors \u2014 everyone has been contacted within 30 days.';
  }

  const lines = [];
  lines.push(`:warning: *Stale Investor Alert \u2014 ${staleInvestors.length} investor(s) with 30+ days since last contact:*`);
  lines.push('');

  for (const inv of staleInvestors) {
    const days = daysAgo(inv.lastContactDate);
    const daysStr = days !== null ? `${days} days ago` : 'never contacted';
    lines.push(
      `\u2022 ${escapeSlackMrkdwn(inv.name)} \u2014 ${escapeSlackMrkdwn(inv.status)} \u2014 last contacted ${daysStr} \u2014 <${inv.link}|Open in Monday>`
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// formatOverdueList
// ---------------------------------------------------------------------------

/**
 * Build the formatted list of overdue investors for the "who's overdue" command.
 *
 * @param {Array} overdueInvestors - Investors with overdue follow-ups
 * @returns {string} Slack mrkdwn message
 */
function formatOverdueList(overdueInvestors) {
  if (!overdueInvestors || overdueInvestors.length === 0) {
    return ':white_check_mark: No overdue follow-ups right now!';
  }

  const lines = [];
  lines.push(`:red_circle: *Overdue Follow-Ups (${overdueInvestors.length}):*`);
  lines.push('');

  for (const inv of overdueInvestors) {
    const days = daysAgo(inv.lastContactDate);
    const daysStr = days !== null ? `last contacted ${days} days ago` : 'never contacted';
    const followUpDate = inv.nextFollowUp ? formatDateShort(inv.nextFollowUp) : 'N/A';
    lines.push(
      `\u2022 ${escapeSlackMrkdwn(inv.name)} \u2014 ${escapeSlackMrkdwn(inv.status)} \u2014 ${daysStr} \u2014 Follow-up was due: ${followUpDate} \u2014 ${escapeSlackMrkdwn(inv.dealInterest || 'N/A')} \u2014 <${inv.link}|Open in Monday>`
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// formatInvestorStatus
// ---------------------------------------------------------------------------

/**
 * Build a single investor status snapshot.
 *
 * @param {Object} investor - The investor object
 * @returns {string} Slack mrkdwn message
 */
function formatInvestorStatus(investor) {
  const nextFollowUp = investor.nextFollowUp
    ? formatDateShort(investor.nextFollowUp)
    : 'N/A';

  // Check if overdue
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const isOverdue = investor.nextFollowUp && investor.nextFollowUp < now;
  const followUpDisplay = isOverdue ? ':red_circle: OVERDUE' : nextFollowUp;

  const lastContact = investor.lastContactDate
    ? formatDateShort(investor.lastContactDate)
    : 'Never';

  const assignedNames = investor.assignedTo && investor.assignedTo.length > 0
    ? investor.assignedTo.map((p) => escapeSlackMrkdwn(p.name || `ID:${p.id}`)).join(', ')
    : 'Unassigned';

  const lines = [];
  lines.push(`*${escapeSlackMrkdwn(investor.name)}* \u2014 ${escapeSlackMrkdwn(investor.status)}`);
  lines.push(`Deal Interest: ${escapeSlackMrkdwn(investor.dealInterest || 'N/A')} | Investment Interest: ${formatCurrency(investor.investmentInterest)}`);
  lines.push(`Last contacted: ${lastContact} | Next follow-up: ${followUpDisplay}`);
  lines.push(`Source: ${escapeSlackMrkdwn(investor.source || 'N/A')} | Assigned to: ${assignedNames}`);
  lines.push(`<${investor.link}|Open in Monday>`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// formatReminderNotification
// ---------------------------------------------------------------------------

/**
 * Build the scheduled reminder Slack notification.
 *
 * @param {Object} investor - The investor object
 * @param {string} user     - Slack user ID or display name to mention
 * @returns {string} Slack mrkdwn message
 */
function formatReminderNotification(investor, user) {
  const userMention = user.startsWith('U') ? `<@${user}>` : user;
  const status = escapeSlackMrkdwn(investor.status || 'Unknown');
  const deal = escapeSlackMrkdwn(investor.dealInterest || 'N/A');
  const name = escapeSlackMrkdwn(investor.name);

  return `:alarm_clock: ${userMention} \u2014 Time to follow up with *${name}*! Status: ${status} | Deal Interest: ${deal} :point_right: <${investor.link}|Open in Monday>`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  formatDailyDigest,
  formatGoingColdAlert,
  formatWeeklySummary,
  formatStaleAlerts,
  formatOverdueList,
  formatInvestorStatus,
  formatReminderNotification,
};
