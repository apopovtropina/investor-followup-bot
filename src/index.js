require('dotenv').config();

const express = require('express');
const config = require('./config');
const app = require('./slack/app');
const { registerCommands } = require('./slack/commands');
const { setupCronJobs } = require('./scheduler/cron');
const { loadReminders } = require('./reminders/store');
const { startReminderChecker } = require('./reminders/checker');
const { getActiveInvestors } = require('./monday/queries');

async function start() {
  // Health check endpoint for Railway
  const server = express();
  server.disable('x-powered-by');
  server.get('/', (req, res) => {
    res.json({ status: 'ok' });
  });
  server.listen(3000, () => {
    console.log('[health] Health check endpoint running on port 3000');
  });

  // Load persisted reminders
  loadReminders();

  // Register Slack commands
  registerCommands(app);

  // Start Slack app (Socket Mode)
  await app.start();
  console.log('[slack] Slack bot connected via Socket Mode');

  // Find the #monday-investor-followups channel
  let channelId = null;
  try {
    let cursor;
    do {
      const result = await app.client.conversations.list({
        types: 'public_channel,private_channel',
        limit: 200,
        cursor,
      });
      const found = result.channels.find(c => c.name === config.slack.channel);
      if (found) {
        channelId = found.id;
        break;
      }
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);
  } catch (err) {
    console.error('[startup] Error looking up Slack channel:', err.message);
  }

  if (!channelId) {
    console.warn(
      `[startup] ⚠️ Channel #${config.slack.channel} not found — please create it and invite the bot.`
    );
  } else {
    console.log(`[startup] Found channel #${config.slack.channel} (${channelId})`);
  }

  // Set up cron jobs
  setupCronJobs(app.client, channelId);
  console.log('[cron] Scheduled cron jobs (daily scan 9AM, weekly summary Mon 8AM, stale alerts Mon 8:30AM, polling every 15min)');

  // Start reminder checker (every 60 seconds)
  startReminderChecker(app.client, channelId);
  console.log('[reminders] Reminder checker started (checking every 60 seconds)');

  // Startup summary
  try {
    const investors = await getActiveInvestors();
    const statusSet = new Set(investors.map(i => i.status).filter(Boolean));
    console.log(
      `🚀 Investor Follow-Up Bot started successfully. Monitoring ${investors.length} investors across ${statusSet.size} status categories.`
    );
  } catch (err) {
    console.log('🚀 Investor Follow-Up Bot started successfully.');
    console.warn('[startup] Could not fetch initial investor count:', err.message);
  }
}

start().catch(err => {
  console.error('[fatal] Failed to start bot:', err);
  process.exit(1);
});
