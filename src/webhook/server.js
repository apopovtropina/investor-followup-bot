// ---------------------------------------------------------------------------
// Monday.com Webhook Server
// ---------------------------------------------------------------------------
// Listens for incoming webhooks from Monday.com on POST /webhook/monday.
// Handles the Monday.com webhook verification challenge and routes status-
// change events to the handler.
//
// Monday.com webhook flow:
//   1. You create a webhook via Monday.com API or UI
//   2. Monday sends a POST with { "challenge": "..." } to verify the URL
//   3. We respond with { "challenge": "..." } to confirm
//   4. After verification, Monday sends real events as POST payloads
// ---------------------------------------------------------------------------

const { handleStatusChange } = require('./handler');

/**
 * Register the Monday.com webhook route on the existing Express app.
 *
 * @param {import('express').Express} expressApp - The Express app instance
 * @param {import('@slack/web-api').WebClient} slackClient - Slack Web API client
 */
function registerWebhookRoutes(expressApp, slackClient) {
  // Parse JSON bodies (express.json() should already be applied, but ensure it)
  expressApp.use('/webhook', require('express').json());

  expressApp.post('/webhook/monday', async (req, res) => {
    const body = req.body;

    // ── Step 1: Handle Monday.com webhook verification challenge ──
    if (body && body.challenge) {
      console.log('[webhook/server] Monday.com webhook challenge received. Responding...');
      return res.status(200).json({ challenge: body.challenge });
    }

    // ── Step 2: Process the webhook event ──
    if (!body || !body.event) {
      console.warn('[webhook/server] Received webhook with no event payload:', JSON.stringify(body));
      return res.status(200).json({ ok: true });
    }

    // Acknowledge immediately (Monday.com expects a fast 200 response)
    res.status(200).json({ ok: true });

    // Process asynchronously so we don't block the response
    const eventType = body.event.type || 'unknown';
    const columnId = body.event.columnId || 'unknown';
    const itemId = body.event.itemId || 'unknown';

    console.log(
      `[webhook/server] Received event: type=${eventType} column=${columnId} item=${itemId}`
    );

    try {
      const result = await handleStatusChange(body, slackClient);
      if (result.notified) {
        console.log(`[webhook/server] Notification sent for item ${itemId}`);
      } else {
        console.log(`[webhook/server] No notification needed: ${result.reason}`);
      }
    } catch (err) {
      console.error(`[webhook/server] Error processing webhook event: ${err.message}`);
    }
  });

  console.log('[webhook/server] Monday.com webhook route registered: POST /webhook/monday');
}

module.exports = { registerWebhookRoutes };
