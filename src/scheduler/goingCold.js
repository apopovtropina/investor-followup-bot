const config = require('../config');
const { getActiveInvestors } = require('../monday/queries');
const { updateNextFollowUp, addGoingColdFlag } = require('../monday/mutations');
const { formatGoingColdAlert } = require('../slack/messages');

async function runGoingColdCheck(slackClient, channelId) {
  console.log('[Going Cold] Starting going-cold check...');

  const investors = await getActiveInvestors();

  const today = new Date(
    new Date().toLocaleString('en-US', { timeZone: config.timezone })
  );
  today.setHours(0, 0, 0, 0);

  const todayStr = today.toISOString().split('T')[0];

  let coldCount = 0;

  for (const investor of investors) {
    if (!investor.lastContactDate) continue;

    const lastContact = new Date(investor.lastContactDate);
    lastContact.setHours(0, 0, 0, 0);

    const daysSinceContact = Math.floor(
      (today - lastContact) / (1000 * 60 * 60 * 24)
    );

    const tier = config.cadence[investor.status];
    if (!tier) continue;

    if (daysSinceContact >= tier.coldAfter) {
      // 1. Prepend going-cold flag to investor name
      await addGoingColdFlag(investor.id, investor.name);

      // 2. Set Next Follow-Up to today
      await updateNextFollowUp(investor.id, todayStr);

      // 3. Format and post alert to Slack
      const alert = formatGoingColdAlert(investor, daysSinceContact, tier);
      await slackClient.chat.postMessage({
        channel: channelId,
        text: alert,
      });

      coldCount++;
    }
  }

  console.log(`[Going Cold] Complete. ${coldCount} investor(s) going cold.`);

  return coldCount;
}

module.exports = { runGoingColdCheck };
