function formatDateYMD(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysAgo(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function getESTDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

/**
 * Escape HTML special characters to prevent XSS in email templates.
 * Replaces &, <, >, ", and ' with their HTML entity equivalents.
 */
function escapeHtml(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape Slack mrkdwn special characters to prevent injection.
 * Prevents <!channel>, <!everyone>, <!here> broadcast mentions,
 * <url|text> link injection, and @user mentions.
 */
function escapeSlackMrkdwn(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Mask an email address for safe logging.
 * "john.doe@company.com" -> "j*******@c*********.com"
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '[no email]';
  const [local, domain] = email.split('@');
  if (!domain) return '***@***';
  const domainParts = domain.split('.');
  const ext = domainParts.pop();
  const maskedLocal = local[0] + '*'.repeat(Math.max(local.length - 1, 3));
  const maskedDomain = domainParts.map(p => p[0] + '*'.repeat(Math.max(p.length - 1, 3))).join('.');
  return `${maskedLocal}@${maskedDomain}.${ext}`;
}

module.exports = { formatDateYMD, daysAgo, getESTDate, escapeHtml, escapeSlackMrkdwn, maskEmail };
