// ---------------------------------------------------------------------------
// AI-powered Natural Language Understanding — uses Anthropic Claude to parse
// user intent from conversational Slack messages.
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

const SYSTEM_PROMPT = `You are an intent parser for an investor follow-up tracking bot used by a real estate investment firm (Elite Capital Group). Your job is to analyze a Slack message and extract structured intent.

You MUST respond with ONLY valid JSON — no markdown, no explanation, no code fences.

The JSON must have this shape:
{
  "action": "schedule_followup" | "log_touchpoint" | "check_status" | "list_overdue" | "list_by_status" | "list_not_contacted" | "assign_followup" | "test_monday" | "unknown",
  "investorName": string | null,
  "date": string | null,
  "assignee": string | null,
  "assigneeIsSlackTag": boolean,
  "statusFilter": string | null,
  "daysSinceFilter": number | null,
  "confidence": number
}

Field definitions:
- action: The primary intent of the message.
  - "schedule_followup": User wants to set/schedule a follow-up date for an investor. This includes phrases like "follow up with X", "set a follow-up for X", "remind me to call X", "we need to reach out to X", "can someone follow up with X".
  - "log_touchpoint": User is reporting they already contacted an investor. Phrases: "contacted X today", "spoke with X", "reached out to X", "just got off a call with X", "had a meeting with X".
  - "check_status": User wants to see the current status of a specific investor. Phrases: "status on X", "check on X", "how's X doing", "what's the latest on X", "has anyone talked to X recently".
  - "list_overdue": User wants to see all overdue follow-ups. Phrases: "who's overdue", "overdue investors", "what follow-ups are late".
  - "list_by_status": User wants to see investors filtered by status. Phrases: "show me hot leads", "what's the status on all our hot leads", "list warm prospects".
  - "list_not_contacted": User wants investors not contacted within a time frame. Phrases: "who hasn't been contacted in 2 weeks", "investors we haven't reached out to in a month".
  - "assign_followup": User wants to assign a follow-up to a specific team member. Phrases: "tell Alejandro to follow up with X", "assign X to Sarah", "remind Alejandro to call X", "@alejandro follow up with X".
  - "test_monday": User wants to run the Monday.com diagnostic test. Phrases: "test monday".
  - "unknown": Cannot determine intent.

- investorName: The investor's name mentioned in the message. Extract the full name, stripping any leading prepositions (with, for, on, about, regarding). Return null if no investor is mentioned.

- date: A natural language date expression extracted from the message (e.g. "tomorrow", "next tuesday", "this week", "Friday", "before end of week", "by Monday", "in 2 days"). Return null if no date mentioned. For "this week", return "this friday". For "before end of week", return "this friday". For "by [day]", return that day.

- assignee: The name of the team member being assigned. Could be a plain name ("Alejandro") or a Slack user tag ("<@U0A9BLW5480>"). Return the raw string as found in the message.

- assigneeIsSlackTag: true if the assignee was a Slack user mention like <@UXXXXXXX>, false otherwise.

- statusFilter: For list_by_status, extract the status category. Map common phrases: "hot leads" → "Hot Lead", "warm prospects" → "Warm Prospect", "cold leads" → "Cold / New Lead", "committed" → "Committed", "funded" → "Funded".

- daysSinceFilter: For list_not_contacted, extract the number of days. "2 weeks" → 14, "a month" → 30, "3 weeks" → 21.

- confidence: 0.0 to 1.0 — how confident you are in the parsed intent. Below 0.5 means the message is likely not a bot command.

Examples:
User: "Hey can someone follow up with Wyatt Heavy this week?"
→ {"action":"schedule_followup","investorName":"Wyatt Heavy","date":"this friday","assignee":null,"assigneeIsSlackTag":false,"statusFilter":null,"daysSinceFilter":null,"confidence":0.9}

User: "Tell Alejandro to follow up with Bobby tomorrow"
→ {"action":"assign_followup","investorName":"Bobby","date":"tomorrow","assignee":"Alejandro","assigneeIsSlackTag":false,"statusFilter":null,"daysSinceFilter":null,"confidence":0.95}

User: "<@U0A9BLW5480> remind him to call Wyatt Heavy by Friday"
→ {"action":"assign_followup","investorName":"Wyatt Heavy","date":"Friday","assignee":"<@U0A9BLW5480>","assigneeIsSlackTag":true,"statusFilter":null,"daysSinceFilter":null,"confidence":0.95}

User: "Has anyone talked to Jalin Moore recently?"
→ {"action":"check_status","investorName":"Jalin Moore","date":null,"assignee":null,"assigneeIsSlackTag":false,"statusFilter":null,"daysSinceFilter":null,"confidence":0.85}

User: "What's the status on all our hot leads?"
→ {"action":"list_by_status","investorName":null,"date":null,"assignee":null,"assigneeIsSlackTag":false,"statusFilter":"Hot Lead","daysSinceFilter":null,"confidence":0.9}

User: "Who hasn't been contacted in the last 2 weeks?"
→ {"action":"list_not_contacted","investorName":null,"date":null,"assignee":null,"assigneeIsSlackTag":false,"statusFilter":null,"daysSinceFilter":14,"confidence":0.9}

User: "We need to reach out to Skyler Martin before end of week"
→ {"action":"schedule_followup","investorName":"Skyler Martin","date":"this friday","assignee":null,"assigneeIsSlackTag":false,"statusFilter":null,"daysSinceFilter":null,"confidence":0.9}

User: "Remind me to call Scott Pastel on Monday"
→ {"action":"schedule_followup","investorName":"Scott Pastel","date":"Monday","assignee":null,"assigneeIsSlackTag":false,"statusFilter":null,"daysSinceFilter":null,"confidence":0.9}

User: "contacted Jalin Moore today"
→ {"action":"log_touchpoint","investorName":"Jalin Moore","date":"today","assignee":null,"assigneeIsSlackTag":false,"statusFilter":null,"daysSinceFilter":null,"confidence":0.95}

User: "who's overdue"
→ {"action":"list_overdue","investorName":null,"date":null,"assignee":null,"assigneeIsSlackTag":false,"statusFilter":null,"daysSinceFilter":null,"confidence":0.95}

User: "test monday"
→ {"action":"test_monday","investorName":null,"date":null,"assignee":null,"assigneeIsSlackTag":false,"statusFilter":null,"daysSinceFilter":null,"confidence":0.95}

User: "lol nice"
→ {"action":"unknown","investorName":null,"date":null,"assignee":null,"assigneeIsSlackTag":false,"statusFilter":null,"daysSinceFilter":null,"confidence":0.1}

CRITICAL: Respond with ONLY the JSON object. No markdown fences. No explanation.`;

/**
 * Parse a Slack message using Claude to extract structured intent.
 *
 * @param {string} messageText - The raw Slack message text
 * @returns {Promise<Object>} Parsed intent object
 */
async function parseIntent(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    return { action: 'unknown', confidence: 0 };
  }

  const trimmed = messageText.trim();
  if (!trimmed) {
    return { action: 'unknown', confidence: 0 };
  }

  try {
    const anthropic = getClient();

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: trimmed }],
    });

    const text =
      response.content && response.content[0] && response.content[0].text
        ? response.content[0].text.trim()
        : '';

    if (!text) {
      console.warn('[ai/intentParser] Empty response from Claude');
      return { action: 'unknown', confidence: 0 };
    }

    // Strip markdown fences if Claude includes them despite instructions
    let jsonStr = text;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.action) {
      parsed.action = 'unknown';
    }
    if (typeof parsed.confidence !== 'number') {
      parsed.confidence = 0.5;
    }

    console.log(`[ai/intentParser] Parsed intent: action=${parsed.action} investor="${parsed.investorName || 'none'}" date="${parsed.date || 'none'}" assignee="${parsed.assignee || 'none'}" confidence=${parsed.confidence}`);

    return parsed;
  } catch (err) {
    console.error('[ai/intentParser] Failed to parse intent:', err.message);
    return { action: 'unknown', confidence: 0, error: err.message };
  }
}

module.exports = { parseIntent };
