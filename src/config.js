require('dotenv').config();

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
      investorList: 18399326252,
      communicationsLog: 18399326425,
      activeOfferings: 18399326336,
    },
    columns: {
      name: 'name',
      status: 'color_mm0d1f8z',
      email: 'email_mm0dh83c',
      phone: 'phone_mm0dymr8',
      company: 'text_mm0da4z4',
      investorType: 'dropdown_mm0dtj0p',
      source: 'dropdown_mm0dxpzg',
      referredBy: 'text_mm0db450',
      investmentInterest: 'numeric_mm0dx8ez',
      dealInterest: 'dropdown_mm0dvrsf',
      assignedTo: 'multiple_person_mm0dq26t',
      lastContactDate: 'date_mm0dm8y0',
      nextFollowUp: 'date_mm0drsbg',
      notes: 'long_text_mm0dvjg7',
    },
    groups: {
      hotLeads: 'group_mm0dyh04',
      warmProspects: 'group_mm0d4mqk',
      coldNewLeads: 'group_mm0ddbx',
      committed: 'group_mm0d4m6g',
      funded: 'group_mm0d45zg',
      passed: 'group_mm0d7bte',
    },
    boardUrl: 'https://elitecapitalgroup.monday.com/boards/18399326252/pulses/',
  },

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

  // Tiered follow-up cadence (Feature 2)
  cadence: {
    '🔥 Hot Lead': { minDays: 1, maxDays: 3, coldAfter: 4, autoNextDays: 1 },
    '🟡 Warm Prospect': { minDays: 5, maxDays: 7, coldAfter: 8, autoNextDays: 5 },
    '🔵 Cold / New Lead': { minDays: 14, maxDays: 21, coldAfter: 22, autoNextDays: 14 },
    '✅ Committed': { minDays: 7, maxDays: 7, coldAfter: 10, autoNextDays: 7 },
    '💰 Funded': { minDays: 30, maxDays: 30, coldAfter: 45, autoNextDays: 30 },
  },

  timezone: 'America/New_York',
};
