const nodemailer = require('nodemailer');
const config = require('../config');
const { escapeHtml, maskEmail } = require('../utils/helpers');

/**
 * Send a follow-up reminder email to the specified recipient.
 *
 * @param {Object} opts
 * @param {string} opts.to          - Recipient email address
 * @param {string} opts.investorName - Investor display name
 * @param {Object} opts.investor    - Full investor object from Monday.com
 * @param {string} [opts.suggestion] - AI-generated follow-up suggestion
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function sendReminderEmail({ to, investorName, investor, suggestion }) {
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      requireTLS: config.smtp.port !== 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });

    // Derive first name from recipient email (before the @, capitalize first letter)
    const localPart = to.split('@')[0] || 'there';
    const firstName = localPart.charAt(0).toUpperCase() + localPart.slice(1).replace(/[._-]/g, ' ');

    // Compute days since last contact
    let daysSinceContact = 'N/A';
    if (investor.lastContactDate) {
      const diff = Math.floor(
        (Date.now() - new Date(investor.lastContactDate).getTime()) / 86400000
      );
      daysSinceContact = `${diff}`;
    }

    // Format last contact date for display
    const lastContactStr = investor.lastContactDate
      ? new Date(investor.lastContactDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'America/Chicago',
        })
      : 'Never';

    // Format investment amount
    const amount = investor.investmentInterest
      ? parseFloat(investor.investmentInterest).toLocaleString('en-US')
      : '0';

    // Monday.com link
    const mondayLink = investor.link || config.monday.boardUrl + investor.id;

    // Build notes section
    const notesHtml = investor.notes
      ? `<p><strong>Last Note:</strong> "${escapeHtml(investor.notes.substring(0, 300))}"</p>`
      : '';

    // Build suggestion section
    const suggestionHtml = suggestion
      ? `<p><strong>Suggested Action:</strong> ${escapeHtml(suggestion)}</p>`
      : '';

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px;">
  <h2>&#x1F514; Follow-Up Reminder</h2>
  <p>Hey ${escapeHtml(firstName)},</p>
  <p>This is your scheduled follow-up reminder:</p>
  <table style="width:100%; border-collapse:collapse;">
    <tr><td style="padding:8px; font-weight:bold;">Investor:</td><td style="padding:8px;">${escapeHtml(investorName)}</td></tr>
    <tr><td style="padding:8px; font-weight:bold;">Status:</td><td style="padding:8px;">${escapeHtml(investor.status || 'N/A')}</td></tr>
    <tr><td style="padding:8px; font-weight:bold;">Deal Interest:</td><td style="padding:8px;">${escapeHtml(investor.dealInterest || 'N/A')}</td></tr>
    <tr><td style="padding:8px; font-weight:bold;">Investment Interest:</td><td style="padding:8px;">$${escapeHtml(amount)}</td></tr>
    <tr><td style="padding:8px; font-weight:bold;">Last Contacted:</td><td style="padding:8px;">${escapeHtml(lastContactStr)}</td></tr>
    <tr><td style="padding:8px; font-weight:bold;">Days Since Last Contact:</td><td style="padding:8px;">${escapeHtml(daysSinceContact)} days</td></tr>
    <tr><td style="padding:8px; font-weight:bold;">Source:</td><td style="padding:8px;">${escapeHtml(investor.source || 'N/A')}</td></tr>
  </table>
  ${notesHtml}
  ${suggestionHtml}
  <p><a href="${mondayLink}">${escapeHtml('Open in Monday.com')}</a></p>
  <hr/>
  <p style="color:#888;">&mdash; Elite Capital Follow-Up Bot</p>
</div>`.trim();

    const subject = `\u{1F514} Follow-Up Reminder: ${escapeHtml(investorName)} \u2014 Due Now`;

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject,
      html,
    });

    console.log(`[reminders/email] Reminder email sent to ${maskEmail(to)} for ${investorName}`);
    return true;
  } catch (err) {
    console.error(`[reminders/email] Failed to send email to ${maskEmail(to)}:`, err.message);
    return false;
  }
}

module.exports = { sendReminderEmail };
