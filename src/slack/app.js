const { App } = require('@slack/bolt');
const config = require('../config');

const app = new App({
  token: config.slack.botToken,
  signingSecret: config.slack.signingSecret,
  socketMode: true,
  appToken: config.slack.appToken,
});

module.exports = app;
