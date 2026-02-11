const { getDueReminders, removeReminder } = require('./store');
const { sendReminderEmail } = require('./email');
const { getActiveInvestors } = require('../monday/queries');
const { generateFollowUpSuggestion } = require('../ai/suggestions');
const { formatReminderNotification } = require('../slack/messages');

const CHECK_INTERVAL_MS = 60 * 1000; // every 60 seconds

/**
 * Start the reminder checker loop.
 *
 * @param {import('@slack/web-api').WebClient} slackClient - Slack WebClient instance
 * @param {string} channelId - Slack channel ID to post notifications to
 */
function startReminderChecker(slackClient, channelId) {
  console.log('[reminders/checker] Starting reminder checker (every 60s)');

  setInterval(async () => {
    try {
      const dueReminders = getDueReminders();

      if (dueReminders.length === 0) return;

      console.log(`[reminders/checker] Processing ${dueReminders.length} due reminder(s)`);

      // Fetch all active investors once for matching
      const allInvestors = await getActiveInvestors();

      for (const reminder of dueReminders) {
        try {
          // Find the investor by itemId first, then fall back to name match
          let investor = allInvestors.find(
            (inv) => inv.id === reminder.itemId || inv.id === String(reminder.itemId)
          );

          if (!investor) {
            // Fall back to name match
            const lowerName = (reminder.investorName || '').toLowerCase();
            investor = allInvestors.find(
              (inv) => inv.name.toLowerCase().includes(lowerName)
            );
          }

          if (!investor) {
            console.warn(
              `[reminders/checker] Could not find investor "${reminder.investorName}" (item ${reminder.itemId}) — skipping`
            );
            removeReminder(reminder.id);
            continue;
          }

          // Generate AI suggestion
          let suggestion = '';
          try {
            suggestion = await generateFollowUpSuggestion(investor);
          } catch (err) {
            console.error('[reminders/checker] AI suggestion failed:', err.message);
          }

          // Send reminder email
          if (reminder.userEmail) {
            await sendReminderEmail({
              to: reminder.userEmail,
              investorName: investor.name,
              investor,
              suggestion,
            });
          }

          // Post Slack notification
          if (slackClient && channelId) {
            const slackMessage = formatReminderNotification(
              investor,
              reminder.slackUserId || 'team'
            );

            // Append suggestion if available
            const fullMessage = suggestion
              ? `${slackMessage}\n\n:bulb: *Suggested Action:* ${suggestion}`
              : slackMessage;

            await slackClient.chat.postMessage({
              channel: channelId,
              text: fullMessage,
            });
          }

          // Remove processed reminder
          removeReminder(reminder.id);
          console.log(
            `[reminders/checker] Processed reminder for ${investor.name}`
          );
        } catch (innerErr) {
          console.error(
            `[reminders/checker] Error processing reminder "${reminder.investorName}":`,
            innerErr.message
          );
          // Remove the reminder to avoid infinite retry loop
          removeReminder(reminder.id);
        }
      }

      console.log(
        `[reminders/checker] Finished processing ${dueReminders.length} reminder(s)`
      );
    } catch (err) {
      console.error('[reminders/checker] Tick error:', err.message);
    }
  }, CHECK_INTERVAL_MS);
}

module.exports = { startReminderChecker };
