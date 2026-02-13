const config = require('../config');

// ---------------------------------------------------------------------------
// Retry helper — waits then retries on 429 (rate limit) or 5xx errors
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Makes a GraphQL request to the Monday.com API.
 * Automatically retries once on rate limit (429) or server errors (5xx)
 * after a 30-second delay.
 *
 * @param {string} query      - GraphQL query or mutation string
 * @param {object} variables  - Variables to pass with the query
 * @param {object} [opts]     - Options
 * @param {Function} [opts.onRetry] - Callback(error) invoked before retrying
 * @returns {Promise<object>} The parsed JSON response data
 */
async function mondayApi(query, variables = {}, opts = {}) {
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

  async function attempt(retryCount) {
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

      // Retryable HTTP errors: 429 rate limit or 5xx server errors
      if ((response.status === 429 || response.status >= 500) && retryCount === 0) {
        const text = await response.text();
        const err = new Error(
          `Monday.com API HTTP ${response.status}: ${text}`
        );
        err.statusCode = response.status;
        err.responseBody = text;
        err.retryable = true;
        throw err;
      }

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

        // Check for rate limit in GraphQL errors
        const isRateLimit = json.errors.some(
          (e) => (e.message || '').toLowerCase().includes('rate limit') ||
                 (e.extensions && e.extensions.code === 'RATE_LIMIT')
        );
        if (isRateLimit && retryCount === 0) {
          err.retryable = true;
          throw err;
        }

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
      // Retry once on retryable errors
      if (err.retryable && retryCount === 0) {
        const retryDelay = 30000; // 30 seconds
        console.warn(`[monday/client] Retryable error (${err.statusCode || 'GraphQL'}): ${err.message}. Retrying in ${retryDelay / 1000}s...`);

        if (opts.onRetry) {
          try { opts.onRetry(err); } catch (_) { /* ignore callback errors */ }
        }

        await sleep(retryDelay);
        return attempt(retryCount + 1);
      }

      console.error('[monday/client] API request failed:', err.message);
      if (err.graphqlErrors) {
        console.error('[monday/client] GraphQL error details:', JSON.stringify(err.graphqlErrors, null, 2));
      }
      throw err;
    }
  }

  return attempt(0);
}

module.exports = { mondayApi };
