const config = require('../config');
const { getActiveInvestors } = require('../monday/queries');
const { formatStaleAlerts } = require('../slack/messages');

async function runStaleAlerts(slackClient, channelId) {
  console.log('[Stale Alerts] Starting stale investor check...');

  const investors = await getActiveInvestors();

  const today = new Date(
    new Date().toLocaleString('en-US', { timeZone: config.timezone })
  );
  today.setHours(0, 0, 0, 0);

  const staleInvestors = investors.filter((investor) => {
    if (!investor.lastContactDate) return false;

    const lastContact = new Date(investor.lastContactDate);
    lastContact.setHours(0, 0, 0, 0);

    const daysSinceLastContact = Math.floor(
      (today - lastContact) / (1000 * 60 * 60 * 24)
    );

    return daysSinceLastContact >= 30;
  });

  if (staleInvestors.length > 0) {
    const message = formatStaleAlerts(staleInvestors);

    await slackClient.chat.postMessage({
      channel: channelId,
      text: message,
    });
  }

  console.log(
    `[Stale Alerts] Complete. ${staleInvestors.length} stale investor(s) found.`
  );

  return staleInvestors.length;
}

module.exports = { runStaleAlerts };
