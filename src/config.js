require('dotenv').config();

const mondayBoards = require('./config/monday-boards');

module.exports = {
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    channel: 'monday-investor-followups',
    channelId: process.env.SLACK_CHANNEL_ID || 'C0ADB93MTLP',
    botUserId: process.env.SLACK_BOT_USER_ID || 'U0AED6A08S2',
  },

  monday: {
    apiToken: process.env.MONDAY_API_TOKEN,
    apiUrl: 'https://api.monday.com/v2',
    boards: {
      investorList: mondayBoards.investorList.boardId,
      relationshipManagement: mondayBoards.relationshipManagement.boardId,
      communicationsLog: mondayBoards.communicationsLog.boardId,
      activeOfferings: mondayBoards.activeOfferings.boardId,
      newsletter: mondayBoards.newsletter.boardId,
      investorFileTracker: mondayBoards.investorFileTracker.boardId,
    },
    // Investor List columns (READ — investor data)
    columns: mondayBoards.investorList.columns,
    // Investor List groups
    groups: mondayBoards.investorList.groups,
    // Investor List board URL (for investor links)
    boardUrl: mondayBoards.investorList.boardUrl,

    // Relationship Management columns (WRITE — follow-up activity)
    rmColumns: mondayBoards.relationshipManagement.columns,
    // Relationship Management groups
    rmGroups: mondayBoards.relationshipManagement.groups,
    // Relationship Management board URL
    rmBoardUrl: mondayBoards.relationshipManagement.boardUrl,

    // Communications Log columns (WRITE — communication records)
    commsColumns: mondayBoards.communicationsLog.columns,
    commsGroups: mondayBoards.communicationsLog.groups,
    commsLabels: mondayBoards.communicationsLog,

    // Team user IDs
    team: mondayBoards.team,
  },

  // Full board configs (for direct access when needed)
  mondayBoards,

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'Elite Capital Follow-Up Bot <bot@elitecapitalgroup.co>',
  },

  // Tiered follow-up cadence
  cadence: {
    '🔥 Hot Lead': { minDays: 1, maxDays: 3, coldAfter: 4, autoNextDays: 1 },
    '🟡 Warm Prospect': { minDays: 5, maxDays: 7, coldAfter: 8, autoNextDays: 5 },
    '🔵 Cold / New Lead': { minDays: 14, maxDays: 21, coldAfter: 22, autoNextDays: 14 },
    '🔵 Cold / New': { minDays: 14, maxDays: 21, coldAfter: 22, autoNextDays: 14 },
    '✅ Committed': { minDays: 7, maxDays: 7, coldAfter: 10, autoNextDays: 7 },
    '💰 Funded': { minDays: 30, maxDays: 30, coldAfter: 45, autoNextDays: 30 },
  },

  timezone: 'America/New_York',
};
