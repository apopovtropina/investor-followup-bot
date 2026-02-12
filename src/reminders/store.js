const fs = require('fs');
const path = require('path');
const { maskEmail } = require('../utils/helpers');

const STORE_PATH = path.join(__dirname, '../../reminders.json');

let reminders = [];

function loadReminders() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = fs.readFileSync(STORE_PATH, 'utf-8');
      reminders = JSON.parse(data);
      console.log(`[reminders/store] Loaded ${reminders.length} reminders from disk`);
    }
  } catch (err) {
    console.error('[reminders/store] Error loading reminders:', err.message);
    reminders = [];
  }
}

function saveReminders() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(reminders, null, 2));
    try { fs.chmodSync(STORE_PATH, 0o600); } catch (_) {}
  } catch (err) {
    console.error('[reminders/store] Error saving reminders:', err.message);
  }
}

function addReminder({ investorName, itemId, scheduledAt, slackUserId, userEmail, investorStatus, dealInterest, investorLink }) {
  // scheduledAt should be a Date object or ISO string
  const reminder = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    investorName,
    itemId,
    scheduledAt: new Date(scheduledAt).toISOString(),
    slackUserId,
    userEmail,
    investorStatus: investorStatus || null,
    dealInterest: dealInterest || null,
    investorLink: investorLink || null,
    createdAt: new Date().toISOString(),
  };
  reminders.push(reminder);
  saveReminders();
  console.log(`[reminders/store] Added reminder for ${investorName} at ${reminder.scheduledAt} (user: ${slackUserId})`);
  return reminder;
}

function getDueReminders() {
  const now = new Date();
  return reminders.filter(r => new Date(r.scheduledAt) <= now);
}

function removeReminder(id) {
  reminders = reminders.filter(r => r.id !== id);
  saveReminders();
}

function getAllReminders() {
  return [...reminders];
}

module.exports = { loadReminders, addReminder, getDueReminders, removeReminder, getAllReminders };
