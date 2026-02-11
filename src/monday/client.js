const config = require('../config');

/**
 * Makes a GraphQL request to the Monday.com API.
 *
 * @param {string} query  - GraphQL query or mutation string
 * @param {object} variables - Variables to pass with the query
 * @returns {Promise<object>} The parsed JSON response data
 */
async function mondayApi(query, variables = {}) {
  const { apiToken, apiUrl } = config.monday;

  if (!apiToken) {
    throw new Error('MONDAY_API_TOKEN is not set. Check your .env file.');
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Monday.com API HTTP ${response.status}: ${text}`
      );
    }

    const json = await response.json();

    if (json.errors && json.errors.length > 0) {
      const messages = json.errors.map((e) => e.message).join('; ');
      throw new Error(`Monday.com API errors: ${messages}`);
    }

    if (json.error_message) {
      throw new Error(`Monday.com API error: ${json.error_message}`);
    }

    return json.data;
  } catch (err) {
    console.error('[monday/client] API request failed:', err.message);
    throw err;
  }
}

module.exports = { mondayApi };
