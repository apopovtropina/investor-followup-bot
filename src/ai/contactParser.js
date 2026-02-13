// ---------------------------------------------------------------------------
// AI-powered contact info parser — uses Anthropic Claude to extract
// structured contact data from pasted messages (name, phone, email, etc.)
// ---------------------------------------------------------------------------

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

let client = null;

function getClient() {
  if (!client) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `You are a contact information parser. Your job is to extract structured contact data from Slack messages where someone pastes investor/contact information.

You MUST respond with ONLY valid JSON — no markdown, no explanation, no code fences.

The JSON must be an ARRAY of contact objects. Each contact object has:
{
  "name": string,
  "phone": string | null,
  "email": string | null,
  "linkedin": string | null,
  "notes": string | null
}

Rules:
- Extract ALL contacts found in the message (there may be 1-5 contacts pasted at once)
- Clean up phone numbers: strip Slack formatting like <tel:xxx|xxx>, keep just the digits with dashes/spaces
- Clean up emails: strip Slack formatting like <mailto:xxx|xxx>, keep just the email address
- Clean up URLs: strip Slack formatting like <url|text>, keep just the URL
- For LinkedIn, look for linkedin.com URLs
- Put any extra context, company info, or notes into the "notes" field
- If a field is not found, set it to null
- The "name" field is REQUIRED — skip contacts where you can't determine the name
- Phone numbers should be formatted as-is (don't add country codes unless present)

Examples:

Message: "New contact: John Smith, 555-123-4567, john@example.com, works at ABC Corp. Met him at the conference."
→ [{"name":"John Smith","phone":"555-123-4567","email":"john@example.com","linkedin":null,"notes":"Works at ABC Corp. Met him at the conference."}]

Message: "Got two new leads:
Sarah Johnson - <tel:555-987-6543|555-987-6543> - <mailto:sarah@invest.com|sarah@invest.com> - interested in Fund III
Mike Chen - <tel:555-444-3333|555-444-3333> - <https://linkedin.com/in/mikechen|LinkedIn> - referred by Tom"
→ [{"name":"Sarah Johnson","phone":"555-987-6543","email":"sarah@invest.com","linkedin":null,"notes":"Interested in Fund III"},{"name":"Mike Chen","phone":"555-444-3333","email":null,"linkedin":"https://linkedin.com/in/mikechen","notes":"Referred by Tom"}]

CRITICAL: Respond with ONLY the JSON array. No markdown fences. No explanation.`;

/**
 * Parse a Slack message to extract contact information for one or more contacts.
 *
 * @param {string} messageText - The raw Slack message text
 * @returns {Promise<Array<{name: string, phone: string|null, email: string|null, linkedin: string|null, notes: string|null}>>}
 */
async function parseContacts(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    return [];
  }

  try {
    const anthropic = getClient();

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageText.trim() }],
    });

    const text =
      response.content && response.content[0] && response.content[0].text
        ? response.content[0].text.trim()
        : '';

    if (!text) {
      console.warn('[ai/contactParser] Empty response from Claude');
      return [];
    }

    // Strip markdown fences if included despite instructions
    let jsonStr = text;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) {
      console.warn('[ai/contactParser] Response is not an array:', typeof parsed);
      return [];
    }

    // Validate each contact has a name
    const valid = parsed.filter((c) => c && c.name && typeof c.name === 'string');

    console.log(`[ai/contactParser] Parsed ${valid.length} contacts from message`);
    return valid;
  } catch (err) {
    console.error('[ai/contactParser] Failed to parse contacts:', err.message);
    return [];
  }
}

module.exports = { parseContacts };
