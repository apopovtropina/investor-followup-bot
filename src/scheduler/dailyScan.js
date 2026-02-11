const config = require('../config');
const { getActiveInvestors } = require('../monday/queries');
const { getRecentCommunications, getActiveOfferings } = require('../monday/queries');
const { generateFollowUpSuggestion } = require('../ai/suggestions');
const { formatDailyDigest } = require('../slack/messages');

function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function isBeforeDay(d1, d2) {
  const a = new Date(d1);
  a.setHours(0, 0, 0, 0);
  const b = new Date(d2);
  b.setHours(0, 0, 0, 0);
  return a < b;
}

async function runDailyScan(slackClient, channelId) {
  console.log('[Daily Scan] Starting daily scan...');

  const investors = await getActiveInvestors();

  // Build today's date in EST, zeroed to midnight
  const today = new Date(
    new Date().toLocaleString('en-US', { timeZone: config.timezone })
  );
  today.setHours(0, 0, 0, 0);

  const overdueList = [];
  const dueTodayList = [];

  for (const investor of investors) {
    if (!investor.nextFollowUp) continue;

    const followUpDate = new Date(investor.nextFollowUp);
    followUpDate.setHours(0, 0, 0, 0);

    if (isBeforeDay(followUpDate, today)) {
      overdueList.push(investor);
    } else if (isSameDay(followUpDate, today)) {
      dueTodayList.push(investor);
    }
    // Otherwise ON_TRACK -- no action needed
  }

  // Generate AI suggestions for DUE_TODAY investors
  const suggestions = {};

  if (dueTodayList.length > 0) {
    const recentComms = await getRecentCommunications(7);
    const activeOfferings = await getActiveOfferings();

    for (const investor of dueTodayList) {
      try {
        const suggestion = await generateFollowUpSuggestion(
          investor,
          recentComms,
          activeOfferings
        );
        suggestions[investor.name] = suggestion;
      } catch (err) {
        console.error(
          `[Daily Scan] Failed to generate suggestion for ${investor.name}:`,
          err.message
        );
        suggestions[investor.name] = 'Unable to generate suggestion.';
      }
    }
  }

  // Format and post digest to Slack
  const message = formatDailyDigest(overdueList, dueTodayList, suggestions);

  await slackClient.chat.postMessage({
    channel: channelId,
    text: message,
  });

  console.log(
    `[Daily Scan] Complete. Overdue: ${overdueList.length}, Due today: ${dueTodayList.length}`
  );

  return {
    overdue: overdueList.length,
    dueToday: dueTodayList.length,
  };
}

module.exports = { runDailyScan };
