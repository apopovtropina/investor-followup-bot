const { App, LogLevel } = require('@slack/bolt');
const config = require('../config');

const app = new App({
  token: config.slack.botToken,
  signingSecret: config.slack.signingSecret,
  socketMode: true,
  appToken: config.slack.appToken,
  logLevel: LogLevel.INFO,
});

// Log all incoming events for debugging (will fire for every Slack event)
app.use(async ({ event, next }) => {
  if (event) {
    console.log(`[slack/event] type=${event.type} subtype=${event.subtype || 'none'} channel=${event.channel || 'N/A'} user=${event.user || 'N/A'}`);
  }
  await next();
});

module.exports = app;
