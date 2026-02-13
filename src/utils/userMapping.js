// ---------------------------------------------------------------------------
// Slack ↔ Monday.com user mapping — resolves Slack users to Monday.com
// person IDs for the "Assigned To" people column.
// ---------------------------------------------------------------------------

const config = require('../config');
const { mondayApi } = require('../monday/client');

// ---------------------------------------------------------------------------
// Hardcoded team member Slack ID lookup (fast, no API call needed)
// ---------------------------------------------------------------------------
const TEAM_SLACK_IDS = {
  anton: 'U0A9BRJSS2U',
  alejandro: 'U0A9BLW5480',
  freddie: 'U0AF1LGMSAU',
  jim: 'U0A8HSQCKML',
  nate: 'U0A8HGP7BDG',
  deatrich: 'U0AE7C9LK8A',
  austin: 'U0A8WESSL81',
};

/**
 * Look up a team member's Slack user ID by first name (case-insensitive).
 * @param {string} name
 * @returns {string|null} Slack user ID or null
 */
function getTeamSlackId(name) {
  if (!name) return null;
  const key = name.toLowerCase().trim().split(/\s+/)[0]; // first name only
  return TEAM_SLACK_IDS[key] || null;
}

// In-memory cache: slackUserId → { mondayPersonId, name, email, cachedAt }
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Monday.com users cache (fetched once, refreshed hourly)
let mondayUsers = null;
let mondayUsersFetchedAt = 0;

// ---------------------------------------------------------------------------
// Monday.com users query
// ---------------------------------------------------------------------------

const MONDAY_USERS_QUERY = `
  query {
    users {
      id
      name
      email
    }
  }
`;

/**
 * Fetch all Monday.com users (cached for 1 hour).
 * @returns {Promise<Array<{id: string, name: string, email: string}>>}
 */
async function getMondayUsers() {
  const now = Date.now();
  if (mondayUsers && now - mondayUsersFetchedAt < CACHE_TTL_MS) {
    return mondayUsers;
  }

  try {
    const data = await mondayApi(MONDAY_USERS_QUERY);
    mondayUsers = data.users || [];
    mondayUsersFetchedAt = now;
    console.log(`[userMapping] Fetched ${mondayUsers.length} Monday.com users`);
    return mondayUsers;
  } catch (err) {
    console.error('[userMapping] Failed to fetch Monday.com users:', err.message);
    return mondayUsers || []; // return stale cache if available
  }
}

/**
 * Find a Monday.com user by matching email or name.
 *
 * @param {string} name  - User's real name from Slack
 * @param {string} email - User's email from Slack
 * @returns {Promise<{id: string, name: string, email: string}|null>}
 */
async function findMondayUser(name, email) {
  const users = await getMondayUsers();

  // 1. Try exact email match first (most reliable)
  if (email) {
    const emailLower = email.toLowerCase();
    const emailMatch = users.find(
      (u) => u.email && u.email.toLowerCase() === emailLower
    );
    if (emailMatch) return emailMatch;
  }

  // 2. Try exact name match
  if (name) {
    const nameLower = name.toLowerCase().trim();
    const nameMatch = users.find(
      (u) => u.name && u.name.toLowerCase().trim() === nameLower
    );
    if (nameMatch) return nameMatch;
  }

  // 3. Try first-name match (if only a first name is provided)
  if (name) {
    const firstName = name.toLowerCase().trim().split(/\s+/)[0];
    const firstNameMatches = users.filter(
      (u) => u.name && u.name.toLowerCase().trim().split(/\s+/)[0] === firstName
    );
    if (firstNameMatches.length === 1) return firstNameMatches[0];
  }

  return null;
}

/**
 * Resolve a Slack user to a Monday.com person ID.
 *
 * @param {import('@slack/web-api').WebClient} slackClient
 * @param {string} slackUserId - Slack user ID (e.g. "U0A9BLW5480")
 * @returns {Promise<{mondayPersonId: string|null, slackUserId: string, slackName: string, slackEmail: string|null}>}
 */
async function resolveSlackUserToMonday(slackClient, slackUserId) {
  // Check cache
  const cached = cache.get(slackUserId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    console.log(`[userMapping] Cache hit for Slack user ${slackUserId} → Monday ID ${cached.mondayPersonId}`);
    return cached;
  }

  try {
    // Get Slack user profile
    const userInfo = await slackClient.users.info({ user: slackUserId });
    const profile = userInfo.user.profile || {};
    const realName = userInfo.user.real_name || profile.real_name || '';
    const email = profile.email || null;

    console.log(`[userMapping] Slack user ${slackUserId}: name="${realName}" email="${email || 'none'}"`);

    // Find matching Monday.com user
    const mondayUser = await findMondayUser(realName, email);

    const result = {
      mondayPersonId: mondayUser ? String(mondayUser.id) : null,
      slackUserId,
      slackName: realName,
      slackEmail: email,
      cachedAt: Date.now(),
    };

    if (mondayUser) {
      console.log(`[userMapping] Mapped Slack ${slackUserId} (${realName}) → Monday.com user ${mondayUser.id} (${mondayUser.name})`);
    } else {
      console.warn(`[userMapping] No Monday.com match found for Slack user ${slackUserId} (${realName}, ${email || 'no email'})`);
    }

    // Cache the result
    cache.set(slackUserId, result);

    return result;
  } catch (err) {
    console.error(`[userMapping] Failed to resolve Slack user ${slackUserId}:`, err.message);
    return {
      mondayPersonId: null,
      slackUserId,
      slackName: 'Unknown',
      slackEmail: null,
    };
  }
}

/**
 * Resolve a team member by display name (not a Slack tag) to a Slack user,
 * then map to Monday.com.
 *
 * @param {import('@slack/web-api').WebClient} slackClient
 * @param {string} name - Team member's name as mentioned in chat
 * @returns {Promise<{mondayPersonId: string|null, slackUserId: string|null, slackName: string, slackEmail: string|null}>}
 */
async function resolveNameToMonday(slackClient, name) {
  if (!name) {
    return { mondayPersonId: null, slackUserId: null, slackName: name, slackEmail: null };
  }

  try {
    // 1. Try hardcoded team lookup first (instant, no API call)
    const teamSlackId = getTeamSlackId(name);
    if (teamSlackId) {
      console.log(`[userMapping] Hardcoded team match: "${name}" → ${teamSlackId}`);
      return resolveSlackUserToMonday(slackClient, teamSlackId);
    }

    // 2. Fall back to Slack API search
    const lowerName = name.toLowerCase().trim();
    let cursor;

    do {
      const result = await slackClient.users.list({ limit: 200, cursor });

      for (const user of result.members) {
        if (user.deleted || user.is_bot) continue;

        const displayName = (user.profile.display_name || '').toLowerCase();
        const realName = (user.real_name || '').toLowerCase();
        const firstName = realName.split(' ')[0];

        if (
          displayName === lowerName ||
          realName === lowerName ||
          firstName === lowerName
        ) {
          return resolveSlackUserToMonday(slackClient, user.id);
        }
      }

      cursor = result.response_metadata && result.response_metadata.next_cursor;
    } while (cursor);

    // 3. No Slack user found — try Monday.com directly by name
    console.warn(`[userMapping] No Slack user found for name "${name}", trying Monday.com directly`);
    const mondayUser = await findMondayUser(name, null);

    return {
      mondayPersonId: mondayUser ? String(mondayUser.id) : null,
      slackUserId: null,
      slackName: name,
      slackEmail: null,
    };
  } catch (err) {
    console.error(`[userMapping] Failed to resolve name "${name}":`, err.message);
    return { mondayPersonId: null, slackUserId: null, slackName: name, slackEmail: null };
  }
}

module.exports = {
  resolveSlackUserToMonday,
  resolveNameToMonday,
  getMondayUsers,
  getTeamSlackId,
  TEAM_SLACK_IDS,
};
