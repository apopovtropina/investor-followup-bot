# Investor Follow-Up Bot

## Project Overview
A Slack bot (deployed on Railway) that integrates with Monday.com to track investor follow-ups for a fundraising pipeline. Built with Node.js, Slack Bolt SDK (Socket Mode), Monday.com GraphQL API, and Anthropic Claude for natural language understanding.

## Architecture
- **Entry point:** `src/index.js` — loads reminders, registers commands, starts Slack app, starts cron jobs, starts reminder checker
- **Slack commands:** `src/slack/commands.js` — hybrid regex + NLU message handler pipeline
- **Slack messages:** `src/slack/messages.js` — Slack message formatters (overdue list, investor status, reminder notifications, daily digest with user tagging)
- **Slack notifications:** `src/slack/notifications.js` — DM notifications for follow-up assignments with channel fallback
- **Monday.com client:** `src/monday/client.js` — GraphQL client using native `fetch`, includes `API-Version: 2024-10` header
- **Monday.com queries:** `src/monday/queries.js` — `getActiveInvestors()` reads board items with column value parsing
- **Monday.com mutations:** `src/monday/mutations.js` — `updateNextFollowUp`, `updateLastContactDate`, `updateAssignedTo`, `removeGoingColdFlag`, `testMondayWrite`
- **AI intent parser:** `src/ai/intentParser.js` — Anthropic Claude NLU for conversational message parsing (extracts action, investor name, date, assignee)
- **AI suggestions:** `src/ai/suggestions.js` — Claude-powered follow-up suggestions for daily digest
- **User mapping:** `src/utils/userMapping.js` — Slack ↔ Monday.com user resolution with in-memory caching (matches by email/name)
- **Reminders store:** `src/reminders/store.js` — persistence to `reminders.json`, `addReminder()` stores investor context
- **Reminders checker:** `src/reminders/checker.js` — 60-second `setInterval` polling loop, posts Slack notifications when reminders are due
- **Date parser:** `src/utils/dateParser.js` — chrono-node wrapper, defaults to 9am ET, handles timezone abbreviations
- **Name matching:** `src/utils/nameMatch.js` — Fuse.js fuzzy matching (threshold 0.35)
- **Config:** `src/config.js` — board ID `18399326252`, all column IDs, timezone `America/New_York`, cadence tiers
- **Cron jobs:** `src/scheduler/cron.js` — daily scan, weekly summary, stale alerts, 15-min polling

## Message Processing Pipeline
1. **Fast regex path** — well-known commands matched instantly (zero latency): "test monday", "who's overdue", "status on X", "contacted X today"
2. **NLU path** — if no regex match, message is sent to Anthropic Claude for intent parsing
3. **Intent routing** — parsed intent dispatched to handler: `schedule_followup`, `assign_followup`, `log_touchpoint`, `check_status`, `list_overdue`, `list_by_status`, `list_not_contacted`, `test_monday`
4. **Confidence threshold** — intents with confidence < 0.5 trigger a conversational "I'm not sure" help response

## Key Technical Details
- **Monday.com Board ID:** 18399326252
- **Column IDs:** status=`color_mm0d1f8z`, assignedTo=`multiple_person_mm0dq26t`, lastContactDate=`date_mm0dm8y0`, nextFollowUp=`date_mm0drsbg`, notes=`long_text_mm0dvjg7`
- **Slack Channel:** #monday-investor-followups (`C0ADB93MTLP`)
- **Slack Socket Mode** — no webhook URLs needed
- **Deployed on Railway** — auto-deploys from GitHub pushes to `main`
- **Monday.com mutations** use GraphQL variables approach (avoids JSON double-escaping issues)
- **People column format:** `{"personsAndTeams":[{"id":PERSON_ID,"kind":"person"}]}`
- **User mapping cache:** 1-hour TTL, maps Slack users to Monday.com person IDs via email match

## Supported Slack Commands (Conversational)
The bot understands natural language in the configured channel:
- **Schedule follow-up:** "Hey can someone follow up with Wyatt Heavy this week?", "Remind me to call Scott Pastel on Monday", "We need to reach out to Skyler Martin before end of week"
- **Assign follow-up:** "Tell Alejandro to follow up with Bobby tomorrow", "@alejandro remind him to call Wyatt Heavy by Friday" — assigns person on Monday.com + sends DM
- **Log touchpoint:** "contacted [Name] today", "spoke with [Name]", "just got off a call with [Name]"
- **Check status:** "Has anyone talked to Jalin Moore recently?", "status on [Name]", "check on [Name]"
- **List by status:** "What's the status on all our hot leads?"
- **List not contacted:** "Who hasn't been contacted in the last 2 weeks?"
- **Check overdue:** "who's overdue", "overdue investors"
- **Diagnostics:** "test monday"

## Slack App Required Scopes
- `channels:history`, `channels:read`, `channels:join` — read channel messages
- `chat:write` — post messages
- `users:read`, `users:read.email` — look up user profiles for mapping
- `im:write` — DM assigned users (falls back to channel mention if missing)
- `connections:write` — Socket Mode

## Recent Changes (Feb 2026)
1. Added Anthropic Claude NLU intent parsing (`src/ai/intentParser.js`) — replaces rigid regex for conversational messages
2. Added Slack ↔ Monday.com user mapping (`src/utils/userMapping.js`) with 1-hour cache
3. Added `updateAssignedTo()` mutation for Monday.com people column
4. Added DM notification system (`src/slack/notifications.js`) with channel fallback
5. Added `assign_followup` handler — resolves assignee, updates Monday.com, sends DM
6. Added `list_by_status` and `list_not_contacted` handlers
7. Updated daily digest to tag assigned users with `<@USERID>` via Slack user map
8. Conversational response style (no more rigid ✅ emoji confirmations)
9. Kept all existing functionality: regex fast-path, touchpoint logging, cadence, cron jobs, reminders
