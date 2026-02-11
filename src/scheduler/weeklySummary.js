const config = require('../config');
const { getAllInvestors } = require('../monday/queries');
const { formatWeeklySummary } = require('../slack/messages');

async function runWeeklySummary(slackClient, channelId) {
  console.log('[Weekly Summary] Starting weekly summary...');

  const investors = await getAllInvestors();

  const today = new Date(
    new Date().toLocaleString('en-US', { timeZone: config.timezone })
  );
  today.setHours(0, 0, 0, 0);

  // Count investors by status
  const statusCounts = {};
  for (const investor of investors) {
    const status = investor.status || 'Unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  // Calculate follow-up health
  const healthCounts = {
    onTrack: 0,
    goingCold: 0,
    stale: 0,
  };

  for (const investor of investors) {
    // Calculate days since last contact
    let daysSinceContact = null;
    if (investor.lastContactDate) {
      const lastContact = new Date(investor.lastContactDate);
      lastContact.setHours(0, 0, 0, 0);
      daysSinceContact = Math.floor(
        (today - lastContact) / (1000 * 60 * 60 * 24)
      );
    }

    // Check if stale (30+ days since contact)
    if (daysSinceContact !== null && daysSinceContact >= 30) {
      healthCounts.stale++;
      continue;
    }

    // Check if going cold based on cadence tier
    const tier = config.cadence[investor.status];
    if (
      tier &&
      daysSinceContact !== null &&
      daysSinceContact >= tier.coldAfter
    ) {
      healthCounts.goingCold++;
      continue;
    }

    // On track: nextFollowUp >= today or no nextFollowUp set
    if (!investor.nextFollowUp) {
      healthCounts.onTrack++;
    } else {
      const followUpDate = new Date(investor.nextFollowUp);
      followUpDate.setHours(0, 0, 0, 0);
      if (followUpDate >= today) {
        healthCounts.onTrack++;
      }
    }
  }

  // Calculate total committed amount for Committed and Funded investors
  let totalCommitted = 0;
  for (const investor of investors) {
    if (
      investor.status === '\u2705 Committed' ||
      investor.status === '\uD83D\uDCB0 Funded'
    ) {
      const amount = parseFloat(investor.investmentInterest) || 0;
      totalCommitted += amount;
    }
  }

  // Count by deal interest
  const dealCounts = {};
  for (const investor of investors) {
    const deal = investor.dealInterest || 'Unspecified';
    dealCounts[deal] = (dealCounts[deal] || 0) + 1;
  }

  // Format and post to Slack
  const message = formatWeeklySummary(
    statusCounts,
    healthCounts,
    dealCounts,
    totalCommitted
  );

  await slackClient.chat.postMessage({
    channel: channelId,
    text: message,
  });

  console.log('[Weekly Summary] Complete.');
}

module.exports = { runWeeklySummary };
