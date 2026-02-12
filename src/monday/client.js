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

  const isMutation = /^\s*mutation\b/i.test(query);
  const requestBody = JSON.stringify({ query, variables });

  if (isMutation) {
    console.log('[monday/client] Sending mutation, body length:', requestBody.length);
    console.log('[monday/client] Variables:', JSON.stringify(variables));
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiToken,
        'API-Version': '2024-10',
      },
      body: requestBody,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[monday/client] HTTP error response:', text);
      const err = new Error(
        `Monday.com API HTTP ${response.status}: ${text}`
      );
      err.statusCode = response.status;
      err.responseBody = text;
      throw err;
    }

    const json = await response.json();

    if (json.errors && json.errors.length > 0) {
      const messages = json.errors.map((e) => e.message).join('; ');
      console.error('[monday/client] GraphQL errors:', JSON.stringify(json.errors, null, 2));
      const err = new Error(`Monday.com API errors: ${messages}`);
      err.graphqlErrors = json.errors;
      throw err;
    }

    if (json.error_message) {
      console.error('[monday/client] API error_message:', json.error_message, 'error_code:', json.error_code);
      const err = new Error(`Monday.com API error: ${json.error_message}`);
      err.errorCode = json.error_code;
      throw err;
    }

    if (isMutation) {
      console.log('[monday/client] Mutation succeeded, data:', JSON.stringify(json.data));
    }

    return json.data;
  } catch (err) {
    console.error('[monday/client] API request failed:', err.message);
    if (err.graphqlErrors) {
      console.error('[monday/client] GraphQL error details:', JSON.stringify(err.graphqlErrors, null, 2));
    }
    throw err;
  }
}

module.exports = { mondayApi };
