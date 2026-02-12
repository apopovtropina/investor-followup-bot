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

  // Validate critical env vars
  if (!config.slack.botToken) console.error('[startup] MISSING: SLACK_BOT_TOKEN');
  if (!config.slack.appToken) console.error('[startup] MISSING: SLACK_APP_TOKEN');
  if (!config.slack.signingSecret) console.error('[startup] MISSING: SLACK_SIGNING_SECRET');
  console.log(`[startup] SLACK_APP_TOKEN present: ${!!config.slack.appToken} (starts with xapp-: ${(config.slack.appToken || '').startsWith('xapp-')})`);
  console.log(`[startup] SLACK_BOT_TOKEN present: ${!!config.slack.botToken} (starts with xoxb-: ${(config.slack.botToken || '').startsWith('xoxb-')})`);

  // Load persisted reminders
  loadReminders();

  // Register Slack commands BEFORE app.start()
  registerCommands(app);
  console.log('[slack] Message listeners registered');

  // Start Slack app (Socket Mode — no port)
  await app.start();
  console.log('[slack] Slack bot connected via Socket Mode');

  // Use hardcoded channel ID from config, verify via API
  let channelId = config.slack.channelId;
  try {
    // Verify the channel exists and get its info
    const info = await app.client.conversations.info({ channel: channelId });
    if (info.channel) {
      console.log(`[startup] Verified channel #${info.channel.name} (${channelId})`);
    }
  } catch (err) {
    console.warn(`[startup] Could not verify channel ${channelId}: ${err.message}`);
    // Fall back to searching by name
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
    } catch (listErr) {
      console.error('[startup] Error looking up Slack channel:', listErr.message);
    }
  }

  if (!channelId) {
    console.warn(
      `[startup] ⚠️ Channel #${config.slack.channel} not found — please create it and invite the bot.`
    );
  } else {
    console.log(`[startup] Using channel #${config.slack.channel} (${channelId})`);

    // Ensure the bot has joined the channel
    try {
      await app.client.conversations.join({ channel: channelId });
      console.log(`[startup] Bot joined channel ${channelId} (or was already a member)`);
    } catch (joinErr) {
      // "already_in_channel" is fine, other errors need attention
      if (joinErr.data?.error === 'already_in_channel') {
        console.log(`[startup] Bot is already a member of channel ${channelId}`);
      } else if (joinErr.data?.error === 'method_not_supported_for_channel_type') {
        console.warn(`[startup] Cannot auto-join channel ${channelId} (private channel). Please invite the bot manually: /invite @InvestorBot`);
      } else {
        console.error(`[startup] Failed to join channel ${channelId}:`, joinErr.message);
      }
    }
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
